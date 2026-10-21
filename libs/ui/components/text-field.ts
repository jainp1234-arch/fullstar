import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { iconGlyph } from '../icons/icons';

export type TextFieldType = 'text' | 'email' | 'tel' | 'password' | 'search';

let nextId = 0;

/**
 * app-text-field (Guidelines §11): label above, helper or error below. A form control for
 * reactive forms; the screen maps control errors to a message from the strings file.
 */
@Component({
  selector: 'app-text-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TextField), multi: true },
  ],
  template: `
    <label class="field__label" [for]="id">{{ label() }}</label>
    @if (rows() > 1) {
      <textarea
        class="field__input field__input--multi"
        [class.field__input--error]="!!error()"
        [id]="id"
        [rows]="rows()"
        [attr.maxlength]="maxLength()"
        [attr.aria-invalid]="!!error() || null"
        [attr.aria-describedby]="describedBy()"
        [attr.lang]="lang()"
        [required]="required()"
        [disabled]="disabled()"
        [value]="value()"
        (input)="onInput($event)"
        (blur)="onTouched()"
      ></textarea>
    } @else {
      <input
        class="field__input"
        [class.field__input--error]="!!error()"
        [id]="id"
        [attr.type]="type()"
        [attr.inputmode]="inputMode()"
        [attr.autocomplete]="autocomplete()"
        [attr.maxlength]="maxLength()"
        [attr.aria-invalid]="!!error() || null"
        [attr.aria-describedby]="describedBy()"
        [required]="required()"
        [disabled]="disabled()"
        [value]="value()"
        (input)="onInput($event)"
        (blur)="onTouched()"
        [attr.lang]="lang()"
      />
    }
    @if (error(); as message) {
      <p class="field__error" [id]="id + '-error'">
        <span class="ui-icon field__error-icon" aria-hidden="true">{{ errorGlyph }}</span>
        {{ message }}
      </p>
    } @else if (helper(); as text) {
      <p class="field__helper" [id]="id + '-helper'">{{ text }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .field__label {
      font: var(--type-small);
      color: var(--color-text);
    }
    .field__input {
      height: 52px;
      padding: 0 var(--space-4);
      box-sizing: border-box;
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      font: var(--type-body);
      color: var(--color-text);
    }
    .field__input--multi {
      height: auto;
      min-height: 104px;
      padding: var(--space-3) var(--space-4);
      resize: vertical;
      line-height: 1.5;
    }
    .field__input.field__input--multi:focus {
      padding: calc(var(--space-3) - 0.5px) calc(var(--space-4) - 0.5px);
    }
    .field__input:focus {
      border: 2px solid var(--color-primary-600);
      padding: 0 calc(var(--space-4) - 0.5px);
    }
    .field__input:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .field__input--error,
    .field__input--error:focus {
      border: 2px solid var(--color-error-700);
      padding: 0 calc(var(--space-4) - 0.5px);
    }
    .field__input:disabled {
      opacity: 0.4;
    }
    .field__error,
    .field__helper {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      margin: 0;
      font: var(--type-small);
      font-weight: 400;
    }
    .field__error {
      color: var(--color-error-700);
    }
    .field__error-icon {
      font-size: 18px;
    }
    .field__helper {
      color: var(--color-text-2);
    }
  `,
})
export class TextField implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly type = input<TextFieldType>('text');
  readonly helper = input<string | null>(null);
  /** The message to show; set by the screen from the control's errors. */
  readonly error = input<string | null>(null);
  readonly autocomplete = input<string | null>(null);
  readonly inputMode = input<string | null>(null);
  readonly maxLength = input<number | null>(null);
  readonly required = input(false);
  /** More than 1: a multi-line text area with that many visible rows. */
  readonly rows = input(1);
  /** "hi" for Hindi text (Guidelines §14). */
  readonly lang = input<string | null>(null);

  protected readonly id = `app-text-field-${nextId++}`;
  protected readonly errorGlyph = iconGlyph('error');
  protected readonly value = signal('');
  protected readonly disabled = signal(false);
  protected readonly describedBy = computed(() => {
    if (this.error()) {
      return `${this.id}-error`;
    }
    return this.helper() ? `${this.id}-helper` : null;
  });

  private onChange: (value: string) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
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

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.value.set(value);
    this.onChange(value);
  }
}
