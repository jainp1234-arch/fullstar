import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { EN } from '../strings/en';
import { Button } from './button';

/**
 * app-error-bar (Guidelines §12 "Error (parent/studio)", §16): a screen error as an error-100 bar
 * with error-700 text and a "Try again" ghost button. The message defaults to the §16 text.
 */
@Component({
  selector: 'app-error-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <div class="bar" role="alert">
      <p class="bar__text">{{ message() ?? text.somethingFailed }}</p>
      <app-button variant="ghost" [label]="text.tryAgain" (pressed)="retry.emit()" />
    </div>
  `,
  styles: `
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-error-100);
    }
    .bar__text {
      margin: 0;
      font: var(--type-body);
      color: var(--color-error-700);
    }
  `,
})
export class ErrorBar {
  /** A specific explanation; null shows "Something went wrong on our side…". */
  readonly message = input<string | null>(null);
  readonly retry = output<void>();

  protected readonly text = EN.parent;
}
