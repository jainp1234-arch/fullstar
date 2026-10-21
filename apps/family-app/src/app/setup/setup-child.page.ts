import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiError, FamilyApi } from '@fullstar/core';
import {
  AVATAR_KEYS,
  Avatar,
  AvatarKey,
  Button,
  EN,
  TextField,
  errorMessage,
  fieldMessage,
} from '@fullstar/ui';
import { CHOICE_STYLES, PAGE_STYLES } from './page-styles';

/** Schema §4.1 children: first_name 1–40, age 4–12. */
const NAME_MAX = 40;
const AGE_MIN = 4;
const AGE_MAX = 12;
const MAX_CHILDREN = 2;

const AVATARS = new Set<string>(AVATAR_KEYS);

/**
 * B2 Add a child (App Flow §4): first name, age, class and a picture; the class's subjects are
 * shown. A second child can be added; at least one is needed before B3.
 */
@Component({
  selector: 'app-setup-child-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Button, ReactiveFormsModule, TextField],
  template: `
    <h1 class="page__title" tabindex="-1">{{ title }}</h1>
    @if (added().length) {
      <ul class="added" role="list">
        @for (child of added(); track child.id) {
          <li class="added__child">
            <app-avatar [animal]="child.avatar" [size]="40" [decorative]="true" />
            <span>{{ text.childAdded(child.name) }}</span>
          </li>
        }
      </ul>
    }

    @if (full()) {
      <p class="page__intro">{{ text.maxChildrenNote }}</p>
      <app-button [label]="text.continue" [fullWidth]="true" (pressed)="next()" />
    } @else if (showForm()) {
      <p class="page__intro">{{ added().length ? text.secondChildIntro : text.childIntro }}</p>
      <form class="form" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <app-text-field
          formControlName="firstName"
          [label]="text.firstName"
          autocomplete="off"
          [maxLength]="nameMax"
          [required]="true"
          [error]="errorFor('firstName')"
        />
        <app-text-field
          formControlName="age"
          type="tel"
          inputMode="numeric"
          [label]="text.age"
          [helper]="text.ageHelper"
          [maxLength]="2"
          [required]="true"
          [error]="errorFor('age')"
        />
        <fieldset class="choice" [attr.aria-describedby]="classError() ? 'class-error' : null">
          <legend>{{ text.classLabel }}</legend>
          @for (level of classLevels(); track level) {
            <label>
              <input type="radio" formControlName="classLevel" [value]="level" />
              <span>{{ classLabel(level) }}</span>
            </label>
          }
        </fieldset>
        @if (classError(); as message) {
          <p class="page__error" id="class-error">{{ message }}</p>
        }
        @if (subjects().length) {
          <p class="subjects">
            <strong>{{ text.subjectsFor(form.controls.classLevel.value ?? 0) }}:</strong>
            {{ subjects().join(', ') }}
          </p>
        }
        <fieldset class="avatars" [attr.aria-describedby]="avatarError() ? 'avatar-error' : null">
          <legend>{{ text.picture }}</legend>
          @for (avatar of avatars(); track avatar) {
            <label class="avatars__option">
              <input
                type="radio"
                formControlName="avatarKey"
                [value]="avatar"
                [attr.aria-label]="avatarName(avatar)"
              />
              <app-avatar
                [animal]="avatar"
                [size]="64"
                [decorative]="true"
                [selected]="form.controls.avatarKey.value === avatar"
              />
            </label>
          }
        </fieldset>
        @if (avatarError(); as message) {
          <p class="page__error" id="avatar-error">{{ message }}</p>
        }
        @if (failure(); as message) {
          <p class="page__error" role="alert">{{ message }}</p>
        }
        <div class="page__actions">
          <app-button
            type="submit"
            [label]="text.saveChild"
            [fullWidth]="true"
            [loading]="busy()"
          />
          @if (added().length) {
            <app-button
              [label]="text.continue"
              variant="ghost"
              [fullWidth]="true"
              (pressed)="next()"
            />
          }
        </div>
      </form>
    } @else {
      <div class="page__actions">
        <app-button [label]="text.continue" [fullWidth]="true" (pressed)="next()" />
        <app-button
          [label]="text.addAnother"
          variant="secondary"
          [fullWidth]="true"
          (pressed)="addAnother()"
        />
      </div>
    }
  `,
  styles: [
    PAGE_STYLES,
    CHOICE_STYLES,
    `
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .added {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .added__child {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        font: var(--type-body);
        color: var(--color-text);
      }
      .subjects {
        margin: 0;
        font: var(--type-body);
        color: var(--color-text-2);
      }
      .avatars {
        margin: 0;
        padding: 0;
        border: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
        gap: var(--space-3);
      }
      .avatars legend {
        margin-bottom: var(--space-2);
        padding: 0;
        font: var(--type-small);
        color: var(--color-text);
      }
      .avatars__option {
        position: relative;
        display: grid;
        place-items: center;
        min-height: 72px;
        cursor: pointer;
      }
      .avatars__option input {
        position: absolute;
        z-index: 1;
        opacity: 0;
        inset: 0;
        margin: 0;
        cursor: pointer;
      }
      .avatars__option:has(input:focus-visible) {
        outline: 3px solid var(--color-cyan);
        outline-offset: 2px;
        border-radius: 50%;
      }
    `,
  ],
})
export class SetupChildPage {
  protected readonly title = EN.screens.B2;
  protected readonly text = EN.setup;
  protected readonly nameMax = NAME_MAX;
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly serverFields = signal<Readonly<Record<string, string>>>({});
  /** After a save: offer Continue or Add another instead of the form. */
  protected readonly showForm = signal(true);

