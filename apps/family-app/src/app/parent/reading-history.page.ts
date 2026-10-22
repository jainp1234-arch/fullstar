import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ApiError, FamilyApi, ReadingApi, ReadingHistoryEntry } from '@fullstar/core';
import { EN, ErrorBar, Skeleton, errorMessage } from '@fullstar/ui';
import { of, switchMap } from 'rxjs';

const DAY = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
});

/**
 * P3 Reading history (App Flow §6, §9; Schema §11; Plan 8.3, ?child=): reading speed and accuracy over
 * time, newest first. Each test plays back until the recording is deleted after 7 days.
 */
@Component({
  selector: 'app-reading-history-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorBar, Skeleton],
  template: `
    @if (tests(); as list) {
      @if (list.length) {
        <ul class="tests" role="list">
          @for (t of list; track t.id) {
            <li class="test">
              <div class="test__head">
                <strong [attr.lang]="t.lang">{{ t.title }}</strong>
                <span class="note">{{ day(t.test_date) }}</span>
              </div>
              <p class="line">{{ lineOf(t) }}</p>
              @if (t.words_to_practise.length) {
                <p class="note" [attr.lang]="t.lang">
                  {{ text.practiseWords(t.words_to_practise.join(', ')) }}
                </p>
              }
              @if (t.recording_url; as url) {
                <audio
                  controls
                  preload="none"
                  [src]="url"
                  [attr.aria-label]="text.playRecording(day(t.test_date))"
                ></audio>
                <p class="note">{{ text.keptUntil(day(t.recording_expires_at ?? t.test_date)) }}</p>
              } @else {
                <p class="note">{{ text.recordingDeleted }}</p>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="note">{{ text.noReading }}</p>
      }
    } @else if (failure(); as message) {
      <app-error-bar [message]="message" (retry)="load()" />
    } @else {
      <app-skeleton shape="list-card" [count]="3" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .tests {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .test {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .test__head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--space-2);
      font: var(--type-body);
      color: var(--color-ink-heading);
    }
    .line {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text);
    }
    .note {
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
    audio {
      width: 100%;
    }
  `,
})
export class ReadingHistoryPage {
  protected readonly text = EN.progress;
  protected readonly tests = signal<readonly ReadingHistoryEntry[] | null>(null);
  protected readonly failure = signal<string | null>(null);

  private readonly api = inject(ReadingApi);
  private readonly family = inject(FamilyApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.failure.set(null);
    const wanted = this.route.snapshot.queryParamMap.get('child');
    (this.family.me() ? of(null) : this.family.loadMe())
      .pipe(
        switchMap(() => {
          const children = this.family.me()?.children ?? [];
          const id = children.find((c) => c.id === wanted)?.id ?? children[0]?.id;
          return id ? this.api.history(id) : of([]);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (list) => this.tests.set(list),
        error: (error: unknown) =>
          this.failure.set(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
          ),
      });
  }

  protected day(iso: string): string {
    return DAY.format(new Date(iso));
  }

  protected lineOf(t: ReadingHistoryEntry): string {
    switch (t.status) {
      case 'scored':
        return this.text.readingLine(t.words_per_minute ?? 0, t.accuracy_pct ?? 0);
      case 'not_understood':
        return this.text.readingNotUnderstood;
      case 'failed':
        return this.text.readingFailed;
      default:
        return this.text.readingChecking;
    }
  }
}
