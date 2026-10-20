import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IllustrationKey, illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';
import { ProgressBar } from './progress-bar';

/** app-progress-card (Guidelines §11): title, subtitle, bar and "6/20" count. */
@Component({
  selector: 'app-progress-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProgressBar],
  template: `
    <section class="progress">
      <img [src]="art()" [alt]="artAlt()" width="72" height="72" />
      <div class="progress__body">
        <p class="progress__title">{{ title() }}</p>
        @if (subtitle(); as text) {
          <p class="progress__subtitle">{{ text }}</p>
        }
        <div class="progress__row">
          <app-progress-bar
            class="progress__bar"
            [value]="value()"
            [max]="max()"
            [label]="title()"
          />
          <span class="progress__count">{{ value() }}/{{ max() }}</span>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .progress {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-4);
      border: 2px solid var(--color-gold-400);
      border-radius: var(--radius-xl);
      background: var(--color-surface);
    }
    .progress__body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .progress p {
      margin: 0;
    }
    .progress__title {
      font: var(--type-card-title);
      font-weight: 700;
      color: var(--color-gold-600);
    }
    .progress__subtitle {
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .progress__row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .progress__bar {
      flex: 1;
    }
    .progress__count {
      font: var(--type-small);
      color: var(--color-text-2);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ProgressCard {
  readonly illustration = input.required<IllustrationKey>();
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly value = input.required<number>();
  readonly max = input.required<number>();

  protected readonly art = computed(() => illustrationUrl(this.illustration()));
  protected readonly artAlt = computed(() => EN.illustrations[this.illustration()]);
}
