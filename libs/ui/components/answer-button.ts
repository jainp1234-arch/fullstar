import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { iconGlyph } from '../icons/icons';
import { EN } from '../strings/en';

export type AnswerLetter = 'A' | 'B' | 'C' | 'D';

/** Matches the 240 ms shake in the styles (Guidelines §11). */
const SHAKE_MS = 240;

/**
 * app-answer-button (Guidelines §11): a kid quiz answer. Correct pops green with a check; a
 * not-correct answer shakes and returns to normal via shake(). Never red in kid mode.
 */
@Component({
  selector: 'app-answer-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="answer"
      [class.answer--correct]="correct()"
      [class.answer--shake]="shaking()"
      [disabled]="disabled()"
      (click)="pressed.emit(letter())"
    >
      <span class="answer__letter">{{ letter() }}</span>
      <span class="answer__text" [attr.lang]="lang()">{{ text() }}</span>
      @if (correct()) {
        <span
          class="ui-icon ui-icon--filled answer__check"
          role="img"
          [attr.aria-label]="rightLabel"
          >{{ checkGlyph }}</span
        >
      }
    </button>
  `,
  styles: `
    :host {
      display: block;
    }
    .answer {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      width: 100%;
      min-height: 72px;
      padding: var(--space-4);
      box-sizing: border-box;
      border: 2px solid transparent;
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--edge-tile);
      font: var(--type-quiz);
      color: var(--color-text);
      text-align: left;
      cursor: pointer;
      transition:
        transform calc(var(--dur-press) * 1.5) var(--ease-standard),
        background var(--dur-fast) var(--ease-standard);
    }
    .answer:active:not(:disabled) {
      transform: translateY(2px);
      box-shadow: 0 2px 0 var(--color-edge);
      transition-duration: var(--dur-press);
    }
    .answer:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .answer:disabled {
      cursor: default;
    }
    .answer:disabled:not(.answer--correct) {
      opacity: 0.4;
      box-shadow: none;
    }
    .answer__letter {
      flex: none;
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--color-primary-100);
      color: var(--color-primary-600);
      font: var(--type-label);
    }
    .answer__text {
      flex: 1;
    }
    .answer--correct {
      border-color: var(--color-success-700);
      background: var(--color-success-100);
      animation: pop var(--dur-base) var(--ease-bounce);
    }
    .answer__check {
      flex: none;
      font-size: 28px;
      color: var(--color-success-700);
    }
    .answer--shake {
      animation: shake 240ms var(--ease-standard);
    }
    @keyframes pop {
      50% {
        transform: scale(1.04);
      }
    }
    @keyframes shake {
      12.5%,
      62.5% {
        transform: translateX(-6px);
      }
      37.5%,
      87.5% {
        transform: translateX(6px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .answer--correct,
      .answer--shake {
        animation: none;
      }
    }
  `,
})
export class AnswerButton {
  readonly letter = input.required<AnswerLetter>();
  readonly text = input.required<string>();
  readonly correct = input(false);
  readonly disabled = input(false);
  /** "hi" for Hindi answers (Guidelines §14). */
  readonly lang = input<string | null>(null);
  readonly pressed = output<AnswerLetter>();

  protected readonly shaking = signal(false);
  protected readonly rightLabel = EN.a11y.rightAnswer;
  protected readonly checkGlyph = iconGlyph('check_circle');

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  /** Not correct: two 6 px shakes over 240 ms, then back to normal. */
  shake(): void {
    clearTimeout(this.timer);
    this.shaking.set(false);
    queueMicrotask(() => this.shaking.set(true));
    this.timer = setTimeout(() => this.shaking.set(false), SHAKE_MS);
  }
}
