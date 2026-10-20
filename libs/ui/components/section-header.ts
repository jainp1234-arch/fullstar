import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** app-section-header (Guidelines §11): 32 px above, 12 px below; optional link or count. */
@Component({
  selector: 'app-section-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="'header header--' + surface()">
      <h2 class="header__title">{{ title() }}</h2>
      @if (linkText(); as text) {
        <button type="button" class="header__link" (click)="linkPressed.emit()">{{ text }}</button>
      } @else if (count() !== null) {
        <span class="header__count">{{ count() }}</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin: var(--space-7) 0 var(--space-3);
    }
    .header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-4);
    }
    .header__title {
      margin: 0;
      font: var(--type-h2);
    }
    .header--sky .header__title {
      color: var(--color-text-on-sky);
    }
    .header--white .header__title {
      color: var(--color-text);
    }
    .header__link {
      padding: var(--space-1) 0;
      border: 0;
      background: none;
      font: var(--type-label);
      cursor: pointer;
    }
    .header--white .header__link {
      color: var(--color-primary-600);
    }
    .header--sky .header__link {
      color: var(--color-cyan);
    }
    .header__link:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .header__count {
      padding: 2px var(--space-3);
      border-radius: var(--radius-pill);
      font: var(--type-small);
      font-variant-numeric: tabular-nums;
    }
    .header--white .header__count {
      background: var(--color-primary-100);
      color: var(--color-primary-600);
    }
    .header--sky .header__count {
      background: var(--color-sky-pill);
      color: var(--color-text-on-sky);
    }
  `,
})
export class SectionHeader {
  readonly title = input.required<string>();
  readonly surface = input<'sky' | 'white'>('white');
  readonly linkText = input<string | null>(null);
  readonly count = input<number | null>(null);
  readonly linkPressed = output<void>();
}
