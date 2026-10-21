import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  Button,
  EN,
  IconButton,
  QuestionContent,
  QuestionType,
  SelectField,
  SelectOption,
  TextField,
} from '@fullstar/ui';
import { EDITOR_STYLES, FieldErrors, fieldError } from './editor-shared';

const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;
const LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Schema §5 limits: answers A–D, 2–5 match pairs. */
const LIMITS: Record<QuestionType, { min: number; max: number }> = {
  mcq: { min: 2, max: 4 },
  true_false: { min: 0, max: 0 },
  fill_blank: { min: 2, max: 4 },
  match: { min: 2, max: 5 },
};

interface ItemForm {
  text: FormControl<string>;
  /** Match only: the partner on the right. */
  right: FormControl<string>;
}

interface QuestionForm {
  prompt: FormControl<string>;
  items: FormArray<FormGroup<ItemForm>>;
  /** Index of the right item, or "true"/"false". */
  correct: FormControl<string>;
  explanation: FormControl<string>;
}

/** The four question types of Schema §5 with their answers and explanation. */
@Component({
  selector: 'app-question-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, IconButton, ReactiveFormsModule, SelectField, TextField],
  template: `
    <div class="editor__group" [formGroup]="form">
      <app-text-field
        formControlName="prompt"
        [label]="text.prompt"
        [rows]="2"
        [maxLength]="300"
        [lang]="lang()"
        [helper]="type() === 'fill_blank' ? text.blankHelper : null"
        [error]="error('body.prompt')"
      />
      @if (type() !== 'true_false') {
        <div class="editor__list" formArrayName="items">
          @for (item of items.controls; track item; let i = $index) {
            <div class="editor__line" [formGroupName]="i">
              @if (type() === 'match') {
                <div class="editor__pair">
                  <app-text-field
                    formControlName="text"
                    [label]="text.left(i + 1)"
                    [maxLength]="80"
                    [lang]="lang()"
                    [error]="error('body.left[' + i + '].text')"
                  />
                  <app-text-field
                    formControlName="right"
                    [label]="text.right(i + 1)"
                    [maxLength]="80"
                    [lang]="lang()"
                    [error]="error('body.right[' + i + '].text')"
                  />
                </div>
              } @else {
                <app-text-field
                  formControlName="text"
                  [label]="itemLabel(i)"
                  [maxLength]="type() === 'mcq' ? 120 : 60"
                  [lang]="lang()"
                  [error]="itemError(i)"
                />
              }
              <app-icon-button
                icon="close"
                [label]="removeLabel(i)"
                [disabled]="readOnly() || items.length <= limits().min"
                (pressed)="removeItem(i)"
              />
            </div>
          }
        </div>
        <app-button
          variant="secondary"
          icon="add"
          [label]="addLabel()"
          [disabled]="readOnly() || items.length >= limits().max"
          (pressed)="addItem()"
        />
      }
      @if (type() !== 'match') {
        <app-select-field
          formControlName="correct"
          [label]="text.correct"
          [options]="correctOptions()"
          [error]="error('solution.correct') ?? error('solution.correct[0]')"
        />
      } @else if (error('solution.pairs'); as message) {
        <p class="editor__error">{{ message }}</p>
      }
      <app-text-field
        formControlName="explanation"
        [label]="text.explanation"
        [rows]="2"
        [maxLength]="500"
        [lang]="lang()"
        [error]="error('solution.explanation')"
      />
    </div>
  `,
  styles: [
    EDITOR_STYLES,
    `
      .editor__list {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
    `,
  ],
})
export class QuestionEditor {
  readonly value = input.required<QuestionContent>();
  readonly readOnly = input(false);
  readonly errors = input<FieldErrors>({});
  readonly lang = input<string | null>(null);
  readonly changed = output<QuestionContent>();

