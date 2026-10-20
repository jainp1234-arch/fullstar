import { ComponentType } from '@angular/cdk/portal';
import { ChangeDetectionStrategy, Component, Injectable, inject, input } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { Observable, map } from 'rxjs';
import { Button } from './button';

/**
 * app-dialog (Guidelines §11): the layout inside a dialog. Title, body, then buttons stacked on
 * phone with the primary on top (libs/ui/styles/material.css). Put the buttons in an element with
 * the dialog-actions attribute, primary first.
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle],
  template: `
    <h2 mat-dialog-title class="dialog__title">{{ title() }}</h2>
    <div class="dialog__body"><ng-content /></div>
    <div class="dialog__actions"><ng-content select="[dialog-actions]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-6);
    }
    :host .dialog__title {
      margin: 0;
      padding: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
    :host .dialog__title::before {
      display: none;
    }
    .dialog__body {
      font: var(--type-body);
      color: var(--color-text-2);
    }
  `,
})
export class AppDialog {
  readonly title = input.required<string>();
}

export interface ConfirmOptions {
  /** States the result, e.g. "Erase Class 3 progress?" (Guidelines §16). */
  readonly title: string;
  /** What is lost or what happens. */
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Destructive: the confirm button uses the danger style. */
  readonly danger?: boolean;
}

/** The confirm dialog opened by DialogService.confirm(). */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppDialog, Button],
  template: `
    <app-dialog [title]="options.title">
      <p class="confirm__body">{{ options.body }}</p>
      <div dialog-actions>
        <app-button
          [label]="options.confirmLabel"
          [variant]="options.danger ? 'danger' : 'primary'"
          [fullWidth]="true"
          (pressed)="ref.close(true)"
        />
        <app-button
          [label]="options.cancelLabel"
          variant="secondary"
          [fullWidth]="true"
          (pressed)="ref.close(false)"
        />
      </div>
    </app-dialog>
  `,
  styles: `
    .confirm__body {
      margin: 0;
    }
  `,
})
export class ConfirmDialog {
  protected readonly options = inject<ConfirmOptions>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<ConfirmDialog, boolean>>(MatDialogRef);
}

/** Opens dialogs with the shared look; focus is trapped inside and returns on close (§14). */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(MatDialog);

  open<C, D, R>(component: ComponentType<C>, data: D): Observable<R | undefined> {
    return this.dialog
      .open<C, D, R>(component, {
        data,
        panelClass: 'app-dialog-panel',
        backdropClass: 'app-dialog-scrim',
        width: 'calc(100vw - 32px)',
        maxWidth: '400px',
        autoFocus: 'first-heading',
        restoreFocus: true,
      })
      .afterClosed();
  }

  /** Emits true only when the confirm button is pressed. */
  confirm(options: ConfirmOptions): Observable<boolean> {
    return this.open<ConfirmDialog, ConfirmOptions, boolean>(ConfirmDialog, options).pipe(
      map((result) => result === true),
    );
  }
}
