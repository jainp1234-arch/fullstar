import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { iconGlyph } from '../icons/icons';
import { EN } from '../strings/en';

const LENGTH = 4;
/** Matches the 240 ms shake in the styles (Guidelines §11 answer-button timing). */
const SHAKE_MS = 240;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * app-pin-pad (Guidelines §11): 4 dots above a 3 × 4 keypad. Emits the PIN once 4 digits are in;
 * the screen calls reject() on a wrong PIN (dots shake, then clear) or clear().
 */
@Component({
  selector: 'app-pin-pad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
  template: `
    <div class="dots" [class.dots--shake]="shaking()" aria-hidden="true">
      @for (filled of dots(); track $index) {
        <span class="dot" [class.dot--filled]="filled"></span>
      }
    </div>
    <p class="ui-visually-hidden" role="status">{{ progress() }}</p>
    <div class="keys">
      @for (key of keys; track key) {
        <button type="button" class="key" [disabled]="disabled()" (click)="press(key)">
          {{ key }}
        </button>
      }
      <span></span>
      <button type="button" class="key" [disabled]="disabled()" (click)="press('0')">0</button>
      <button
        type="button"
        class="key key--icon"
        [attr.aria-label]="deleteLabel"
        [disabled]="disabled() || !entered().length"
        (click)="backspace()"
      >
        <span class="ui-icon" aria-hidden="true">{{ backspaceGlyph }}</span>
      </button>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-6);
    }
    .dots {
      display: flex;
      gap: var(--space-4);
    }
    .dots--shake {
      animation: shake 240ms var(--ease-standard);
    }
    @keyframes shake {
      25%,
      75% {
        transform: translateX(-6px);
      }
      50% {
        transform: translateX(6px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .dots--shake {
        animation: none;
      }
    }
    .dot {
      width: 16px;
      height: 16px;
      box-sizing: border-box;
      border: 2px solid var(--color-primary-600);
      border-radius: 50%;
    }
    .dot--filled {
      background: var(--color-primary-600);
    }
    .keys {
      display: grid;
      grid-template-columns: repeat(3, 72px);
      gap: var(--space-4) var(--space-6);
    }
    .key {
      display: grid;
      place-items: center;
      width: 72px;
      height: 72px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: var(--color-surface);
      box-shadow: var(--edge-card);
      font: var(--type-h1);
      color: var(--color-text);
      cursor: pointer;
      transition: transform calc(var(--dur-press) * 1.5) var(--ease-standard);
    }
    .key:active:not(:disabled) {
      transform: translateY(2px);
      box-shadow: 0 2px 0 var(--color-edge);
      transition-duration: var(--dur-press);
    }
    .key:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .key:disabled {
      opacity: 0.4;
      box-shadow: none;
      cursor: default;
    }
    .key--icon .ui-icon {
      font-size: 28px;
    }
  `,
})
export class PinPad {
  readonly disabled = input(false);
  readonly completed = output<string>();

  protected readonly keys = KEYS;
  protected readonly deleteLabel = EN.forms.pinDelete;
  protected readonly backspaceGlyph = iconGlyph('backspace');
  protected readonly entered = signal('');
  protected readonly shaking = signal(false);
  protected readonly dots = computed(() =>
    Array.from({ length: LENGTH }, (_, i) => i < this.entered().length),
  );
  protected readonly progress = computed(() => EN.forms.pinProgress(this.entered().length, LENGTH));

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  /** Wrong PIN: the dots shake, then clear. */
  reject(): void {
    this.shaking.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.shaking.set(false);
      this.entered.set('');
    }, SHAKE_MS);
  }

  clear(): void {
    this.entered.set('');
  }

  protected press(digit: string): void {
    if (this.disabled() || this.shaking() || this.entered().length >= LENGTH) {
      return;
    }
    const pin = this.entered() + digit;
    this.entered.set(pin);
    if (pin.length === LENGTH) {
      this.completed.emit(pin);
    }
  }

  protected backspace(): void {
    this.entered.update((pin) => pin.slice(0, -1));
  }

  /** Physical keyboards: digits and Backspace work while focus is on the pad. */
  protected onKeydown(event: KeyboardEvent): void {
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      this.press(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      this.backspace();
    }
  }
}
