import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { AuthService } from '../auth/auth.service';

/** Schema §4.4 activity kinds with a player so far (6.2 lesson, 6.3 readalong, 7.1 practice and tables). */
export type AttemptKind =
  'lesson' | 'readalong' | 'practice' | 'tables' | 'tables_challenge' | 'worksheet';

/** An attempt as the device records it; the server computes stars from the counts. */
export interface AttemptEvent {
  readonly id: string;
  readonly kind: AttemptKind;
  readonly subject_id: number;
  readonly content_item_id: string | null;
  readonly content_version_id: string | null;
  readonly family_chapter_id: string | null;
  readonly topic_id: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly correct_count: number | null;
  readonly total_count: number | null;
  readonly duration_seconds: number;
  readonly resume_state: Readonly<Record<string, number>> | null;
}

export interface AnswerEvent {
  readonly id: string;
  readonly attempt_id: string;
  readonly question_item_id: string;
  readonly question_version_id: string;
  readonly is_correct: boolean;
  readonly answer: unknown;
  readonly answered_at: string;
}

interface SyncResult {
  readonly stars_total: number;
  readonly minutes_today: number;
}

/** One queued event: attempts by id (the latest state wins), answers by id, minutes by time. */
interface Outbox {
  readonly key: string;
  readonly childId: string;
  readonly type: 'attempt' | 'answer' | 'minute';
  readonly event: AttemptEvent | AnswerEvent | string;
}

const DB = 'fullstar-kid';
const STORE = 'outbox';
/** Schema §11 batch limits; a longer queue goes in several requests. */
const MAX_ATTEMPTS = 200;
const MAX_ANSWERS = 2000;
const MAX_MINUTES = 1440;
const SYNC_EVERY_MS = 60_000;

/** Schema §11: 0 of anything = 1 star; over 50% = 2; over 80% = 3 (the device shows it at once). */
export function starsFor(correct: number | null, total: number | null): number {
  if (correct === null || total === null || total === 0) {
    return 1;
  }
  const share = correct / total;
  return share > 0.8 ? 3 : share > 0.5 ? 2 : 1;
}

/**
 * Offline-first kid events (Schema §11 POST /family/kid/sync; Plan 6.2). Events are written to
 * IndexedDB first, then sent when online: right away, every minute, and when the connection comes
 * back. An event leaves the queue only after the server took it, and only if it did not change in
 * the meantime. If IndexedDB is unavailable, events are kept in memory for the session.
 */
@Injectable({ providedIn: 'root' })
export class KidEvents {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  /** Server totals from the last sync, by child. */
  readonly stars = signal<Readonly<Record<string, number>>>({});
  readonly minutesToday = signal<Readonly<Record<string, number>>>({});
  readonly pending = signal(0);

  private readonly memory = new Map<string, Outbox>();
  private flushing: Promise<void> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const online = () => void this.flush();
      window.addEventListener('online', online);
      const timer = window.setInterval(() => void this.flush(), SYNC_EVERY_MS);
      inject(DestroyRef).onDestroy(() => {
        window.removeEventListener('online', online);
        window.clearInterval(timer);
      });
    }
    void this.count();
  }

  async attempt(childId: string, attempt: AttemptEvent): Promise<void> {
    await this.put({ key: `attempt:${attempt.id}`, childId, type: 'attempt', event: attempt });
  }

  async answer(childId: string, answer: AnswerEvent): Promise<void> {
    await this.put({ key: `answer:${answer.id}`, childId, type: 'answer', event: answer });
  }

  /** One minute of use (Plan 6.4 sends one each minute). */
  async minute(childId: string, at: Date): Promise<void> {
    const minute = new Date(Math.floor(at.getTime() / 60_000) * 60_000).toISOString();
    await this.put({ key: `minute:${childId}:${minute}`, childId, type: 'minute', event: minute });
  }

  /** Server counts from another answer, e.g. K1 home, until the next sync. */
  seed(childId: string, stars: number, minutesToday: number): void {
    this.stars.update((s) => ({ ...s, [childId]: stars }));
    this.minutesToday.update((m) => ({ ...m, [childId]: minutesToday }));
  }

  /** Sends everything queued; concurrent calls share one run. Never throws. */
  flush(): Promise<void> {
    this.flushing ??= this.run().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async run(): Promise<void> {
    // Offline, or the session has ended (App Flow §10): events wait on the device
    if (
      (typeof navigator !== 'undefined' && navigator.onLine === false) ||
      !this.auth.authenticated()
    ) {
      return;
    }
    const all = await this.all();
    const children = [...new Set(all.map((entry) => entry.childId))];
    for (const childId of children) {
      const mine = all.filter((entry) => entry.childId === childId);
      // Attempts before their answers: the server checks an answer's attempt is the child's
      const attempts = mine.filter((e) => e.type === 'attempt').slice(0, MAX_ATTEMPTS);
      const answers = mine.filter((e) => e.type === 'answer').slice(0, MAX_ANSWERS);
      const minutes = mine.filter((e) => e.type === 'minute').slice(0, MAX_MINUTES);
      const sent = [...attempts, ...answers, ...minutes];
      try {
        const result = await firstValueFrom(
          this.api.post<SyncResult>(
            '/family/kid/sync',
            {
              attempts: attempts.map((e) => e.event),
              answers: answers.map((e) => e.event),
              minutes: minutes.map((e) => e.event),
            },
            { childId },
          ),
        );
        this.stars.update((s) => ({ ...s, [childId]: result.stars_total }));
        this.minutesToday.update((m) => ({ ...m, [childId]: result.minutes_today }));
        await this.remove(sent);
      } catch {
        // Offline or the server is busy: everything stays queued for the next try
      }
    }
    await this.count();
  }

  private async put(entry: Outbox): Promise<void> {
    try {
      await this.run$<void>('readwrite', (store) => store.put(entry));
    } catch {
      this.memory.set(entry.key, entry);
    }
    await this.count();
    void this.flush();
  }

  private async all(): Promise<Outbox[]> {
    try {
      const stored = await this.run$<Outbox[]>('readonly', (store) => store.getAll());
      return [...stored, ...this.memory.values()];
    } catch {
      return [...this.memory.values()];
    }
  }

  /** Removes what was sent, unless it was changed since (a newer attempt state stays queued). */
  private async remove(sent: readonly Outbox[]): Promise<void> {
    const current = new Map((await this.all()).map((e) => [e.key, e]));
    for (const entry of sent) {
      if (JSON.stringify(current.get(entry.key)?.event) !== JSON.stringify(entry.event)) {
        continue;
      }
      this.memory.delete(entry.key);
      try {
        await this.run$<void>('readwrite', (store) => store.delete(entry.key));
      } catch {
        // Kept in memory only
      }
    }
  }

  private async count(): Promise<void> {
    this.pending.set((await this.all()).length);
  }

  private async run$<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = action(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
