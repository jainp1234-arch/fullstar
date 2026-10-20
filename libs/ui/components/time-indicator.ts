import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EN } from '../strings/en';

export type TimeState = 'ok' | 'near' | 'over';

/**
 * app-time-indicator (Guidelines §10, §11): 4 px bar under the kid header row. No text; the
 * colour turns at 80% and 100% and the bar stays full past the limit.
 */
@Component({
  selector: 'app-time-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="time"
      role="progressbar"
      aria-valuemin="0"
      [attr.aria-valuemax]="limit()"
      [attr.aria-valuenow]="shownUsed()"
      [attr.aria-valuetext]="label()"
      [attr.aria-label]="label()"
    >
      <span [class]="'time__fill time__fill--' + state()" [style.width.%]="percent()"></span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .time {
      height: 4px;
      background: transparent;
    }
    .time__fill {
      display: block;
      height: 100%;
      transition:
        width var(--dur-slow) var(--ease-standard),
        background var(--dur-fast) var(--ease-standard);
    }
    .time__fill--ok {
      background: var(--color-time-ok);
    }
    .time__fill--near {
      background: var(--color-time-near);
    }
    .time__fill--over {
      background: var(--color-time-over);
    }
  `,
})
export class TimeIndicator {
  /** Minutes used today. */
  readonly used = input.required<number>();
  /** Daily limit in minutes. */
  readonly limit = input.required<number>();

  private readonly ratio = computed(() =>
    this.limit() > 0 ? Math.max(0, this.used()) / this.limit() : 1,
  );
  protected readonly percent = computed(() => Math.min(1, this.ratio()) * 100);
  protected readonly state = computed<TimeState>(() => {
    const ratio = this.ratio();
    if (ratio >= 1) {
      return 'over';
    }
    return ratio >= 0.8 ? 'near' : 'ok';
  });
  protected readonly shownUsed = computed(() =>
    Math.min(Math.max(0, this.used()), Math.max(0, this.limit())),
  );
  protected readonly label = computed(() => EN.a11y.timeToday(this.used(), this.limit()));
}
