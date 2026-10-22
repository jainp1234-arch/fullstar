import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import {
  AnswerButton,
  Button,
  EN,
  ProgressBar,
  QuestionCard,
  QuestionContent,
  SpeechBubble,
} from '@fullstar/ui';
import { Choice, choicesOf, pairsOf } from './question-choices';

/** One question to ask; id and versionId are set for stored questions (answer events). */
export interface RunnerQuestion {
  readonly id: string;
  readonly versionId: string | null;
  readonly content: QuestionContent;
}

export interface RunnerAnswer {
  readonly question: RunnerQuestion;
  readonly correct: boolean;
  readonly answer: unknown;
}

/**
 * Questions one per screen with instant feedback (App Flow K9–K11; Plan 7.1). learn: a wrong answer
 * says try again until it is right, then Next. quick (the tables challenge): one answer, then the
 * next question at once. Only the first answer to each question is emitted; it decides the score.
 */
@Component({
  selector: 'app-quiz-runner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnswerButton, Button, ProgressBar, QuestionCard, SpeechBubble],
  template: `
    @if (current(); as q) {
      @if (mode() === 'learn') {
        <app-progress-bar
          [value]="index() + 1"
          [max]="questions().length"
          [label]="text.question(index() + 1, questions().length)"
        />
      }
      <app-question-card
        [question]="q.content.body.prompt"
        [position]="index() + 1"
        [total]="questions().length"
        [lang]="lang()"
      >
        @if (q.content.type === 'match') {
          <ul class="pairs">
            @for (pair of pairs(); track pair.left) {
              <li class="pairs__row">
                <span [attr.lang]="lang()">{{ pair.left }}</span>
                <span aria-hidden="true">→</span>
                <span [attr.lang]="lang()">{{ solved() ? pair.right : '?' }}</span>
              </li>
            }
          </ul>
          @if (!solved()) {
            <app-button variant="secondary" [label]="player.showPairs" (pressed)="showPairs(q)" />
          }
        } @else {
          @for (choice of choices(); track choice.letter) {
            <app-answer-button
              [letter]="choice.letter"
              [text]="choice.text"
              [lang]="lang()"
              [correct]="solved() && choice.correct"
              [disabled]="solved()"
              (pressed)="choose(q, choice)"
            />
          }
        }
      </app-question-card>
      @if (mode() === 'learn') {
        @if (solved()) {
          @if (explanation(q); as text) {
            <app-speech-bubble [text]="text" [lang]="lang()" />
          }
          <app-button
            [label]="last() ? text.finish : text.next"
            [fullWidth]="true"
            (pressed)="next()"
          />
        } @else if (missed()) {
          <p class="note" role="status">{{ kid.notCorrect }}</p>
        }
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .pairs {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
      font: var(--type-body);
    }
    .pairs__row {
      display: flex;
      gap: var(--space-3);
    }
  `,
})
export class QuizRunner {
  readonly questions = input.required<readonly RunnerQuestion[]>();
  readonly mode = input<'learn' | 'quick'>('learn');
  readonly lang = input<string | null>(null);
  /** The first answer to each question. */
  readonly answered = output<RunnerAnswer>();
  /** After the last question: right first time, of how many. */
  readonly finished = output<{ correct: number; total: number }>();

  protected readonly text = EN.kid.practice;
  protected readonly player = EN.kid.player;
  protected readonly kid = EN.kid;
  protected readonly index = signal(0);
  protected readonly solved = signal(false);
  protected readonly missed = signal(false);
  protected readonly current = computed(() => this.questions()[this.index()] ?? null);
  protected readonly last = computed(() => this.index() >= this.questions().length - 1);
  protected readonly choices = computed(() => {
    const q = this.current();
    return q ? choicesOf(q.content) : [];
  });
  protected readonly pairs = computed(() => {
    const q = this.current();
    return q ? pairsOf(q.content) : [];
  });

  private readonly buttons = viewChildren(AnswerButton);
  private readonly first = new Map<string, boolean>();

  constructor() {
    // A new list starts from the top
    effect(() => {
      this.questions();
      this.index.set(0);
      this.solved.set(false);
      this.missed.set(false);
      this.first.clear();
    });
  }

  protected explanation(q: RunnerQuestion): string | null {
    const solution = q.content.solution as { explanation?: string };
    return solution.explanation ? `${this.kid.correct} ${solution.explanation}` : null;
  }

  protected choose(q: RunnerQuestion, choice: Choice): void {
    this.record(q, choice.correct, choice.answer);
    if (this.mode() === 'quick') {
      this.next();
      return;
    }
    if (choice.correct) {
      this.solved.set(true);
      this.missed.set(false);
      return;
    }
    this.missed.set(true);
    this.buttons()
      .find((button) => button.letter() === choice.letter)
      ?.shake();
  }

  /** Match pairs are shown, not answered; they count as tried and right. */
  protected showPairs(q: RunnerQuestion): void {
    this.record(q, true, { shown: true });
    this.solved.set(true);
  }

  protected next(): void {
    if (this.last()) {
      const correct = [...this.first.values()].filter(Boolean).length;
      this.finished.emit({ correct, total: this.first.size });
      return;
    }
    this.index.update((i) => i + 1);
    this.solved.set(false);
    this.missed.set(false);
  }

  private record(q: RunnerQuestion, correct: boolean, answer: unknown): void {
    if (this.first.has(q.id)) {
      return;
    }
    this.first.set(q.id, correct);
    this.answered.emit({ question: q, correct, answer });
  }
}
