import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { AppDialog, Button, EN, TextField, fieldMessage } from '@fullstar/ui';

/** Schema §4.2 content_check_flags.resolution_note varchar(500). */
const NOTE_MAX = 500;

/** S11: the note that accepts a warning. Closes with the note, or nothing on Cancel. */
@Component({
  selector: 'app-accept-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppDialog, Button, ReactiveFormsModule, TextField],
  template: `
    <app-dialog [title]="text.acceptTitle">
      <form class="form" (submit)="$event.preventDefault(); accept()" novalidate>
        <app-text-field
          [formControl]="note"
          [label]="text.note"
          [rows]="3"
          [maxLength]="noteMax"
          [required]="true"
          [error]="error()"
        />
        <app-button type="submit" [label]="text.accept" [fullWidth]="true" />
        <app-button
          variant="secondary"
          [label]="text.cancel"
          [fullWidth]="true"
          (pressed)="ref.close()"
        />
      </form>
    </app-dialog>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
  `,
})
export class AcceptDialog {
  protected readonly text = EN.studio.check;
  protected readonly noteMax = NOTE_MAX;
  protected readonly ref = inject<MatDialogRef<AcceptDialog, string>>(MatDialogRef);
  protected readonly note = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(NOTE_MAX)],
  });
  protected readonly error = signal<string | null>(null);

  protected accept(): void {
    const note = this.note.value.trim();
    if (!note) {
      this.error.set(fieldMessage('REQUIRED'));
      return;
    }
    this.ref.close(note);
  }
}
