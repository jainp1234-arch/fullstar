import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconName, iconGlyph } from '../icons/icons';

/** sky: on the sky header; white: on white cards; add: pink "add" inside a count pill. */
export type IconButtonSurface = 'sky' | 'white' | 'add';

/** app-icon-button (Guidelines §10, §11). */
@Component({
  selector: 'app-icon-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [class]="'icon-btn icon-btn--' + surface()"
      [attr.aria-label]="label()"
      [disabled]="disabled()"
      (click)="pressed.emit($event)"
    >
      <span class="ui-icon" [class.ui-icon--filled]="filled()" aria-hidden="true">{{
        glyph()
      }}</span>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .icon-btn {
      display: inline-grid;
      place-items: center;
      width: var(--tap-default);
      height: var(--tap-default);
      padding: 0;
      border: 0;
      border-radius: var(--radius-pill);
      cursor: pointer;
      transition: transform var(--dur-press) var(--ease-standard);
    }
    :host-context([data-mode='kid']) .icon-btn:not(.icon-btn--add) {
      width: var(--tap-kid);
      height: var(--tap-kid);
    }
    .icon-btn--sky {
      background: transparent;
      color: var(--color-text-on-sky);
      box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.5);
    }
    .icon-btn--sky .ui-icon {
      font-size: 28px;
    }
    .icon-btn--white {
      background: var(--color-primary-100);
      color: var(--color-primary-600);
    }
    .icon-btn--add {
      width: var(--space-8);
      height: var(--space-8);
      background: var(--color-pink);
      color: var(--color-surface);
    }
    .icon-btn:not(:disabled):active {
      transform: translateY(2px);
    }
    .icon-btn:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
  `,
})
export class IconButton {
  readonly icon = input.required<IconName>();
  /** Accessible name; icon buttons have no visible text. */
  readonly label = input.required<string>();
  readonly surface = input<IconButtonSurface>('white');
  readonly filled = input(false);
  readonly disabled = input(false);
  readonly pressed = output<MouseEvent>();

  protected readonly glyph = computed(() => iconGlyph(this.icon()));
}
