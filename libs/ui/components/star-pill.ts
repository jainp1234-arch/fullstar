import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';

/** Matches --dur-slow (Guidelines §7); the count-up is driven from script. */
const COUNT_UP_MS = 400;

/** app-star-pill (Guidelines §11): star count on the sky; counts up and bumps when stars increase. */
@Component({
  selector: 'app-star-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pill" [class.pill--bump]="bumping()" role="status" [attr.aria-label]="ariaLabel()">
      <img class="pill__star" [src]="starUrl" alt="" aria-hidden="true" width="24" height="24" />
      <span class="pill__count" aria-hidden="true">{{ shown() }}</span>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      height: var(--space-8);
      padding: 6px var(--space-4);
      box-sizing: border-box;
      border-radius: var(--radius-pill);
      background: var(--color-sky-pill);
      color: var(--color-text-on-sky);
      font: var(--type-label);
      font-variant-numeric: tabular-nums;
    }
    .pill__star {
      display: block;
    }
    .pill--bump .pill__star {
      animation: bump var(--dur-slow) var(--ease-bounce);
    }
    @keyframes bump {
      50% {
        transform: scale(1.25);
      }
    }
  `,
})
export class StarPill {
  readonly count = input.required<number>();

  protected readonly starUrl = illustrationUrl('reward-star');
  protected readonly shown = signal(0);
  protected readonly bumping = signal(false);
  protected readonly ariaLabel = computed(() => EN.a11y.stars(this.count()));

  private frame = 0;
  private initialised = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
    effect(() => {
      const target = this.count();
      untracked(() => this.animateTo(target));
    });
  }

  private animateTo(target: number): void {
    const from = this.shown();
    cancelAnimationFrame(this.frame);
    if (!this.initialised || target <= from || reducedMotion()) {
      this.initialised = true;
      this.shown.set(target);
      return;
    }
    this.bumping.set(false);
    queueMicrotask(() => this.bumping.set(true));
    // Frame timestamps can be earlier than "now" here, so time starts at the first frame
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.max(0, Math.min(1, (now - start) / COUNT_UP_MS));
      this.shown.set(Math.round(from + (target - from) * t));
      if (t < 1) {
        this.frame = requestAnimationFrame(step);
      }
    };
    this.frame = requestAnimationFrame(step);
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
