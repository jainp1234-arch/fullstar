import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { IconButton } from '../components/icon-button';
import { ReadAloud } from '../components/read-aloud';
import { IconName } from '../icons/icons';
import { EN } from '../strings/en';
import { CurrentScreen } from './current-screen';
import { SCREEN_CONFIG } from './screen';

interface HeaderAction {
  readonly icon: IconName;
  readonly label: string;
  readonly url: string;
}

/**
 * The sky header row (Guidelines §10): left round button, centred title, right button or a
 * 48 px space. Focus headers (shell C) have only the close/back button, no title.
 */
@Component({
  selector: 'app-sky-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconButton, ReadAloud],
  template: `
    <header class="row" [class.row--focus]="focus()">
      <div class="row__side">
        @if (left(); as action) {
          <app-icon-button
            surface="sky"
            [icon]="action.icon"
            [label]="action.label"
            (pressed)="go(action.url)"
          />
        }
      </div>
      @if (!focus()) {
        <h1 class="row__title" tabindex="-1">{{ current.title() }}</h1>
      }
      <div class="row__side row__side--end">
        @if (!focus()) {
          @if (showReadAloud()) {
            <app-read-aloud surface="sky" />
          } @else if (right(); as action) {
            <app-icon-button
              surface="sky"
              [icon]="action.icon"
              [label]="action.label"
              (pressed)="go(action.url)"
            />
          }
        }
      </div>
    </header>
  `,
  styles: `
    :host {
      display: block;
      padding-top: env(safe-area-inset-top);
    }
    .row {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr) 56px;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--header-row);
      padding: var(--space-2) var(--space-4);
      box-sizing: border-box;
    }
    .row--focus {
      min-height: 64px;
    }
    .row__side {
      display: flex;
    }
    .row__side--end {
      grid-column: 3;
      justify-content: flex-end;
    }
    .row__title {
      margin: 0;
      font: var(--type-display);
      color: var(--color-text-on-sky);
      text-align: center;
      overflow-wrap: anywhere;
    }
    .row__title:focus {
      outline: none;
    }
  `,
})
export class SkyHeader {
  readonly focus = input(false);

  protected readonly current = inject(CurrentScreen);
  private readonly config = inject(SCREEN_CONFIG);
  private readonly router = inject(Router);

  protected readonly left = computed<HeaderAction | null>(() => {
    const screen = this.current.screen();
    const family = this.config.family;
    if (!screen) {
      return null;
    }
    const parentUrl = this.current.parentUrl();
    if (screen.shell === 'focus' && screen.mode === 'kid') {
      return parentUrl ? { icon: 'close', label: EN.nav.close, url: parentUrl } : null;
    }
    if (this.current.isTabRoot() && family) {
      return screen.mode === 'kid'
        ? { icon: 'lock', label: EN.nav.parentButton, url: this.current.urlOf(family.parentPin) }
        : { icon: 'arrow_back', label: EN.nav.backToKids, url: this.current.urlOf(family.who) };
    }
    return parentUrl ? { icon: 'arrow_back', label: EN.nav.back, url: parentUrl } : null;
  });

  /** Every kid-mode screen has read aloud (Guidelines §14), except the picker. */
  protected readonly showReadAloud = computed(() => {
    const screen = this.current.screen();
    return screen?.mode === 'kid' && screen.id !== this.config.family?.who;
  });

  protected readonly right = computed<HeaderAction | null>(() => {
    const screen = this.current.screen();
    const family = this.config.family;
    if (!screen || !family) {
      return null;
    }
    if (screen.id === family.who) {
      return {
        icon: 'lock',
        label: EN.nav.parentButton,
        url: this.current.urlOf(family.parentPin),
      };
    }
    if (screen.mode === 'parent' && screen.id !== family.messages) {
      return {
        icon: 'notifications',
        label: EN.nav.messages,
        url: this.current.urlOf(family.messages),
      };
    }
    return null;
  });

  protected go(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
