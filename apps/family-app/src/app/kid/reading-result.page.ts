import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FamilyApi, ReadingApi, ReadingTest } from '@fullstar/core';
import { Button, Celebration, EN, KidRetry, OwlLoader, illustrationUrl } from '@fullstar/ui';

/** Schema §11: poll every 2 seconds, for a minute at most. */
const POLL_MS = 2000;
const POLL_MAX_MS = 60_000;

/**
 * K14 Reading result (App Flow §5, §10; Plan 8.3, ?test=): while it is checked, the owl listens;
 * scored: stars, how many words were read well and the words to practise; not understood: "Let's
 * try again" and no score. Read again while a try is left today (one retry a day).
 */
@Component({
  selector: 'app-reading-result-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Celebration, KidRetry, OwlLoader],
  template: `
    @if (test(); as t) {
      @switch (t.status) {
        @case ('scored') {
          <app-celebration [stars]="t.stars" [animate]="animate()">
            <p class="line">{{ text.readWell(t.words_read ?? 0, t.word_count ?? 0) }}</p>
            @if (t.words_to_practise.length) {
              <p class="line">{{ text.wordsToPractise }}:</p>
              <ul class="words" role="list">
                @for (word of t.words_to_practise; track word) {
                  <li [attr.lang]="t.lang">{{ word }}</li>
                }
              </ul>
            }
            @if (t.tests_left_today > 0) {
              <app-button [label]="text.readAgain" [fullWidth]="true" (pressed)="again()" />
            }
            <app-button
              variant="secondary"
              [label]="text.backToReading"
              [fullWidth]="true"
              (pressed)="back()"
            />
          </app-celebration>
        }
        @case ('not_understood') {
          <div class="state" role="alert">
            <img [src]="owl" alt="" width="120" height="120" />
            <h1 class="state__title">{{ text.notUnderstood }}</h1>
            <p class="line">{{ text.noScore }}</p>
            @if (t.tests_left_today > 0) {
              <app-button [label]="text.readAgain" (pressed)="again()" />
            } @else {
              <p class="line">{{ text.testsLeft(0) }}</p>
            }
            <app-button variant="secondary" [label]="text.backToReading" (pressed)="back()" />
          </div>
        }
        @case ('failed') {
          <h1 class="ui-visually-hidden">{{ title }}</h1>
          <app-kid-retry (retry)="back()" />
        }
        @default {
          <h1 class="ui-visually-hidden">{{ title }}</h1>
          <div class="state" role="status">
            @if (tooLong()) {
              <p class="line">{{ text.tooLong }}</p>
              <app-button [label]="text.backToReading" (pressed)="back()" />
            } @else {
              <app-owl-loader />
              <p class="line">{{ text.checking }}</p>
            }
          </div>
        }
      }
    } @else if (failed()) {
      <!-- Shell D has no header: the screen still has its one heading -->
      <h1 class="ui-visually-hidden">{{ title }}</h1>
      <app-kid-retry (retry)="poll()" />
    } @else {
      <h1 class="ui-visually-hidden">{{ title }}</h1>
      <app-owl-loader />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      text-align: center;
    }
    .state__title {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
    .line {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text);
      text-align: center;
    }
    .words {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .words li {
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-pill);
      background: var(--color-primary-100);
      font: var(--type-label);
      color: var(--color-ink-heading);
    }
  `,
})
export class ReadingResultPage {
  protected readonly text = EN.kid.reading;
  protected readonly title = EN.screens.K14;
  protected readonly owl = illustrationUrl('mascot-owl');
  protected readonly test = signal<ReadingTest | null>(null);
  protected readonly failed = signal(false);
  protected readonly tooLong = signal(false);
  protected readonly animate = computed(
    () => this.family.me()?.family.celebrations_enabled ?? true,
  );

  private readonly api = inject(ReadingApi);
  private readonly family = inject(FamilyApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly id = this.route.snapshot.queryParamMap.get('test') ?? '';
  private readonly started = Date.now();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    this.poll();
  }

  protected poll(): void {
    this.failed.set(false);
    this.api.test(this.id).subscribe({
      next: (test) => {
        this.test.set(test);
        if (test.status === 'processing' || test.status === 'awaiting_audio') {
          if (Date.now() - this.started >= POLL_MAX_MS) {
            this.tooLong.set(true);
            return;
          }
          this.timer = setTimeout(() => this.poll(), POLL_MS);
        }
      },
      error: () => this.failed.set(true),
    });
  }

  protected again(): void {
    void this.router.navigateByUrl('/kid/read/test', { replaceUrl: true });
  }

  protected back(): void {
    void this.router.navigateByUrl('/kid/read', { replaceUrl: true });
  }
}
