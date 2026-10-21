import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ApiError, StaffMember, StaffRole, StudioApi } from '@fullstar/core';
import { AppDialog, Button, EN, TextField, errorMessage, fieldMessage } from '@fullstar/ui';
import { Observable } from 'rxjs';

/** Schema §4.1 staff_users.display_name varchar(80); emails up to 254 characters. */
const NAME_MAX = 80;
const EMAIL_MAX = 254;
const ROLES: readonly StaffRole[] = ['content_admin', 'super_admin'];

export interface StaffDialogData {
  /** Absent: add a new staff member. */
  readonly member?: StaffMember;
  /** The signed-in super admin: their own role and access can't change. */
  readonly meId: string;
}

/** S13 add or change a staff member. Closes with the saved row. */
@Component({
  selector: 'app-staff-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppDialog, Button, ReactiveFormsModule, TextField],
  template: `
    <app-dialog [title]="title">
      <form class="form" [formGroup]="form" (ngSubmit)="save()" novalidate>
        @if (!data.member) {
          <p class="intro">{{ text.addIntro }}</p>
          <app-text-field
            formControlName="email"
            type="email"
            autocomplete="off"
            [label]="text.email"
            [maxLength]="emailMax"
            [required]="true"
            [error]="error('email')"
          />
        }
        <app-text-field
          formControlName="displayName"
          autocomplete="off"
          [label]="text.name"
          [maxLength]="nameMax"
          [required]="true"
          [error]="error('displayName')"
        />
        <fieldset class="choice">
          <legend class="choice__legend">{{ text.role }}</legend>
          @for (role of roles; track role) {
            <label class="choice__option">
              <input type="radio" formControlName="role" [value]="role" />
              <span>{{ roleNames[role] }}</span>
            </label>
          }
        </fieldset>
        @if (data.member) {
          <label class="choice__option">
            <input type="checkbox" formControlName="active" />
            <span>{{ text.active }}</span>
          </label>
        }
        @if (self) {
          <p class="note">{{ text.notYourself }}</p>
        }
        @if (failure(); as message) {
          <p class="failure" role="alert">{{ message }}</p>
        }
        <div class="actions">
          <app-button
            type="submit"
            [label]="text.save"
            [loading]="busy()"
            [disabled]="busy()"
            [fullWidth]="true"
          />
          <app-button
            variant="secondary"
            [label]="text.cancel"
            [fullWidth]="true"
            (pressed)="ref.close()"
          />
        </div>
      </form>
    </app-dialog>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .intro,
    .note {
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .choice {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .choice__legend {
      margin-bottom: var(--space-2);
      padding: 0;
      font: var(--type-label);
      color: var(--color-text);
    }
    .choice__option {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-height: 48px;
      font: var(--type-body);
      color: var(--color-text);
      cursor: pointer;
    }
    .choice__option input {
      flex: none;
      width: 24px;
      height: 24px;
      margin: 0;
      accent-color: var(--color-primary-600);
    }
    .choice__option input:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .failure {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
  `,
})
export class StaffDialog {
  protected readonly data = inject<StaffDialogData>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<StaffDialog, StaffMember>>(MatDialogRef);
  protected readonly text = EN.studio.staff;
  protected readonly roleNames = EN.auth.roles;
  protected readonly roles = ROLES;
  protected readonly nameMax = NAME_MAX;
  protected readonly emailMax = EMAIL_MAX;
  protected readonly self = this.data.member?.id === this.data.meId;
  protected readonly title = this.data.member
    ? this.text.editTitle(this.data.member.display_name)
    : this.text.addTitle;
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  private readonly serverFields = signal<Readonly<Record<string, string>>>({});
  private readonly submitted = signal(false);

  private readonly studio = inject(StudioApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: this.data.member
        ? []
        : [Validators.required, Validators.email, Validators.maxLength(EMAIL_MAX)],
    }),
    displayName: new FormControl(this.data.member?.display_name ?? '', {
      nonNullable: true,
      validators: [Validators.required, notBlank, Validators.maxLength(NAME_MAX)],
    }),
    role: new FormControl<StaffRole>(this.data.member?.role ?? 'content_admin', {
      nonNullable: true,
    }),
    active: new FormControl(this.data.member?.active ?? true, { nonNullable: true }),
  });

  constructor() {
    if (this.self) {
      this.form.controls.active.disable();
      this.form.controls.role.disable();
    }
  }

  protected error(name: 'email' | 'displayName'): string | null {
    const server = this.serverFields()[name === 'email' ? 'email' : 'display_name'];
    if (server) {
      return fieldMessage(server);
    }
    const control = this.form.controls[name];
    if (!control.errors || !(control.touched || this.submitted())) {
      return null;
    }
    if (control.errors['required'] || control.errors['blank']) {
      return fieldMessage('REQUIRED');
    }
    return control.errors['maxlength'] ? fieldMessage('INVALID_LENGTH') : fieldMessage('INVALID');
  }

  protected save(): void {
    this.submitted.set(true);
    this.serverFields.set({});
    this.failure.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const name = value.displayName.trim();
    let request: Observable<StaffMember>;
    const member = this.data.member;
    if (member) {
      request = this.studio.updateStaff(member.id, {
        ...(name !== member.display_name ? { display_name: name } : {}),
        ...(!this.self && value.role !== member.role ? { role: value.role } : {}),
        ...(!this.self && value.active !== member.active ? { active: value.active } : {}),
      });
    } else {
      request = this.studio.addStaff({
        email: value.email.trim(),
        display_name: name,
        role: value.role,
      });
    }
    this.busy.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => this.ref.close(saved),
      error: (error: unknown) => {
        this.busy.set(false);
        if (!(error instanceof ApiError)) {
          this.failure.set(errorMessage('INTERNAL_ERROR', 'studio'));
          return;
        }
        this.serverFields.set(error.fields);
        if (error.code === 'CONFLICT') {
          this.failure.set(member ? this.text.notYourself : this.text.alreadyStaff);
        } else {
          this.failure.set(errorMessage(error.code, 'studio'));
        }
      },
    });
  }
}

function notBlank(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim().length ? null : { blank: true };
}
