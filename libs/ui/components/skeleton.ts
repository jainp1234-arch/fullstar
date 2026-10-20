import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EN } from '../strings/en';

/** The real component each block stands in for, so the layout does not jump. */
export type SkeletonShape = 'list-card' | 'tile' | 'action-card' | 'button' | 'text';

/**
 * app-skeleton (Guidelines §11): parent and Studio loading placeholders with a 1.2 s shimmer
 * (none with reduced motion). Kid mode uses the owl loader instead (Plan 2.2c).
 */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="ui-visually-hidden" role="status">{{ loading }}</span>
    @for (block of blocks(); track $index) {
      <span [class]="'block block--' + shape()" aria-hidden="true"></span>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .block {
      display: block;
      background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255, 255, 255, 0.6) 50%,
          transparent 100%
        )
        var(--color-skeleton);
      background-size: 200% 100%;
      background-repeat: no-repeat;
      animation: shimmer 1.2s linear infinite;
    }
    @keyframes shimmer {
      from {
        background-position: 150% 0;
      }
      to {
        background-position: -50% 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .block {
        background-image: none;
        animation: none;
      }
    }
    .block--list-card {
      height: 96px;
      border-radius: var(--radius-lg);
    }
    .block--tile {
      height: 132px;
      border-radius: var(--radius-lg);
    }
    .block--action-card {
      height: 88px;
      border-radius: var(--radius-lg);
    }
    .block--button {
      height: var(--tap-default);
      border-radius: var(--radius-lg);
    }
    .block--text {
      width: 60%;
      height: 16px;
      border-radius: var(--radius-sm);
    }
  `,
})
export class Skeleton {
  readonly shape = input<SkeletonShape>('list-card');
  readonly count = input(1);

  protected readonly loading = EN.a11y.loading;
  protected readonly blocks = computed(() => Array.from({ length: Math.max(1, this.count()) }));
}