  protected readonly form = new FormGroup({
    firstName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(NAME_MAX), notBlank],
    }),
    age: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{1,2}$/), ageRange],
    }),
    classLevel: new FormControl<number | null>(null, { validators: [Validators.required] }),
    avatarKey: new FormControl<AvatarKey | null>(null, { validators: [Validators.required] }),
  });

  private readonly family = inject(FamilyApi);
  private readonly router = inject(Router);
  /** From Settings (P14 "Add a child"): back there instead of on to B3. */
  private readonly returnTo = settingsReturn(
    inject(ActivatedRoute).snapshot.queryParamMap.get('next'),
  );
  private readonly destroyRef = inject(DestroyRef);
  private readonly config = toSignal(this.family.publicConfig(), { initialValue: null });
  private readonly classLevelValue = toSignal(this.form.controls.classLevel.valueChanges, {
    initialValue: null,
  });

  protected readonly added = computed(() =>
    (this.family.me()?.children ?? []).map((child) => ({
      id: child.id,
      name: child.first_name,
      avatar: AVATARS.has(child.avatar_key) ? (child.avatar_key as AvatarKey) : 'cat',
    })),
  );
  protected readonly full = computed(() => this.added().length >= MAX_CHILDREN);
  protected readonly classLevels = computed(
    () => this.config()?.classes.map((entry) => entry.class_level) ?? [],
  );
  protected readonly avatars = computed<readonly AvatarKey[]>(() => {
    const fromConfig = (this.config()?.avatars ?? []).filter((key): key is AvatarKey =>
      AVATARS.has(key),
    );
    return fromConfig.length ? fromConfig : AVATAR_KEYS;
  });
  protected readonly subjects = computed(() => {
    const level = this.classLevelValue();
    const entry = this.config()?.classes.find((item) => item.class_level === level);
    return entry?.subjects.map((subject) => subject.name) ?? [];
  });

  protected classLabel(level: number): string {
    return EN.classLevel(level);
  }

  protected avatarName(key: AvatarKey): string {
    return EN.illustrations[`avatar-${key}`];
  }

  protected errorFor(control: 'firstName' | 'age'): string | null {
    const server = this.serverFields()[control === 'firstName' ? 'first_name' : 'age'];
    if (server) {
      return fieldMessage(server);
    }
    const errors = this.form.controls[control].errors;
    if (!this.submitted() || !errors) {
      return null;
    }
    if (errors['required'] || errors['blank']) {
      return EN.errors.fields.required;
    }
    if (errors['maxlength']) {
      return EN.errors.fields.length;
    }
    return EN.errors.fields.range;
  }

  protected classError(): string | null {
    const server = this.serverFields()['class_level'];
    if (server) {
      return fieldMessage(server);
    }
    return this.submitted() && this.form.controls.classLevel.invalid
      ? EN.errors.fields.required
      : null;
  }

  protected avatarError(): string | null {
    const server = this.serverFields()['avatar_key'];
    if (server) {
      return fieldMessage(server);
    }
    return this.submitted() && this.form.controls.avatarKey.invalid
      ? EN.errors.fields.required
      : null;
  }

  protected save(): void {
    this.submitted.set(true);
    this.serverFields.set({});
    this.failure.set(null);
    const { firstName, age, classLevel, avatarKey } = this.form.getRawValue();
    if (this.form.invalid || classLevel === null || avatarKey === null) {
      return;
    }
    this.busy.set(true);
    this.family
      .addChild({
        first_name: firstName.trim(),
        age: Number(age),
        class_level: classLevel,
        avatar_key: avatarKey,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.resetForm();
          this.showForm.set(false);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          if (error instanceof ApiError) {
            this.serverFields.set(error.fields);
            this.failure.set(errorMessage(error.code, 'parent'));
            if (error.code === 'PIN_REQUIRED') {
              void this.router.navigateByUrl('/parent/pin?next=%2Fsetup%2Fchild');
            }
            return;
          }
          this.failure.set(errorMessage('INTERNAL_ERROR', 'parent'));
        },
      });
  }

  protected addAnother(): void {
    this.showForm.set(true);
  }

  protected next(): void {
    void this.router.navigateByUrl(this.returnTo ?? '/setup/books');
  }

  private resetForm(): void {
    this.submitted.set(false);
    this.form.reset({ firstName: '', age: '', classLevel: null, avatarKey: null });
  }
}

function settingsReturn(next: string | null): string | null {
  return next === '/parent/settings' ? next : null;
}

function notBlank(control: AbstractControl<string>): { blank: true } | null {
  return control.value.trim().length ? null : { blank: true };
}

function ageRange(control: AbstractControl<string>): { range: true } | null {
  if (!control.value) {
    return null;
  }
  const age = Number(control.value);
  return age >= AGE_MIN && age <= AGE_MAX ? null : { range: true };
}
