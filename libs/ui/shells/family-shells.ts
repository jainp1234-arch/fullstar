import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { EN } from '../strings/en';
import { AppNav } from './app-nav';
import { CurrentScreen } from './current-screen';
import { OfflineBanner } from './offline-banner';
import { SkyHeader } from './sky-header';

/**
 * The family app frame (Guidelines §13): bottom navigation under 600 px, the 96 px rail from
 * 600 px (the family app keeps the rail on desktop). Content max 720 px tablet, 960 px desktop.
 */
@Component({
  selector: 'app-family-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppNav],
  template: `
    <div class="frame" [class.shell--nav]="items().length > 0">
      @if (items().length) {
        <app-nav class="frame__rail" variant="rail" [items]="items()" [label]="navLabel()" />
      }
      <div class="frame__main"><ng-content /></div>
      @if (items().length) {
        <app-nav class="frame__bottom" variant="bottom" [items]="items()" [label]="navLabel()" />
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .frame {
      min-height: 100dvh;
    }
    .frame__rail {
      display: none;
    }
    .frame__bottom {
      position: fixed;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 10;
    }
    .shell--nav .frame__main {
      padding-bottom: calc(var(--nav-height) + env(safe-area-inset-bottom));
    }
    @media (min-width: 600px) {
      .frame__rail {
        position: fixed;
        top: 0;
        bottom: 0;
        left: 0;
        z-index: 10;
        display: block;
        width: var(--rail-width);
      }
      .frame__bottom {
        display: none;
      }
      .shell--nav .frame__main {
        margin-left: var(--rail-width);
        padding-bottom: 0;
      }
    }
  `,
})
export class FamilyFrame {
  private readonly current = inject(CurrentScreen);
  protected readonly items = this.current.navItems;
  protected readonly navLabel = computed(() =>
    this.current.screen()?.mode === 'kid' ? EN.nav.kidTabs : EN.nav.parentTabs,
  );
}

/** Shell A · Sky list: the sky fills the screen; cards sit directly on it. */
@Component({
  selector: 'app-shell-sky-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FamilyFrame, RouterOutlet, SkyHeader],
  host: { 'data-shell': 'A', '[attr.data-screen]': 'screen()?.id' },
  template: `
    <app-family-frame>
      <div class="sky ui-sky">
        <app-sky-header />
        <main class="ui-shell-content"><router-outlet /></main>
      </div>
    </app-family-frame>
  `,
  styles: `
    .sky {
      min-height: 100dvh;
    }
  `,
})
export class SkyListShell {
  protected readonly screen = inject(CurrentScreen).screen;
}

/** Shell B · Sky + sheet: a 200 px sky header (180 px from 600 px) and a white sheet over it. */
@Component({
  selector: 'app-shell-sky-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FamilyFrame, OfflineBanner, RouterOutlet, SkyHeader],
  host: { 'data-shell': 'B', '[attr.data-screen]': 'screen()?.id' },
  template: `
    <app-family-frame>
      <div class="sky ui-sky"><app-sky-header /></div>
      <main class="sheet">
        <app-offline-banner />
        <div class="ui-shell-content"><router-outlet /></div>
      </main>
    </app-family-frame>
  `,
  styles: `
    .sky {
      height: var(--sky-header-b);
    }
    .sheet {
      position: relative;
      min-height: calc(100dvh - var(--sky-header-b) + 28px);
      margin-top: -28px;
      border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
      background: var(--color-page);
    }
    @media (min-width: 600px) {
      .sky {
        height: 180px;
      }
    }
  `,
})
export class SkySheetShell {
  protected readonly screen = inject(CurrentScreen).screen;
}

/** Shell C · Focus: a 64 px sky header with close or back only; white body; no navigation. */
@Component({
  selector: 'app-shell-focus',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FamilyFrame, OfflineBanner, RouterOutlet, SkyHeader],
  host: { 'data-shell': 'C', '[attr.data-screen]': 'screen()?.id' },
  template: `
    <app-family-frame>
      <div class="sky ui-sky"><app-sky-header [focus]="true" /></div>
      <main class="body">
        <app-offline-banner />
        <div class="ui-shell-content"><router-outlet /></div>
      </main>
    </app-family-frame>
  `,
  styles: `
    .body {
      min-height: calc(100dvh - 64px);
      background: var(--color-surface);
    }
  `,
})
export class FocusShell {
  protected readonly screen = inject(CurrentScreen).screen;
}

/** Shell D · Celebration: full sky; the page shows the owl, title, stars and two buttons. */
@Component({
  selector: 'app-shell-celebration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FamilyFrame, RouterOutlet],
  host: { 'data-shell': 'D', '[attr.data-screen]': 'screen()?.id' },
  template: `
    <app-family-frame>
      <main class="sky ui-sky">
        <div class="ui-shell-content"><router-outlet /></div>
      </main>
    </app-family-frame>
  `,
  styles: `
    .sky {
      display: flex;
      min-height: 100dvh;
      padding-top: env(safe-area-inset-top);
      box-sizing: border-box;
    }
    .sky > .ui-shell-content {
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
  `,
})
export class CelebrationShell {
  protected readonly screen = inject(CurrentScreen).screen;
}
