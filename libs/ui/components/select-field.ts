import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { iconGlyph } from '../icons/icons';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

let nextId = 0;

/**
 * app-select-field: a labelled native select with the text-field look (Guidelines §11), for
 * parent and Studio forms. A form control for reactive forms; values are strings.
 */
@Component({
  selector: 'app-select-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectField), multi: true },
  ],
  template: `
    <label class="field__label" [for]="id">{{ label() }}</label>
    <select
      class="field__input"
      [class.field__input--error]="!!error()"
      [id]="id"
      [attr.aria-invalid]="!!error() || null"
      [attr.aria-describedby]="error() ? id + '-error' : null"
      [disabled]="disabled()"
      (change)="onSelect($event)"
      (blur)="onTouched()"
    >
      @for (option of options(); track option.value) {
        <option [value]="option.value" [selected]="option.value === value()">
          {{ option.label }}
        </option>
      }
    </select>
    @if (error(); as message) {
      <p class="field__error" [id]="id + '-error'">
        <span class="ui-icon field__error-icon" aria-hidden="true">{{ errorGlyph }}</span>
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
    .field__input:focus {
      border: 2px solid var(--color-primary-600);
    }
    .field__input:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .field__input--error {
      border: 2px solid var(--color-error-700);
    }
    .field__input:disabled {
      opacity: 0.6;
    }
    .field__error {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .field__error-icon {
      font-size: 18px;
    }
  `,
})
export class SelectField implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly options = input.required<readonly SelectOption[]>();
  readonly error = input<string | null>(null);

  protected readonly id = `app-select-field-${nextId++}`;
  protected readonly errorGlyph = iconGlyph('error');
  protected readonly value = signal('');
  protected readonly disabled = signal(false);

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

  protected onSelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.value.set(value);
    this.onChange(value);
  }
}
