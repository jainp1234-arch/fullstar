import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import { ContentValue, LessonScene, QuestionContent } from './content-body';
import { AnswerButton, AnswerLetter } from '../components/answer-button';
import { Button } from '../components/button';
import { QuestionCard } from '../components/question-card';
import { SpeechBubble } from '../components/speech-bubble';
import { IllustrationKey, illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';

const LETTERS: readonly AnswerLetter[] = ['A', 'B', 'C', 'D'];

interface Answer {
  readonly letter: AnswerLetter;
  readonly text: string;
  readonly correct: boolean;
}

/** The answers a question shows as A–D buttons; match questions show pairs instead. */
function answersOf(question: QuestionContent): readonly Answer[] {
  switch (question.type) {
    case 'mcq':
      return question.body.options.map((option, i) => ({
        letter: LETTERS[i],
        text: option.text,
        correct: option.id === question.solution.correct[0],
      }));
    case 'true_false':
      return [
        { letter: 'A', text: EN.preview.trueLabel, correct: question.solution.correct },
        { letter: 'B', text: EN.preview.falseLabel, correct: !question.solution.correct },
      ];
    case 'fill_blank':
      return question.body.choices.map((choice, i) => ({
        letter: LETTERS[i],
        text: choice,
        correct: choice.trim() === question.solution.correct.trim(),
      }));
    case 'match':
      return [];
  }
}

/**
 * Content as a child sees it (App Flow S5, Schema §5), in kid mode: a lesson scene by scene (owl and
 * narration, illustration with its animation), a question with A–D answers and the explanation, a
 * reading passage. Animations follow reduced motion. K4 lesson playback builds on this.
 */
@Component({
  selector: 'app-content-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnswerButton, Button, QuestionCard, SpeechBubble],
  host: { 'data-mode': 'kid' },
  template: `
    @switch (value().kind) {
      @case ('lesson') {
        @if (scene(); as current) {
          <p class="meta">{{ text.scene(sceneIndex() + 1, sceneCount()) }}</p>
          <div class="scene">
            @if (current.visual; as visual) {
              <img
                [class]="'scene__picture anim--' + visual.animation"
                [src]="pictureUrl(visual.illustration)"
                alt=""
                width="160"
                height="160"
              />
            }
            @if (current.text) {
              <app-speech-bubble [text]="current.text" [lang]="lang()" />
            } @else {
              <p class="note">{{ text.quizScene }}</p>
            }
          </div>
          <div class="steps">
            <app-button
              variant="secondary"
              [label]="text.back"
              [disabled]="sceneIndex() === 0"
              (pressed)="step(-1)"
            />
            <app-button
              [label]="text.next"
              [disabled]="sceneIndex() >= sceneCount() - 1"
              (pressed)="step(1)"
            />
          </div>
        }
      }
      @case ('passage') {
        <h2 class="heading">{{ text.readTitle }}</h2>
        <p class="passage" [attr.lang]="lang()">{{ passageText() }}</p>
      }
      @case ('question') {
        @if (question(); as q) {
          <app-question-card [question]="q.body.prompt" [position]="1" [total]="1" [lang]="lang()">
            @if (q.type === 'match') {
              <p class="note">{{ text.matchHint }}</p>
              <ul class="pairs">
                @for (pair of matchRows(); track pair.left) {
                  <li class="pairs__row">
                    <span [attr.lang]="lang()">{{ pair.left }}</span>
                    <span class="pairs__arrow" aria-hidden="true">→</span>
                    <span [attr.lang]="lang()">{{ solved() ? pair.right : '?' }}</span>
                  </li>
                }
              </ul>
              @if (!solved()) {
                <app-button
                  variant="secondary"
                  [label]="text.showPairs"
                  (pressed)="solved.set(true)"
                />
              }
            } @else {
              @for (answer of answers(); track answer.letter) {
                <app-answer-button
                  [letter]="answer.letter"
                  [text]="answer.text"
                  [lang]="lang()"
                  [correct]="solved() && answer.correct"
                  [disabled]="solved()"
                  (pressed)="choose(answer)"
                />
              }
            }
          </app-question-card>
          @if (solved()) {
            <app-speech-bubble
              [text]="text.wellDone + ' ' + q.solution.explanation"
              [lang]="lang()"
            />
          } @else if (missed()) {
            <p class="note" role="status">{{ text.tryAgain }}</p>
          }
        }
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-5);
      border-radius: var(--radius-lg);
      background: var(--color-page);
    }
    .meta,
    .note {
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .scene {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-4);
      min-height: 240px;
    }
    .scene__picture {
      display: block;
    }
    .anim--fade-up {
      animation: fade-up var(--dur-slow, 400ms) var(--ease-standard) both;
    }
    .anim--slide-in {
      animation: slide-in var(--dur-slow, 400ms) var(--ease-standard) both;
    }
    .anim--pop {
      animation: pop var(--dur-slow, 400ms) var(--ease-standard) both;
    }
    @keyframes fade-up {
      from {
        opacity: 0;
        transform: translateY(16px);
      }
    }
    @keyframes slide-in {
      from {
        opacity: 0;
        transform: translateX(-24px);
      }
    }
    @keyframes pop {
      0% {
        transform: scale(0.6);
      }
      70% {
        transform: scale(1.08);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .anim--fade-up,
      .anim--slide-in,
      .anim--pop {
        animation: none;
      }
    }
    .steps {
      display: flex;
      justify-content: space-between;
      gap: var(--space-3);
    }
    .heading {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
    .passage {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text);
      white-space: pre-line;
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
    .pairs__arrow {
      color: var(--color-text-2);
    }
  `,
})
export class ContentPreview {
  readonly value = input.required<ContentValue>();
  /** "hi" for Hindi content (Guidelines §14). */
  readonly lang = input<string | null>(null);

  protected readonly text = EN.preview;
  protected readonly sceneIndex = signal(0);
  protected readonly solved = signal(false);
  protected readonly missed = signal(false);
  private readonly buttons = viewChildren(AnswerButton);

  protected readonly scenes = computed<readonly LessonScene[]>(() => {
    const value = this.value();
    return value.kind === 'lesson' ? value.body.scenes : [];
  });
  protected readonly sceneCount = computed(() => this.scenes().length);
  protected readonly scene = computed<LessonScene | null>(
    () => this.scenes()[Math.min(this.sceneIndex(), this.sceneCount() - 1)] ?? null,
  );
  protected readonly passageText = computed(() => {
    const value = this.value();
    return value.kind === 'passage' ? value.body.text : '';
  });
  protected readonly question = computed<QuestionContent | null>(() => {
    const value = this.value();
    return value.kind === 'question' ? value : null;
  });
  protected readonly answers = computed(() => {
    const question = this.question();
    return question ? answersOf(question) : [];
  });
  protected readonly matchRows = computed(() => {
    const question = this.question();
    if (question?.type !== 'match') {
      return [];
    }
    const right = new Map(question.body.right.map((item) => [item.id, item.text]));
    const partner = new Map(question.solution.pairs.map(([l, r]) => [l, right.get(r) ?? '']));
    return question.body.left.map((item) => ({
      left: item.text,
      right: partner.get(item.id) ?? '',
    }));
  });

  constructor() {
    // A changed question starts unanswered
    effect(() => {
      this.value();
      this.solved.set(false);
      this.missed.set(false);
      if (this.sceneIndex() >= this.sceneCount()) {
        this.sceneIndex.set(0);
      }
    });
  }

  protected step(delta: number): void {
    this.sceneIndex.update((index) => Math.max(0, Math.min(this.sceneCount() - 1, index + delta)));
  }

  protected choose(answer: Answer): void {
    if (answer.correct) {
      this.solved.set(true);
      this.missed.set(false);
      return;
    }
    this.missed.set(true);
    this.buttons()
      .find((button) => button.letter() === answer.letter)
      ?.shake();
  }

  protected pictureUrl(key: string): string {
    return illustrationUrl(key as IllustrationKey);
  }
}
