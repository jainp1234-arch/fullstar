import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EN } from '../strings/en';

export interface QuestionPicture {
  /** A lesson asset URL. */
  readonly src: string;
  readonly alt: string;
}

/** Above this many questions the dots would crowd; the count alone is shown. */
const MAX_DOTS = 12;

/** app-question-card (Guidelines §11): progress dots, question, optional picture, then answers. */
@Component({
  selector: 'app-question-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="q__progress">
      @if (dots().length) {
        <span class="q__dots" aria-hidden="true">
          @for (dot of dots(); track $index) {
            <span
              class="q__dot"
              [class.q__dot--done]="dot === 'done'"
              [class.q__dot--now]="dot === 'now'"
            ></span>
          }
        </span>
      }
      <span class="q__count">{{ progressLabel() }}</span>
    </div>
    @if (picture(); as pic) {
      <img class="q__picture" [src]="pic.src" [alt]="pic.alt" />
    }
    <h2 class="q__text" [attr.lang]="lang()">{{ question() }}</h2>
    <div class="q__answers"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-6);
      border-radius: var(--radius-xl);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .q__progress {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .q__dots {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .q__dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--color-track);
    }
    .q__dot--done {
      background: var(--color-primary-600);
    }
    .q__dot--now {
      background: var(--color-primary-600);
      box-shadow: 0 0 0 3px var(--color-primary-100);
    }
    .q__count {
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .q__picture {
      display: block;
      max-width: 100%;
      max-height: 240px;
      align-self: center;
      object-fit: contain;
    }
    .q__text {
      margin: 0;
      font: var(--type-quiz);
      color: var(--color-ink-heading);
    }
    .q__answers {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
  `,
})
export class QuestionCard {
  readonly question = input.required<string>();
  /** 1-based position of this question. */
  readonly position = input.required<number>();
  readonly total = input.required<number>();
  readonly picture = input<QuestionPicture | null>(null);
  /** "hi" for Hindi questions (Guidelines §14). */
  readonly lang = input<string | null>(null);

  protected readonly progressLabel = computed(() =>
    EN.a11y.questionOf(this.position(), this.total()),
  );
  protected readonly dots = computed(() => {
    const total = this.total();
    if (total > MAX_DOTS) {
      return [];
    }
    return Array.from({ length: total }, (_, i) => {
      const n = i + 1;
      if (n < this.position()) {
        return 'done';
      }
      return n === this.position() ? 'now' : 'todo';
    });
  });
}
