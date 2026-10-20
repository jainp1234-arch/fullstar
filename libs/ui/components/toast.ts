import { ChangeDetectionStrategy, Component, Injectable, inject } from '@angular/core';
import { MAT_SNACK_BAR_DATA, MatSnackBar, MatSnackBarRef } from '@angular/material/snack-bar';
import { Observable } from 'rxjs';
import { iconGlyph } from '../icons/icons';
import { EN } from '../strings/en';

export type ToastKind = 'info' | 'error';

export interface ToastOptions {
  /** Optional action label, e.g. "Open"; starts with a verb (Guidelines §15). */
  readonly action?: string;
  readonly kind?: ToastKind;
}

interface ToastData {
  readonly message: string;
  readonly action: string | null;
  readonly kind: ToastKind;
}

export interface ToastHandle {
  /** Emits once if the action is pressed. */
  readonly action$: Observable<void>;
  dismiss(): void;
}

/** Guidelines §11: info toasts hide after 4 s; errors stay until dismissed. */
const AUTO_HIDE_MS = 4000;

/** app-toast (Guidelines §11): shown by ToastService in a Material snack bar. */
@Component({
  selector: 'app-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="toast__message">{{ data.message }}</p>
    @if (data.action; as label) {
      <button type="button" class="toast__action" (click)="ref.dismissWithAction()">
        {{ label }}
      </button>
    }
    @if (data.kind === 'error') {
      <button
        type="button"
        class="toast__close"
        [attr.aria-label]="dismissLabel"
        (click)="ref.dismiss()"
      >
        <span class="ui-icon" aria-hidden="true">{{ closeGlyph }}</span>
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-2) var(--space-3) var(--space-4);
      color: #ffffff;
    }
    .toast__message {
      flex: 1;
      margin: 0;
      font: var(--type-body);
    }
    .toast__action,
    .toast__close {
      flex: none;
      min-height: 40px;
      padding: 0 var(--space-3);
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-cyan);
      font: var(--type-label);
      cursor: pointer;
    }
    .toast__close {
      display: grid;
      place-items: center;
      width: 40px;
      padding: 0;
      color: #ffffff;
    }
    .toast__action:focus-visible,
    .toast__close:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
  `,
})
export class Toast {
  protected readonly data = inject<ToastData>(MAT_SNACK_BAR_DATA);
  protected readonly ref = inject<MatSnackBarRef<Toast>>(MatSnackBarRef);
  protected readonly dismissLabel = EN.common.dismiss;
  protected readonly closeGlyph = iconGlyph('close');
}

/** Shows one toast at a time; screen readers hear it through the snack bar's live region. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly snackBar = inject(MatSnackBar);

  show(message: string, options: ToastOptions = {}): ToastHandle {
    const kind = options.kind ?? 'info';
    const ref = this.snackBar.openFromComponent<Toast, ToastData>(Toast, {
      data: { message, action: options.action ?? null, kind },
      duration: kind === 'error' ? undefined : AUTO_HIDE_MS,
      politeness: kind === 'error' ? 'assertive' : 'polite',
      panelClass: 'app-toast-panel',
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
    return { action$: ref.onAction(), dismiss: () => ref.dismiss() };
  }
}
