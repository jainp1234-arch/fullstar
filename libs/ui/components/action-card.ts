import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconName, iconGlyph } from '../icons/icons';

/** app-action-card (Guidelines §11): parent Settings and Progress shortcuts. Place in .ui-action-grid. */
@Component({
  selector: 'app-action-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="action" (click)="pressed.emit($event)">
      <span class="ui-icon action__icon" aria-hidden="true">{{ glyph() }}</span>
      <span class="action__label">{{ label() }}</span>
    </button>
  `,
  styles: `
    :host {
      display: block;
    }
    .action {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      width: 100%;
      min-height: 88px;
      padding: var(--space-4);
      box-sizing: border-box;
      border: 0;
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
      color: var(--color-text);
      text-align: left;
      cursor: pointer;
      transition:
        transform var(--dur-fast) var(--ease-standard),
        box-shadow var(--dur-fast) var(--ease-standard);
    }
    @media (hover: hover) {
      .action:hover {
        transform: translateY(-1px);
        box-shadow: var(--shadow-soft), var(--shadow-soft);
      }
    }
    .action:active {
      transform: translateY(2px);
      transition-duration: var(--dur-press);
    }
    .action:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .action__icon {
      font-size: 28px;
      color: var(--color-primary-600);
    }
    .action__label {
      font: var(--type-label);
      font-weight: 500;
    }
  `,
})
export class ActionCard {
  readonly icon = input.required<IconName>();
  readonly label = input.required<string>();
  readonly pressed = output<MouseEvent>();

  protected readonly glyph = computed(() => iconGlyph(this.icon()));
}
