import { ChangeDetectionStrategy, Component } from '@angular/core';
import { illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';

/** app-owl-loader (Guidelines §9, §11): kid-mode loading; the owl bobs, or stays still. */
@Component({
  selector: 'app-owl-loader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <img class="owl" [src]="owl" alt="" width="96" height="96" />
    <span class="ui-visually-hidden" role="status">{{ loading }}</span>
  `,
  styles: `
    :host {
      display: flex;
      justify-content: center;
      padding: var(--space-6);
    }
    .owl {
      display: block;
      animation: bob 1.2s var(--ease-standard) infinite alternate;
    }
    @keyframes bob {
      from {
        transform: translateY(3px);
      }
      to {
        transform: translateY(-3px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .owl {
        animation: none;
      }
    }
  `,
})
export class OwlLoader {
  protected readonly owl = illustrationUrl('mascot-owl');
  protected readonly loading = EN.a11y.loading;
}
