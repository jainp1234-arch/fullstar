import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { gsap } from 'gsap';
import { illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';

/** Matches --dur-celebrate (Guidelines §7). */
const CELEBRATE_S = 1.2;
const BURST_STARS = 12;
const MAX_EARNED_SHOWN = 5;

interface BurstPosition {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

/** Fixed ring around the owl, so the final frame is the same every time. */
const BURST: readonly BurstPosition[] = Array.from({ length: BURST_STARS }, (_, i) => {
  const angle = (i / BURST_STARS) * Math.PI * 2;
  const radius = i % 2 === 0 ? 132 : 104;
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius * 0.8),
    rotation: i % 2 === 0 ? 20 : -20,
  };
});

/**
 * app-celebration (Guidelines §7, §10 shell D): owl, title, stars earned, and a GSAP star burst
 * over --dur-celebrate. With reduced motion, or when the parent turned celebrations off, it shows
 * the final frame. Buttons go in the content slot, stacked.
 */
@Component({
  selector: 'app-celebration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <div class="burst" aria-hidden="true">
        @for (star of burst; track $index) {
          <img class="burst__star" [src]="starUrl" alt="" width="32" height="32" />
        }
      </div>
      <img class="owl" [src]="owlUrl" alt="" width="160" height="160" />
    </div>
    <h1 class="title">{{ shownTitle() }}</h1>
    <p class="ui-visually-hidden" role="status">{{ announced() }}</p>
    <div class="earned" aria-hidden="true">
      @for (star of earnedShown(); track $index) {
        <img [src]="starUrl" alt="" width="40" height="40" />
      }
    </div>
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-6) var(--space-4);
      text-align: center;
    }
    .stage {
      position: relative;
      display: grid;
      place-items: center;
      width: 100%;
      height: 280px;
    }
    .burst {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .burst__star {
      position: absolute;
      top: calc(50% - 16px);
      left: calc(50% - 16px);
      display: block;
    }
    .owl {
      position: relative;
      display: block;
    }
    .title {
      margin: 0;
      font: var(--type-display);
      color: var(--color-text-on-sky);
    }
    .earned {
      display: flex;
      gap: var(--space-2);
      min-height: 40px;
    }
    .earned img {
      display: block;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      width: 100%;
      max-width: 400px;
      margin-top: var(--space-4);
    }
  `,
})
export class Celebration {
  readonly stars = input.required<number>();
  /** Defaults to "Well done! You got n stars." (Guidelines §16). */
  readonly title = input<string | null>(null);
  /** False when the parent turned celebrations off (App Flow P14). */
  readonly animate = input(true);

  protected readonly starUrl = illustrationUrl('reward-star');
  protected readonly owlUrl = illustrationUrl('mascot-owl');
  protected readonly burst = BURST;
  protected readonly shownTitle = computed(() => this.title() ?? EN.kid.finished(this.stars()));
  protected readonly earnedShown = computed(() =>
    Array.from({ length: Math.min(MAX_EARNED_SHOWN, Math.max(0, this.stars())) }),
  );

  /** Filled after the first render so screen readers announce it (Guidelines §14). */
  protected readonly announced = signal('');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private context: gsap.Context | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.context?.revert());
    afterNextRender(() => {
      this.announced.set(this.shownTitle());
      this.play();
    });
  }

  /** Runs the burst again, e.g. for review in the gallery. */
  play(): void {
    this.context?.revert();
    const root = this.host.nativeElement;
    this.context = gsap.context(() => {
      const stars = gsap.utils.toArray<HTMLElement>('.burst__star', root);
      const final = (i: number): gsap.TweenVars => ({
        x: BURST[i].x,
        y: BURST[i].y,
        rotation: BURST[i].rotation,
        scale: 1,
        opacity: 1,
      });
      if (!this.animate() || reducedMotion()) {
        stars.forEach((star, i) => gsap.set(star, final(i)));
        root.dataset['celebration'] = 'final';
        return;
      }
      root.dataset['celebration'] = 'playing';
      const timeline = gsap.timeline({
        onComplete: () => (root.dataset['celebration'] = 'final'),
      });
      timeline.from('.owl', { scale: 0.6, duration: CELEBRATE_S * 0.4, ease: 'back.out(2)' }, 0);
      stars.forEach((star, i) => {
        timeline.fromTo(
          star,
          { x: 0, y: 0, rotation: 0, scale: 0, opacity: 0 },
          { ...final(i), duration: CELEBRATE_S * 0.6, ease: 'back.out(1.7)' },
          CELEBRATE_S * 0.2 + i * ((CELEBRATE_S * 0.2) / BURST_STARS),
        );
      });
    }, root);
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
