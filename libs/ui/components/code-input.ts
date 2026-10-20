import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  forwardRef,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { iconGlyph } from '../icons/icons';
import { EN } from '../strings/en';

const LENGTH = 6;
let nextId = 0;

/**
 * app-code-input (Guidelines §11): 6 boxes for the email code. Typing advances, backspace goes
 * back, paste (or one-time-code autofill) fills every box. Value is the digits typed so far.
 */
@Component({
  selector: 'app-code-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CodeInput), multi: true },
  ],
  template: `
    <div class="code" role="group" [attr.aria-label]="label()">
      @for (digit of digits(); track $index) {
        <input
          #box
          class="code__box"
          [class.code__box--error]="!!error()"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          [attr.autocomplete]="$index === 0 ? 'one-time-code' : 'off'"
          [attr.aria-label]="digitLabel($index)"
          [attr.aria-invalid]="!!error() || null"
          [attr.aria-describedby]="error() ? errorId : null"
          [disabled]="disabled()"
          [value]="digit"
          (input)="onInput($index, $event)"
          (keydown)="onKeydown($index, $event)"
          (paste)="onPaste($index, $event)"
          (focus)="select($event)"
          (blur)="onTouched()"
        />
      }
    </div>
    @if (error(); as message) {
      <p class="code__error" [id]="errorId">
        <span class="ui-icon code__error-icon" aria-hidden="true">{{ errorGlyph }}</span>
        {{ message }}
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .code {
      display: flex;
      gap: var(--space-2);
    }
    .code__box {
      width: 48px;
      height: 56px;
      padding: 0;
      box-sizing: border-box;
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      font: var(--type-h1);
      color: var(--color-text);
      text-align: center;
    }
    .code__box:focus {
      border: 2px solid var(--color-primary-600);
    }
    .code__box:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .code__box--error,
    .code__box--error:focus {
      border: 2px solid var(--color-error-700);
    }
    .code__box:disabled {
      opacity: 0.4;
    }
    .code__error {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      margin: 0;
      font: var(--type-small);
      font-weight: 400;
      color: var(--color-error-700);
    }
    .code__error-icon {
      font-size: 18px;
    }
  `,
})
export class CodeInput implements ControlValueAccessor {
  readonly label = input<string>(EN.forms.codeLabel);
  readonly error = input<string | null>(null);
  /** Emits the full code once all 6 digits are in. */
  readonly completed = output<string>();

  protected readonly digits = signal<readonly string[]>(Array(LENGTH).fill(''));
  protected readonly disabled = signal(false);
  protected readonly errorId = `app-code-input-${nextId++}-error`;
  protected readonly errorGlyph = iconGlyph('error');
  private readonly code = computed(() => this.digits().join(''));
  private readonly boxes = viewChildren<ElementRef<HTMLInputElement>>('box');

  private onChange: (value: string) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    const clean = onlyDigits(value ?? '').slice(0, LENGTH);
    this.digits.set(Array.from({ length: LENGTH }, (_, i) => clean[i] ?? ''));
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  /** Clears every box and focuses the first, e.g. after a wrong code. */
  clear(): void {
    this.update(Array(LENGTH).fill(''));
    this.focus(0);
  }

  protected digitLabel(index: number): string {
    return EN.forms.codeDigit(index + 1, LENGTH);
  }

  protected onInput(index: number, event: Event): void {
    const box = event.target as HTMLInputElement;
    const typed = onlyDigits(box.value);
    if (typed.length > 1) {
      // Autofill can put the whole code into one box
      this.fillFrom(index, typed);
      return;
    }
    box.value = typed;
    const next = [...this.digits()];
    next[index] = typed;
    this.update(next);
    if (typed && index < LENGTH - 1) {
      this.focus(index + 1);
    }
  }

  protected onKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.digits()[index] && index > 0) {
      event.preventDefault();
      const next = [...this.digits()];
      next[index - 1] = '';
      this.update(next);
      this.focus(index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      this.focus(index - 1);
    } else if (event.key === 'ArrowRight' && index < LENGTH - 1) {
      event.preventDefault();
      this.focus(index + 1);
    }
  }

  protected onPaste(index: number, event: ClipboardEvent): void {
    event.preventDefault();
    this.fillFrom(index, onlyDigits(event.clipboardData?.getData('text') ?? ''));
  }

  protected select(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  private fillFrom(index: number, text: string): void {
    // A full-length paste is the whole code, wherever it lands
    const start = text.length >= LENGTH ? 0 : index;
    const next = [...this.digits()];
    for (let i = 0; i < text.length && start + i < LENGTH; i++) {
      next[start + i] = text[i];
    }
    this.update(next);
    this.syncBoxes();
    this.focus(Math.min(start + text.length, LENGTH - 1));
  }

  private update(next: readonly string[]): void {
    this.digits.set(next);
    const code = this.code();
    this.onChange(code);
    if (code.length === LENGTH) {
      this.completed.emit(code);
    }
  }

  /** Keeps the DOM in step when a box already showed the value being replaced. */
  private syncBoxes(): void {
    const digits = this.digits();
    this.boxes().forEach((box, i) => (box.nativeElement.value = digits[i]));
  }

  private focus(index: number): void {
    this.boxes()[index]?.nativeElement.focus();
  }
}

function onlyDigits(text: string): string {
  return text.replace(/\D/g, '');
}
