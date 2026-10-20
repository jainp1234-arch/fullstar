import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** app-progress-bar (Guidelines §11): fill animates over dur-slow; optional milestone dots. */
@Component({
  selector: 'app-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bar"
      role="progressbar"
      [attr.aria-label]="label()"
      aria-valuemin="0"
      [attr.aria-valuemax]="max()"
      [attr.aria-valuenow]="clamped()"
    >
      <div class="bar__fill" [style.width.%]="percent()"></div>
      @if (milestones() > 0) {
        <div class="bar__dots" aria-hidden="true">
          @for (dot of dots(); track $index) {
            <span class="bar__dot" [class.bar__dot--reached]="dot"></span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .bar {
      position: relative;
      height: 10px;
      border-radius: var(--radius-pill);
      background: var(--color-track);
    }
    .bar__fill {
      height: 100%;
      border-radius: var(--radius-pill);
      background: var(--color-primary-600);
      transition: width var(--dur-slow) var(--ease-standard);
    }
    .bar__dots {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .bar__dot {
      width: var(--space-5);
      height: var(--space-5);
      border-radius: var(--radius-pill);
      background: #d9dae0;
    }
    .bar__dot--reached {
      background: var(--color-primary-600);
    }
  `,
})
export class ProgressBar {
  readonly value = input.required<number>();
  readonly max = input(100);
  /** Accessible name, e.g. "Chapters done". */
  readonly label = input.required<string>();
  /** Number of milestone dots spread evenly (0 = none). */
  readonly milestones = input(0);

  protected readonly clamped = computed(() => Math.max(0, Math.min(this.value(), this.max())));
  protected readonly percent = computed(() =>
    this.max() > 0 ? (this.clamped() / this.max()) * 100 : 0,
  );
  protected readonly dots = computed(() =>
    Array.from({ length: this.milestones() }, (_, i) => {
      const threshold = ((i + 1) / this.milestones()) * this.max();
      return this.clamped() >= threshold;
    }),
  );
}
