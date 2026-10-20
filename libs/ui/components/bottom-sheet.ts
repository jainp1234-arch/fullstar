import { ComponentType } from '@angular/cdk/portal';
import { ChangeDetectionStrategy, Component, Injectable, inject, input } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { Observable } from 'rxjs';

/** app-bottom-sheet (Guidelines §11): the layout inside a sheet; handle, title, content. */
@Component({
  selector: 'app-bottom-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="sheet__handle" aria-hidden="true"></span>
    <h2 class="sheet__title">{{ title() }}</h2>
    <ng-content />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .sheet__handle {
      align-self: center;
      width: 40px;
      height: 4px;
      border-radius: var(--radius-pill);
      background: #d9dae0;
    }
    .sheet__title {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
  `,
})
export class AppBottomSheet {
  readonly title = input.required<string>();
}

/** Opens bottom sheets with the shared look; Escape and the scrim close them. */
@Injectable({ providedIn: 'root' })
export class SheetService {
  private readonly sheet = inject(MatBottomSheet);

  /** ariaLabel names the sheet for screen readers; use the sheet's title. */
  open<C, D, R>(
    component: ComponentType<C>,
    data: D,
    ariaLabel: string,
  ): Observable<R | undefined> {
    return this.sheet
      .open<C, D, R>(component, {
        data,
        ariaLabel,
        panelClass: 'app-sheet-panel',
        backdropClass: 'app-dialog-scrim',
        autoFocus: 'first-heading',
        restoreFocus: true,
      })
      .afterDismissed();
  }
}
