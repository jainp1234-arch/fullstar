import { InjectionToken, Type } from '@angular/core';
import { Routes } from '@angular/router';
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

/** Route data key holding the ScreenDef. */
export const SCREEN_DATA = 'screen';

/**
 * One parent route per shell, each with its screens as children, so a shell stays mounted while
 * moving between its screens.
 */
export function screenRoutes(
  config: ScreenConfig,
  shells: Partial<Record<ShellKind, Type<unknown>>>,
  page: Type<unknown>,
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
          component: page,
          title: EN.placeholder.pageTitle(EN.screens[screen.id], config.appName),
          data: { [SCREEN_DATA]: screen },
        })),
    };
  });
}
