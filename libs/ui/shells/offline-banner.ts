import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Connectivity } from '../state/connectivity';
import { EN } from '../strings/en';
import { CurrentScreen } from './current-screen';

/**
 * The parent-mode offline banner (Guidelines §12 "Offline", §16; App Flow §10): a gold notice bar,
 * 40 px, under the header. Kid mode shows no banner; its unavailable cards get the cloud instead.
 */
@Component({
  selector: 'app-offline-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <p class="banner" role="status">{{ text }}</p>
    }
  `,
  styles: `
    .banner {
      display: flex;
      align-items: center;
      min-height: 40px;
      margin: 0;
      padding: 0 var(--space-4);
      box-sizing: border-box;
      background: var(--color-gold-100);
      font: var(--type-small);
      color: var(--color-gold-800);
    }
  `,
})
export class OfflineBanner {
  private readonly online = inject(Connectivity).online;
  private readonly screen = inject(CurrentScreen).screen;

  protected readonly text = EN.parent.offline;
  protected readonly shown = computed(() => !this.online() && this.screen()?.mode === 'parent');
}
