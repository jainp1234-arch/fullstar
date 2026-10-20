import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { IconButton } from '../components/icon-button';
import { EN } from '../strings/en';
import { AppNav } from './app-nav';
import { CurrentScreen } from './current-screen';

/**
 * Shell E · Studio (Guidelines §10, §13): 64 px sky top bar with the name, side navigation
 * (256 px from 1024 px, the 96 px rail below), content on the page colour, max 1200 px.
 */
@Component({
  selector: 'app-shell-studio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppNav, IconButton, RouterOutlet],
  host: { 'data-shell': 'E' },
  template: `
    <header class="bar ui-sky">
      <span class="bar__name">{{ appName }}</span>
    </header>
    <div class="body" [class.body--nav]="items().length > 0">
      @if (items().length) {
        <app-nav class="body__side" variant="side" [items]="items()" [label]="navLabel" />
        <app-nav class="body__rail" variant="rail" [items]="items()" [label]="navLabel" />
      }
      <main class="content">
        <div class="content__head">
          @if (current.parentUrl(); as url) {
            <app-icon-button icon="arrow_back" [label]="backLabel" (pressed)="go(url)" />
          }
          <h1 class="content__title" tabindex="-1">{{ current.title() }}</h1>
        </div>
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      background: var(--color-page);
    }
    .bar {
      display: flex;
      align-items: center;
      height: 64px;
      padding: 0 var(--space-6);
      flex: none;
    }
    .bar__name {
      font: var(--type-h2);
      color: var(--color-text-on-sky);
    }
    .body {
      flex: 1;
      display: flex;
    }
    .body__side {
      display: none;
      width: var(--sidenav-width);
      flex: none;
    }
    .body__rail {
      width: var(--rail-width);
      flex: none;
    }
    @media (min-width: 1024px) {
      .body__side {
        display: block;
      }
      .body__rail {
        display: none;
      }
    }
    .content {
      flex: 1;
      min-width: 0;
      max-width: var(--content-max-studio);
      padding: var(--space-7);
      box-sizing: border-box;
    }
    @media (max-width: 599px) {
      .content {
        padding: var(--space-4);
      }
    }
    .content__head {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      margin-bottom: var(--space-6);
    }
    .content__title {
      margin: 0;
      font: var(--type-h1);
      color: var(--color-ink-heading);
    }
    .content__title:focus {
      outline: none;
    }
  `,
})
export class StudioShell {
  protected readonly current = inject(CurrentScreen);
  private readonly router = inject(Router);
  protected readonly items = this.current.navItems;
  protected readonly appName = EN.app.studioName;
  protected readonly navLabel = EN.nav.studioMenu;
  protected readonly backLabel = EN.nav.back;

  protected go(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
