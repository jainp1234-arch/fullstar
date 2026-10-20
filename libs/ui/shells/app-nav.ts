import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { iconGlyph } from '../icons/icons';
import { CurrentScreen } from './current-screen';
import { NavItem } from './screen';

export type NavVariant = 'bottom' | 'rail' | 'side';

/**
 * Guidelines §10, §13: bottom navigation (phone), left rail (tablet; family desktop) and the
 * Studio side navigation. The active tab follows the current screen, sub-screens included.
 */
@Component({
  selector: 'app-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <nav [class]="'nav nav--' + variant()" [attr.aria-label]="label()">
      <ul class="nav__list">
        @for (item of items(); track item.tab) {
          <li class="nav__item">
            <a
              class="nav__link"
              [class.nav__link--active]="item.tab === current.tab()"
              [attr.aria-current]="item.tab === current.tab() ? 'page' : null"
              [routerLink]="current.urlOf(item.screen)"
            >
              <span
                class="ui-icon nav__icon"
                [class.ui-icon--filled]="item.tab === current.tab()"
                aria-hidden="true"
                >{{ glyph(item) }}</span
              >
              <span class="nav__label">{{ item.label }}</span>
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    .nav__list {
      display: flex;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .nav__link {
      position: relative;
      display: flex;
      align-items: center;
      text-decoration: none;
      transition: color var(--dur-fast) var(--ease-standard);
    }
    .nav__link:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: -3px;
    }
    .nav__icon {
      font-size: 28px;
    }

    /* Bottom navigation (phone) */
    .nav--bottom {
      padding-bottom: env(safe-area-inset-bottom);
      background: var(--color-surface);
      box-shadow: var(--shadow-nav);
    }
    .nav--bottom .nav__item {
      flex: 1;
    }
    .nav--bottom .nav__link {
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      height: var(--nav-height);
      color: var(--color-text-muted);
      font: var(--type-caption);
    }
    .nav--bottom .nav__link--active {
      color: var(--color-primary-600);
    }
    .nav--bottom .nav__link--active::before {
      content: '';
      position: absolute;
      top: 0;
      left: calc(50% - 24px);
      width: 48px;
      height: 3px;
      border-radius: 0 0 3px 3px;
      background: var(--color-primary-600);
    }

    /* Rail (tablet, family desktop) and side navigation (Studio desktop) on primary-900 */
    .nav--rail,
    .nav--side {
      height: 100%;
      box-sizing: border-box;
      padding: var(--space-4) var(--space-2);
      background: var(--color-primary-900);
    }
    .nav--rail .nav__list,
    .nav--side .nav__list {
      flex-direction: column;
      gap: var(--space-2);
    }
    .nav--rail .nav__link,
    .nav--side .nav__link {
      border-radius: var(--radius-md);
      color: var(--color-text-on-sky-2);
    }
    .nav--rail .nav__link--active,
    .nav--side .nav__link--active {
      background: var(--color-sky-pill);
      color: var(--color-text-on-sky);
    }
    @media (hover: hover) {
      .nav--rail .nav__link:hover,
      .nav--side .nav__link:hover {
        color: var(--color-text-on-sky);
      }
    }
    .nav--rail .nav__link {
      flex-direction: column;
      justify-content: center;
      gap: var(--space-1);
      min-height: 72px;
      padding: var(--space-2) var(--space-1);
      font: var(--type-caption);
      text-align: center;
    }
    .nav--side .nav__link {
      gap: var(--space-3);
      min-height: var(--tap-default);
      padding: 0 var(--space-4);
      font: var(--type-label);
    }
    .nav--side .nav__icon {
      font-size: 24px;
    }
  `,
})
export class AppNav {
  readonly items = input.required<readonly NavItem[]>();
  readonly variant = input.required<NavVariant>();
  readonly label = input.required<string>();

  protected readonly current = inject(CurrentScreen);

  protected glyph(item: NavItem): string {
    return iconGlyph(item.icon);
  }
}
