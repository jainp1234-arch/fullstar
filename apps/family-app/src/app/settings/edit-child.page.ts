import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiError, ChildChanges, FamilyApi, FamilyChild } from '@fullstar/core';
import {
  AVATAR_KEYS,
  Avatar,
  AvatarKey,
  Button,
  DialogService,
  EN,
  EmptyState,
  SectionHeader,
  TextField,
  ToastService,
  errorMessage,
  fieldMessage,
} from '@fullstar/ui';
import { Observable, filter, switchMap } from 'rxjs';

/** Schema §4.1 children: first_name 1–40, age 4–12, class 1–5. */
const NAME_MAX = 40;
const AGE_MIN = 4;
const AGE_MAX = 12;
const MAX_CLASS = 5;

const AVATARS = new Set<string>(AVATAR_KEYS);

/**
 * P15 Edit child (App Flow §6): name, age, picture; move to the next class after a warning that
 * the class's progress is erased; remove the child.
 */
@Component({
  selector: 'app-edit-child-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Button, EmptyState, ReactiveFormsModule, SectionHeader, TextField],
  template: `
    @if (child(); as current) {
      <p class="intro">{{ text.editIntro }}</p>
      <form class="form" [formGroup]="form" (ngSubmit)="save(current)" novalidate>
        <app-text-field
          formControlName="firstName"
          [label]="setupText.firstName"
          autocomplete="off"
          [maxLength]="nameMax"
          [required]="true"
          [error]="errorFor('firstName')"
        />
        <app-text-field
          formControlName="age"
          type="tel"
          inputMode="numeric"
          [label]="setupText.age"
          [helper]="setupText.ageHelper"
          [maxLength]="2"
          [required]="true"
          [error]="errorFor('age')"
        />
        <fieldset class="avatars">
          <legend>{{ setupText.picture }}</legend>
          @for (avatar of avatars; track avatar) {
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
        @if (failure(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
        <app-button type="submit" [label]="text.save" [fullWidth]="true" [loading]="busy()" />
      </form>

      <app-section-header [title]="classLabel(current.class_level)" />
      @if (current.class_level < maxClass) {
        <p class="intro">{{ text.nextClassNote }}</p>
        <app-button
          [label]="text.nextClass(current.class_level + 1)"
          variant="secondary"
          [fullWidth]="true"
          [disabled]="busy()"
          (pressed)="moveUp(current)"
        />
      } @else {
        <p class="intro">{{ text.highestClass }}</p>
      }

      <div class="remove">
        <app-button
          [label]="text.removeChild"
          variant="danger"
          [fullWidth]="true"
          [disabled]="busy()"
          (pressed)="remove(current)"
        />
      </div>
    } @else {
      <app-empty-state [title]="text.childMissing" [body]="notFound" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .intro {
      margin: 0 0 var(--space-4);
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .error {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
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
    .remove {
      margin-top: var(--space-7);
    }
  `,
})
export class EditChildPage {
  protected readonly text = EN.settings;
  protected readonly setupText = EN.setup;
  protected readonly notFound = EN.errors.parent.notFound;
  protected readonly nameMax = NAME_MAX;
  protected readonly maxClass = MAX_CLASS;
  protected readonly avatars = AVATAR_KEYS;
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly serverFields = signal<Readonly<Record<string, string>>>({});

  protected readonly form = new FormGroup({
    firstName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(NAME_MAX), notBlank],
    }),
    age: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{1,2}$/), ageRange],
    }),
    avatarKey: new FormControl<AvatarKey>('cat', { nonNullable: true }),
  });

  private readonly family = inject(FamilyApi);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('childId') ?? '';

  protected readonly child = computed(
    () => this.family.me()?.children.find((child) => child.id === this.id) ?? null,
  );

  constructor() {
    // Fill the form once the child is known (also after /family/me reloads)
    let filledFor: string | null = null;
    effect(() => {
      const child = this.child();
      if (child && filledFor !== child.id) {
        filledFor = child.id;
        this.form.reset({
          firstName: child.first_name,
          age: String(child.age),
          avatarKey: AVATARS.has(child.avatar_key) ? (child.avatar_key as AvatarKey) : 'cat',
        });
      }
    });
  }

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

  protected save(current: FamilyChild): void {
    this.submitted.set(true);
    this.serverFields.set({});
    this.failure.set(null);
    if (this.form.invalid) {
      return;
    }
    const { firstName, age, avatarKey } = this.form.getRawValue();
    const changes: ChildChanges = {
      first_name: firstName.trim(),
      age: Number(age),
      avatar_key: avatarKey,
    };
    this.run(this.family.updateChild(current.id, changes), () =>
      this.toasts.show(EN.settings.saved),
    );
  }

  protected moveUp(current: FamilyChild): void {
    const next = current.class_level + 1;
    this.confirmThen(
      {
        title: EN.parent.eraseProgressTitle(current.class_level),
        body: this.text.eraseBody(current.class_level),
        confirmLabel: EN.parent.eraseProgress,
        cancelLabel: EN.parent.keepProgress,
        danger: true,
      },
      () => this.family.moveToNextClass(current.id),
      () => this.toasts.show(this.text.moved(current.first_name, next)),
    );
  }

  protected remove(current: FamilyChild): void {
    this.confirmThen(
      {
        title: this.text.removeTitle(current.first_name),
        body: this.text.removeBody,
        confirmLabel: this.text.removeChild,
        cancelLabel: this.text.keepChild,
        danger: true,
      },
      () => this.family.removeChild(current.id),
      () => {
        this.toasts.show(this.text.removed(current.first_name));
        void this.router.navigateByUrl('/parent/settings');
      },
    );
  }

  private confirmThen<T>(
    options: Parameters<DialogService['confirm']>[0],
    action: () => Observable<T>,
    done: () => void,
  ): void {
    this.failure.set(null);
    this.dialogs
      .confirm(options)
      .pipe(
        filter(Boolean),
        switchMap(() => {
          this.busy.set(true);
          return action();
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          done();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private run<T>(request: Observable<T>, done: () => void): void {
    this.busy.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        done();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    if (error instanceof ApiError) {
      this.serverFields.set(error.fields);
    }
    const message = errorMessage(code, 'parent');
    this.failure.set(message);
    this.toasts.show(message, { kind: 'error' });
  }
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
