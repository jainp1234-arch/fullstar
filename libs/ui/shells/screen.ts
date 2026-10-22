import { InjectionToken, Signal, Type, signal } from '@angular/core';
import { CanActivateFn, Routes } from '@angular/router';
import { IconName } from '../icons/icons';
import { DisplayMode } from '../mode/display-mode';
import { EN } from '../strings/en';

/** Guidelines §10: every screen uses exactly one shell. */
export type ShellKind = 'sky-list' | 'sky-sheet' | 'focus' | 'celebration' | 'studio';

export type ScreenId = keyof typeof EN.screens;

export interface NavItem {
  /** Matches ScreenDef.tab. */
  readonly tab: string;
  readonly label: string;
  readonly icon: IconName;
  /** The tab's first screen. */
  readonly screen: ScreenId;
  /** Shown only when NAV_ACCESS allows it, e.g. "super_admin" for Studio Staff (S13). */
  readonly requires?: string;
}

export interface ScreenDef {
  readonly id: ScreenId;
  /** Router path pattern, without a leading slash. */
  readonly path: string;
  /** A concrete URL for the pattern, used for links until real data exists. */
  readonly sample?: string;
  readonly shell: ShellKind;
  readonly mode: DisplayMode;
  /** Set on a tab's first screen; other screens inherit it from their parent. */
  readonly tab?: string;
  /** The screen Back goes to (App Flow §3: one step back inside the current tab). */
  readonly parent?: ScreenId;
  /** Other screens this one leads to, besides its children (App Flow "Goes to"). */
  readonly links?: readonly ScreenId[];
  /** False hides the navigation, e.g. C1 and S1. */
  readonly nav?: boolean;
}

/** Family app screens the headers link to (App Flow §3). */
export interface FamilyScreens {
  /** "Who is learning?" — Back to kids goes here. */
  readonly who: ScreenId;
  /** The parent PIN — the kid-mode Parent button goes here. */
  readonly parentPin: ScreenId;
  /** The bell in parent mode. */
  readonly messages: ScreenId;
}

/** Everything one app's shells need: its screens and its navigation. */
export interface ScreenConfig {
  readonly appName: string;
  readonly screens: readonly ScreenDef[];
  readonly nav: Partial<Record<DisplayMode, readonly NavItem[]>>;
  readonly family?: FamilyScreens;
}

export const SCREEN_CONFIG = new InjectionToken<ScreenConfig>('SCREEN_CONFIG');

/**
 * Decides whether a navigation item with `requires` is shown; may read signals (it runs inside a
 * computed). UX only: the API checks every call. Default: such items are hidden.
 */
export const NAV_ACCESS = new InjectionToken<(requirement: string) => boolean>('NAV_ACCESS', {
  providedIn: 'root',
  factory: () => () => false,
});

/** Route data key holding the ScreenDef. */
export const SCREEN_DATA = 'screen';

export interface ScreenRouteOptions {
  /** Built screens; every other screen shows the placeholder page. */
  readonly pages?: Partial<Record<ScreenId, Type<unknown>>>;
  /** Guards per screen, e.g. sign-in required. */
  readonly guards?: (screen: ScreenDef) => CanActivateFn[];
}

/**
 * One parent route per shell, each with its screens as children, so a shell stays mounted while
 * moving between its screens.
 */
export function screenRoutes(
  config: ScreenConfig,
  shells: Partial<Record<ShellKind, Type<unknown>>>,
  page: Type<unknown>,
  options: ScreenRouteOptions = {},
): Routes {
  const kinds = [...new Set(config.screens.map((screen) => screen.shell))];
  return kinds.map((kind) => {
    const shell = shells[kind];
    if (!shell) {
      throw new Error(`No shell component for "${kind}"`);
    }
    return {
      path: '',
      component: shell,
      children: config.screens
        .filter((screen) => screen.shell === kind)
        .map((screen) => ({
          path: screen.path,
          component: options.pages?.[screen.id] ?? page,
          canActivate: options.guards?.(screen) ?? [],
          title: EN.placeholder.pageTitle(EN.screens[screen.id], config.appName),
          data: { [SCREEN_DATA]: screen },
        })),
    };
  });
}

/** Minutes used today and the daily limit for the kid-mode time indicator (Plan 6.4); null hides it. */
export interface KidTimeToday {
  readonly used: number;
  readonly limit: number;
}

/** The app provides the child's time today; the kid header shows it as app-time-indicator. */
export const KID_TIME = new InjectionToken<Signal<KidTimeToday | null>>('KID_TIME', {
  factory: () => signal(null),
});
