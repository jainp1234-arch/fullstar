import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconName, iconGlyph } from '../icons/icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** app-button (Guidelines §11). danger is for parent mode and the Studio only. */
@Component({
  selector: 'app-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.full]': 'fullWidth()' },
  template: `
    <button
      [class]="'btn btn--' + variant()"
      [attr.type]="type()"
      [disabled]="disabled() || loading()"
      [attr.aria-busy]="loading() || null"
      (click)="pressed.emit($event)"
    >
      @if (loading()) {
        <span class="spinner" aria-hidden="true"></span>
        <span class="visually-hidden">{{ label() }}</span>
      } @else {
        @if (icon(); as name) {
          <span class="ui-icon btn__icon" aria-hidden="true">{{ glyph() }}</span>
        }
        <span class="btn__label">{{ label() }}</span>
      }
    </button>
  `,
  styles: `
    :host {
      display: inline-block;
    }
    :host(.full) {
      display: block;
    }
    .btn {
      --edge-color: transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      width: 100%;
      height: var(--tap-default);
      padding: 0 var(--space-6);
      border: 0;
      border-radius: var(--radius-lg);
      font: var(--type-label);
      cursor: pointer;
      box-shadow: 0 4px 0 var(--edge-color);
      transition:
        transform calc(var(--dur-press) * 1.5) var(--ease-standard),
        box-shadow calc(var(--dur-press) * 1.5) var(--ease-standard);
    }
    :host-context([data-mode='kid']) .btn {
      height: var(--tap-kid);
    }
    .btn--primary {
      --edge-color: var(--color-primary-800);
      background: var(--color-primary-600);
      color: var(--color-text-on-sky);
    }
    .btn--secondary {
      --edge-color: var(--color-primary-400);
      background: var(--color-surface);
      color: var(--color-primary-600);
      box-shadow:
        inset 0 0 0 2px var(--color-primary-600),
        0 4px 0 var(--edge-color);
    }
    .btn--ghost {
      background: transparent;
      color: var(--color-primary-600);
      box-shadow: none;
    }
    .btn--danger {
      --edge-color: var(--color-danger-edge);
      background: var(--color-error-700);
      color: var(--color-text-on-sky);
    }
    .btn:not(:disabled):active {
      transform: translateY(2px);
      box-shadow: 0 2px 0 var(--edge-color);
      transition-duration: var(--dur-press);
    }
    .btn--secondary:not(:disabled):active {
      box-shadow:
        inset 0 0 0 2px var(--color-primary-600),
        0 2px 0 var(--edge-color);
    }
    .btn:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .btn:disabled {
      opacity: 0.4;
      cursor: default;
      box-shadow: none;
    }
    .btn--secondary:disabled {
      box-shadow: inset 0 0 0 2px var(--color-primary-600);
    }
    .btn__icon {
      font-size: 24px;
    }
    .spinner {
      width: 20px;
      height: 20px;
      border-radius: var(--radius-pill);
      border: 2px solid currentColor;
      border-right-color: transparent;
      animation: spin var(--dur-celebrate) linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner {
        animation: none;
      }
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  `,
})
export class Button {
  readonly label = input.required<string>();
  readonly variant = input<ButtonVariant>('primary');
  readonly type = input<'button' | 'submit'>('button');
  readonly icon = input<IconName | null>(null);
  readonly disabled = input(false);
  readonly loading = input(false);
  /** Full width (phone, Focus and Celebration shells). */
  readonly fullWidth = input(false);
  readonly pressed = output<MouseEvent>();

  protected readonly glyph = computed(() => {
    const name = this.icon();
    return name ? iconGlyph(name) : '';
  });
}
