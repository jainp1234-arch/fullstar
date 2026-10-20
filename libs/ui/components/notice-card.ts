import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IllustrationKey, illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';

/** app-notice-card (Guidelines §11): tips and reminders on cream. */
@Component({
  selector: 'app-notice-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="notice">
      <img [src]="art()" [alt]="artAlt()" width="64" height="64" />
      <div class="notice__text">
        <p class="notice__title">{{ title() }}</p>
        <p class="notice__body">{{ body() }}</p>
        <ng-content />
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .notice {
      display: flex;
      align-items: flex-start;
      gap: var(--space-4);
      padding: var(--space-4);
      border: 1px solid var(--color-gold-400);
      border-radius: var(--radius-xl);
      background: var(--color-cream);
    }
    .notice__text {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .notice p {
      margin: 0;
    }
    .notice__title {
      font: var(--type-card-title);
      color: var(--color-text);
    }
    .notice__body {
      font: var(--type-body);
      color: var(--color-text-2);
    }
  `,
})
export class NoticeCard {
  readonly illustration = input.required<IllustrationKey>();
  readonly title = input.required<string>();
  readonly body = input.required<string>();

  protected readonly art = computed(() => illustrationUrl(this.illustration()));
  protected readonly artAlt = computed(() => EN.illustrations[this.illustration()]);
}
