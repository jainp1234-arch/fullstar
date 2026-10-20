import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { illustrationUrl } from '../illustrations/illustrations';

/** app-speech-bubble (Guidelines §9): the owl at 96 px with a bubble whose tail points at it. */
@Component({
  selector: 'app-speech-bubble',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showOwl()) {
      <img class="owl" [src]="owl" alt="" width="96" height="96" />
    }
    <div class="bubble">
      <p class="bubble__text" [attr.lang]="lang()">{{ text() }}</p>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--space-4);
    }
    .owl {
      flex: none;
      display: block;
    }
    .bubble {
      position: relative;
      max-width: 240px;
      padding: 10px var(--space-4);
      box-sizing: border-box;
      border: 2px solid var(--color-primary-400);
      border-radius: 18px;
      background: var(--color-surface);
    }
    .bubble__text {
      display: -webkit-box;
      margin: 0;
      overflow: hidden;
      font: var(--type-body);
      font-weight: 500;
      color: var(--color-text);
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
    .bubble::before {
      content: '';
      position: absolute;
      top: 50%;
      left: -8px;
      width: 12px;
      height: 12px;
      border-left: 2px solid var(--color-primary-400);
      border-bottom: 2px solid var(--color-primary-400);
      background: var(--color-surface);
      transform: translateY(-50%) rotate(45deg);
    }
  `,
})
export class SpeechBubble {
  /** At most 2 lines, 8 words or fewer in kid mode (Guidelines §15). */
  readonly text = input.required<string>();
  /** "hi" for Hindi text (Guidelines §14). */
  readonly lang = input<string | null>(null);
  readonly showOwl = input(true);

  protected readonly owl = illustrationUrl('mascot-owl');
}
