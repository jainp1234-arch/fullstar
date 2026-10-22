import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { FamilyApi, FamilySession, KidEvents } from '@fullstar/core';
import { CurrentScreen, KidTimeToday } from '@fullstar/ui';

const MINUTE_MS = 60_000;

/** The calendar day in Asia/Kolkata, as "today" is counted (Schema §1). */
function indianDay(at: Date): string {
  return at.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Kid-mode time today (App Flow §3; Plan 6.4). Each minute a child spends in kid mode with the app
 * on screen is queued as a usage minute (KidEvents, synced like attempts). The header's time
 * indicator shows the larger of the server's count and the minutes counted on this device today,
 * against the family's daily limit. There is no pop-up and no lock (App Flow §3).
 */
@Injectable({ providedIn: 'root' })
export class KidTime {
  private readonly events = inject(KidEvents);
  private readonly session = inject(FamilySession);
  private readonly family = inject(FamilyApi);
  private readonly screen = inject(CurrentScreen);
  /** Minutes counted on this device, by child, for one Indian day. */
  private readonly local = signal<Readonly<Record<string, { day: string; minutes: number }>>>({});

  readonly today = computed<KidTimeToday | null>(() => {
    const child = this.session.activeChildId();
    const limit = this.family.me()?.family.daily_limit_minutes;
    if (!child || !limit) {
      return null;
    }
    const counted = this.local()[child];
    const local = counted?.day === indianDay(new Date()) ? counted.minutes : 0;
    return { used: Math.max(this.events.minutesToday()[child] ?? 0, local), limit };
  });

  constructor() {
    const timer = setInterval(() => this.tick(), MINUTE_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private tick(): void {
    const child = this.session.activeChildId();
    if (!child || this.screen.screen()?.mode !== 'kid' || document.visibilityState !== 'visible') {
      return;
    }
    const now = new Date();
    const day = indianDay(now);
    this.local.update((all) => {
      const before = all[child]?.day === day ? all[child].minutes : 0;
      return { ...all, [child]: { day, minutes: before + 1 } };
    });
    void this.events.minute(child, now);
  }
}
