import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { EN, PassageBody, SelectField, SelectOption, TextField, wordCount } from '@fullstar/ui';
import { EDITOR_STYLES, FieldErrors, fieldError } from './editor-shared';

/** A reading passage (Schema §5); the word count is worked out from the text. */
@Component({
  selector: 'app-passage-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SelectField, TextField],
  template: `
    <div class="editor__group" [formGroup]="form">
      <app-text-field
        formControlName="text"
        [label]="text.passageText"
        [rows]="10"
        [maxLength]="5000"
        [lang]="lang()"
        [helper]="text.words(words())"
        [error]="error('body.text') ?? error('body.word_count')"
      />
      <app-select-field
        formControlName="level"
        [label]="text.level"
        [options]="levelOptions"
        [error]="error('body.level')"
      />
    </div>
  `,
  styles: [EDITOR_STYLES],
})
export class PassageEditor {
  readonly value = input.required<PassageBody>();
  readonly readOnly = input(false);
  readonly errors = input<FieldErrors>({});
  readonly lang = input<string | null>(null);
  readonly changed = output<PassageBody>();

  protected readonly text = EN.studio.editor;
  protected readonly levelOptions: readonly SelectOption[] = [1, 2, 3].map((level) => ({
    value: String(level),
    label: this.text.levels[level],
  }));
  protected readonly form = new FormGroup({
    text: new FormControl('', { nonNullable: true }),
    level: new FormControl('1', { nonNullable: true }),
  });
  protected readonly words = signal(0);

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      const body = this.value();
      untracked(() => {
        this.form.setValue({ text: body.text, level: String(body.level) }, { emitEvent: false });
        this.words.set(wordCount(body.text));
      });
    });
    effect(() => {
      if (this.readOnly()) {
        this.form.disable({ emitEvent: false });
      } else {
        this.form.enable({ emitEvent: false });
      }
    });
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const value = this.form.getRawValue();
      const words = wordCount(value.text);
      this.words.set(words);
      this.changed.emit({ text: value.text, word_count: words, level: Number(value.level) });
    });
  }

  protected error(path: string): string | null {
    return fieldError(this.errors(), path);
  }
}