  protected readonly text = EN.studio.editor;
  protected readonly type = computed(() => this.value().type);
  protected readonly limits = computed(() => LIMITS[this.type()]);
  protected readonly form = new FormGroup<QuestionForm>({
    prompt: new FormControl('', { nonNullable: true }),
    items: new FormArray<FormGroup<ItemForm>>([]),
    correct: new FormControl('0', { nonNullable: true }),
    explanation: new FormControl('', { nonNullable: true }),
  });
  protected readonly items = this.form.controls.items;
  /** Bumped on every edit and load so the right-answer list follows the answers' text. */
  private readonly revision = signal(0);
  protected readonly correctOptions = computed<readonly SelectOption[]>(() => {
    this.revision();
    if (this.type() === 'true_false') {
      return [
        { value: 'true', label: this.text.trueLabel },
        { value: 'false', label: this.text.falseLabel },
      ];
    }
    return this.items.controls.map((item, i) => ({
      value: String(i),
      label: `${this.itemLabel(i)}: ${item.controls.text.value}`,
    }));
  });

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      const value = this.value();
      untracked(() => this.load(value));
    });
    effect(() => {
      if (this.readOnly()) {
        this.form.disable({ emitEvent: false });
      } else {
        this.form.enable({ emitEvent: false });
      }
    });
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.revision.update((n) => n + 1);
      this.changed.emit(this.read());
    });
  }

  protected error(path: string): string | null {
    return fieldError(this.errors(), path);
  }

  protected itemError(index: number): string | null {
    return this.type() === 'mcq'
      ? this.error(`body.options[${index}].text`)
      : this.error(`body.choices[${index}]`);
  }

  protected itemLabel(index: number): string {
    return this.type() === 'mcq' ? this.text.option(LETTERS[index]) : this.text.choice(index + 1);
  }

  protected removeLabel(index: number): string {
    switch (this.type()) {
      case 'mcq':
        return this.text.removeOption(LETTERS[index]);
      case 'match':
        return this.text.removePair(index + 1);
      default:
        return this.text.removeChoice(index + 1);
    }
  }

  protected addLabel(): string {
    switch (this.type()) {
      case 'mcq':
        return this.text.addOption;
      case 'match':
        return this.text.addPair;
      default:
        return this.text.addChoice;
    }
  }

  protected addItem(): void {
    this.items.push(item('', ''));
  }

  protected removeItem(index: number): void {
    const correct = Number(this.form.controls.correct.value);
    this.items.removeAt(index, { emitEvent: false });
    if (correct >= this.items.length || correct === index) {
      this.form.controls.correct.setValue('0', { emitEvent: false });
    } else if (correct > index) {
      this.form.controls.correct.setValue(String(correct - 1), { emitEvent: false });
    }
    this.form.updateValueAndValidity();
  }

  private load(value: QuestionContent): void {
    const items = this.items;
    items.clear({ emitEvent: false });
    let correct = '0';
    switch (value.type) {
      case 'mcq':
        value.body.options.forEach((option) =>
          items.push(item(option.text, ''), { emitEvent: false }),
        );
        correct = String(
          Math.max(
            0,
            value.body.options.findIndex((option) => option.id === value.solution.correct[0]),
          ),
        );
        break;
      case 'true_false':
        correct = String(value.solution.correct);
        break;
      case 'fill_blank':
        value.body.choices.forEach((choice) => items.push(item(choice, ''), { emitEvent: false }));
        correct = String(Math.max(0, value.body.choices.indexOf(value.solution.correct)));
        break;
      case 'match': {
        const right = new Map(value.body.right.map((entry) => [entry.id, entry.text]));
        const partner = new Map(value.solution.pairs.map(([l, r]) => [l, right.get(r) ?? '']));
        value.body.left.forEach((entry) =>
          items.push(item(entry.text, partner.get(entry.id) ?? ''), { emitEvent: false }),
        );
        break;
      }
    }
    this.form.patchValue(
      { prompt: value.body.prompt, correct, explanation: value.solution.explanation },
      { emitEvent: false },
    );
    if (this.readOnly()) {
      this.form.disable({ emitEvent: false });
    }
    this.form.updateValueAndValidity({ emitEvent: false });
    this.revision.update((n) => n + 1);
  }

  /** The form as a Schema §5 body and solution; the API reports anything wrong by path. */
  private read(): QuestionContent {
    const form = this.form.getRawValue();
    const texts = form.items.map((entry) => entry.text);
    const index = Number(form.correct);
    switch (this.type()) {
      case 'mcq':
        return {
          type: 'mcq',
          body: {
            prompt: form.prompt,
            image_key: null,
            options: texts.map((text, i) => ({ id: OPTION_IDS[i], text })),
          },
          solution: { correct: [OPTION_IDS[index] ?? 'a'], explanation: form.explanation },
        };
      case 'true_false':
        return {
          type: 'true_false',
          body: { prompt: form.prompt },
          solution: { correct: form.correct === 'true', explanation: form.explanation },
        };
      case 'fill_blank':
        return {
          type: 'fill_blank',
          body: { prompt: form.prompt, choices: texts },
          solution: { correct: texts[index] ?? '', explanation: form.explanation },
        };
      case 'match':
        return {
          type: 'match',
          body: {
            prompt: form.prompt,
            left: form.items.map((entry, i) => ({ id: `l${i + 1}`, text: entry.text })),
            right: form.items.map((entry, i) => ({ id: `r${i + 1}`, text: entry.right })),
          },
          solution: {
            pairs: form.items.map((_, i) => [`l${i + 1}`, `r${i + 1}`] as const),
            explanation: form.explanation,
          },
        };
    }
  }
}

function item(text: string, right: string): FormGroup<ItemForm> {
  return new FormGroup<ItemForm>({
    text: new FormControl(text, { nonNullable: true }),
    right: new FormControl(right, { nonNullable: true }),
  });
}
