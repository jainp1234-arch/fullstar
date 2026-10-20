import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IllustrationKey, illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';

/** app-banner-card (Guidelines §11): at most once per screen, for the most important message. */
@Component({
  selector: 'app-banner-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="banner">
      <div class="banner__text">
        <p class="banner__eyebrow">{{ eyebrow() }}</p>
        <p class="banner__body">{{ body() }}</p>
        <ng-content />
      </div>
      @if (illustration(); as key) {
        <img [src]="art()" [alt]="artAlt()" width="96" height="96" />
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .banner {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      min-height: 140px;
      padding: var(--space-5);
      box-sizing: border-box;
      border-radius: var(--radius-xl);
      background: var(--gradient-banner);
    }
    .banner__text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .banner p {
      margin: 0;
    }
    .banner__eyebrow {
      font: var(--type-label);
      color: var(--color-cyan);
    }
    .banner__body {
      font: var(--type-body);
      color: var(--color-text-on-sky);
    }
  `,
})
export class BannerCard {
  readonly eyebrow = input.required<string>();
  readonly body = input.required<string>();
  readonly illustration = input<IllustrationKey | null>(null);

  protected readonly art = computed(() => {
    const key = this.illustration();
    return key ? illustrationUrl(key) : '';
  });
  protected readonly artAlt = computed(() => {
    const key = this.illustration();
    return key ? EN.illustrations[key] : '';
  });
}
