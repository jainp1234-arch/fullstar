import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { iconGlyph } from '../icons/icons';
import { EN } from '../strings/en';

export type ReadAloudSurface = 'sky' | 'white';

/**
 * app-read-aloud (Guidelines §11, §14): top-right of every kid-mode screen. The screen owns the
 * narration and sets speaking; the button only shows it.
 */
@Component({
  selector: 'app-read-aloud',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [class]="'ra ra--' + surface()"
      [class.ra--speaking]="speaking()"
      [attr.aria-label]="label"
      [attr.aria-pressed]="speaking()"
      (click)="pressed.emit()"
    >
      <span class="ui-icon" [class.ui-icon--filled]="speaking()" aria-hidden="true">{{
        glyph
      }}</span>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .ra {
      position: relative;
      display: grid;
      place-items: center;
      width: 56px;
      height: 56px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      cursor: pointer;
    }
    .ra .ui-icon {
      font-size: 28px;
    }
    .ra--sky {
      background: var(--color-sky-pill);
      color: var(--color-text-on-sky);
    }
    .ra--white {
      background: var(--color-primary-100);
      color: var(--color-primary-600);
    }
    .ra:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .ra--speaking::after {
      content: '';
      position: absolute;
      inset: -4px;
      border: 2px solid var(--color-cyan);
      border-radius: 50%;
      animation: pulse 1.2s var(--ease-standard) infinite;
    }
    @keyframes pulse {
      50% {
        transform: scale(1.12);
        opacity: 0.4;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .ra--speaking::after {
        animation: none;
      }
    }
  `,
})
export class ReadAloud {
  readonly speaking = input(false);
  readonly surface = input<ReadAloudSurface>('white');
  readonly pressed = output<void>();

  protected readonly label = EN.a11y.readAloud;
  protected readonly glyph = iconGlyph('volume_up');
}
