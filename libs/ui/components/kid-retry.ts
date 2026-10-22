import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { illustrationUrl } from '../illustrations/illustrations';
import { Connectivity } from '../state/connectivity';
import { EN } from '../strings/en';
import { Button } from './button';

/**
 * app-kid-retry (Guidelines §12 "Error (kid)", §16): never red; the owl, "Let's try again" and one
 * primary button. Offline, the cloud picture and "This needs the internet." instead (App Flow §10).
 */
@Component({
  selector: 'app-kid-retry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <div class="retry" role="alert">
      <img [src]="offline() ? cloud : owl" alt="" width="120" height="120" />
      <p class="retry__text">{{ offline() ? text.offline : text.somethingFailed }}</p>
      <app-button [label]="text.tryAgain" (pressed)="retry.emit()" />
    </div>
  `,
  styles: `
    .retry {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-6) var(--space-4);
      text-align: center;
    }
    img {
      display: block;
    }
    .retry__text {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
  `,
})
export class KidRetry {
  readonly retry = output<void>();

  protected readonly offline = computed(() => !this.online());
  protected readonly text = EN.kid;
  private readonly online = inject(Connectivity).online;
  protected readonly owl = illustrationUrl('mascot-owl');
  protected readonly cloud = illustrationUrl('state-offline');
}
