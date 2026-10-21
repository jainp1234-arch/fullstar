import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  Button,
  EN,
  ILLUSTRATION_KEYS,
  IconButton,
  LessonBody,
  LessonScene,
  SCENE_ANIMATIONS,
  SceneAnimation,
  SelectField,
  SelectOption,
  TextField,
} from '@fullstar/ui';
import { EDITOR_STYLES, FieldErrors, fieldError } from './editor-shared';

const MAX_SCENES = 40;
const NO_PICTURE = '';

type SceneKind = 'narration' | 'quiz';

interface SceneForm {
  id: FormControl<string>;
  kind: FormControl<SceneKind>;
  text: FormControl<string>;
  seconds: FormControl<string>;
  illustration: FormControl<string>;
  animation: FormControl<SceneAnimation>;
  question: FormControl<string>;
}

/** Lesson scenes (Schema §5): narration with an optional picture, or an inline quiz question. */
@Component({
  selector: 'app-lesson-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, IconButton, ReactiveFormsModule, SelectField, TextField],
  template: `
    <h2 class="editor__heading">{{ text.scenes }}</h2>
    @for (scene of scenes.controls; track scene; let i = $index) {
      <fieldset class="editor__group" [formGroup]="scene">
        <legend class="editor__legend">{{ text.scene(i + 1) }}</legend>
        <div class="editor__row-actions">
          <app-icon-button
            icon="chevron_right"
            class="rotate-up"
            [label]="text.moveUp(i + 1)"
            [disabled]="readOnly() || i === 0"
            (pressed)="move(i, -1)"
          />
          <app-icon-button
            icon="chevron_right"
            class="rotate-down"
            [label]="text.moveDown(i + 1)"
            [disabled]="readOnly() || i === scenes.length - 1"
            (pressed)="move(i, 1)"
          />
          <app-icon-button
            icon="close"
            [label]="text.removeScene(i + 1)"
            [disabled]="readOnly() || scenes.length === 1"
            (pressed)="remove(i)"
          />
        </div>
        <app-select-field formControlName="kind" [label]="text.sceneKind" [options]="kindOptions" />
        @if (scene.controls.kind.value === 'narration') {
          <app-text-field
            formControlName="text"
            [label]="text.narration"
            [rows]="3"
            [maxLength]="500"
            [lang]="lang()"
            [error]="error('body.scenes[' + i + '].text')"
          />
          <div class="editor__pair">
            <app-select-field
              formControlName="illustration"
              [label]="text.illustration"
              [options]="pictureOptions"
              [error]="error('body.scenes[' + i + '].visual.illustration')"
            />
            <app-select-field
              formControlName="animation"
              [label]="text.animation"
              [options]="animationOptions"
            />
          </div>
        } @else {
          <app-text-field
            formControlName="question"
            [label]="text.quizQuestion"
            autocomplete="off"
            [error]="error('body.scenes[' + i + '].quiz.question_item_id')"
          />
        }
        <app-text-field
          formControlName="seconds"
          [label]="text.seconds"
          inputMode="numeric"
          [error]="error('body.scenes[' + i + '].duration_ms')"
        />
      </fieldset>
    }
    @if (error('body.scenes'); as message) {
      <p class="editor__error">{{ message }}</p>
    }
    <app-button
      variant="secondary"
      icon="add"
      [label]="text.addScene"
      [disabled]="readOnly() || scenes.length >= maxScenes"
      (pressed)="add()"
    />
  `,
  styles: [
    EDITOR_STYLES,
    `
      .rotate-up {
        transform: rotate(-90deg);
      }
      .rotate-down {
        transform: rotate(90deg);
      }
    `,
  ],
})
export class LessonEditor {
  readonly value = input.required<LessonBody>();
  readonly readOnly = input(false);
  readonly errors = input<FieldErrors>({});
  readonly lang = input<string | null>(null);
  readonly changed = output<LessonBody>();

  protected readonly text = EN.studio.editor;
  protected readonly maxScenes = MAX_SCENES;
  protected readonly kindOptions: readonly SelectOption[] = [
    { value: 'narration', label: this.text.sceneKinds.narration },
    { value: 'quiz', label: this.text.sceneKinds.quiz },
  ];
  protected readonly pictureOptions: readonly SelectOption[] = [
    { value: NO_PICTURE, label: this.text.noIllustration },
    ...ILLUSTRATION_KEYS.map((key) => ({ value: key, label: EN.illustrations[key] })),
  ];
  protected readonly animationOptions: readonly SelectOption[] = SCENE_ANIMATIONS.map(
    (animation) => ({ value: animation, label: this.text.animations[animation] }),
  );
  protected readonly scenes = new FormArray<FormGroup<SceneForm>>([]);

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      const body = this.value();
      untracked(() => this.load(body));
    });
    effect(() => {
      if (this.readOnly()) {
        this.scenes.disable({ emitEvent: false });
      } else {
        this.scenes.enable({ emitEvent: false });
      }
    });
    this.scenes.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.changed.emit(this.read()));
  }

  protected error(path: string): string | null {
    return fieldError(this.errors(), path);
  }

  protected add(): void {
    this.scenes.push(this.group({ id: this.freeId(), duration_ms: 5000, text: '' }));
  }

  protected remove(index: number): void {
    this.scenes.removeAt(index);
  }

  protected move(index: number, delta: number): void {
    const scene = this.scenes.at(index);
    this.scenes.removeAt(index, { emitEvent: false });
    this.scenes.insert(index + delta, scene);
  }

  private load(body: LessonBody): void {
    this.scenes.clear({ emitEvent: false });
    for (const scene of body.scenes) {
      this.scenes.push(this.group(scene), { emitEvent: false });
    }
    if (this.readOnly()) {
      this.scenes.disable({ emitEvent: false });
    }
  }

  private group(scene: LessonScene): FormGroup<SceneForm> {
    const nonNullable = { nonNullable: true } as const;
    return new FormGroup<SceneForm>({
      id: new FormControl(scene.id, nonNullable),
      kind: new FormControl<SceneKind>(scene.quiz ? 'quiz' : 'narration', nonNullable),
      text: new FormControl(scene.text ?? '', nonNullable),
      seconds: new FormControl(String(scene.duration_ms / 1000), nonNullable),
      illustration: new FormControl(scene.visual?.illustration ?? NO_PICTURE, nonNullable),
      animation: new FormControl<SceneAnimation>(scene.visual?.animation ?? 'fade-up', nonNullable),
      question: new FormControl(scene.quiz?.question_item_id ?? '', nonNullable),
    });
  }

  private freeId(): string {
    const used = new Set(this.scenes.controls.map((scene) => scene.controls.id.value));
    let n = this.scenes.length + 1;
    while (used.has(`s${n}`)) {
      n++;
    }
    return `s${n}`;
  }

  /** The form as a Schema §5 body; the API reports anything wrong with field paths. */
  private read(): LessonBody {
    return {
      scenes: this.scenes.getRawValue().map((scene) => {
        const seconds = Number(scene.seconds.replace(',', '.'));
        const duration = Number.isFinite(seconds) ? Math.round(seconds * 1000) : -1;
        if (scene.kind === 'quiz') {
          return {
            id: scene.id,
            duration_ms: duration,
            quiz: { question_item_id: scene.question.trim() },
          };
        }
        return {
          id: scene.id,
          duration_ms: duration,
          text: scene.text,
          visual:
            scene.illustration === NO_PICTURE
              ? null
              : { illustration: scene.illustration, animation: scene.animation },
        };
      }),
    };
  }
}
