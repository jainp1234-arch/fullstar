import { Injectable, Injector, afterNextRender, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { DisplayModeService } from '../mode/display-mode';
import { EN } from '../strings/en';
import { NAV_ACCESS, NavItem, SCREEN_CONFIG, SCREEN_DATA, ScreenDef, ScreenId } from './screen';

export interface ScreenLink {
  readonly id: ScreenId;
  readonly title: string;
  readonly url: string;
}

/** The screen being shown, its place in the app, and its links; also sets the display mode. */
@Injectable({ providedIn: 'root' })
export class CurrentScreen {
  private readonly config = inject(SCREEN_CONFIG);
  private readonly router = inject(Router);
  private readonly access = inject(NAV_ACCESS);
  private readonly byId = new Map(this.config.screens.map((screen) => [screen.id, screen]));
  /** The last address each screen was shown at, so Back and Close return to the same chapter or topic. */
  private readonly lastUrl = new Map<ScreenId, string>();

  readonly screen = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => {
        const screen = this.read();
        if (screen) {
          this.lastUrl.set(screen.id, event.urlAfterRedirects);
        }
        return screen;
      }),
    ),
    { initialValue: this.read() },
  );

  readonly title = computed(() => {
    const screen = this.screen();
    return screen ? EN.screens[screen.id] : '';
  });

  /** A tab's first screen: in kid mode it has no Back (App Flow §3). */
  readonly isTabRoot = computed(() => !!this.screen()?.tab);

  readonly tab = computed(() => {
    let screen = this.screen();
    while (screen && !screen.tab && screen.parent) {
      screen = this.byId.get(screen.parent) ?? null;
    }
    return screen?.tab ?? null;
  });

  readonly navItems = computed<readonly NavItem[]>(() => {
    const screen = this.screen();
    // Guidelines §10: focus (C) and celebration (D) shells have no navigation
    if (
      !screen ||
      screen.nav === false ||
      screen.shell === 'focus' ||
      screen.shell === 'celebration'
    ) {
      return [];
    }
    return (this.config.nav[screen.mode] ?? []).filter(
      (item) => !item.requires || this.access(item.requires),
    );
  });

  readonly parentUrl = computed(() => {
    const parent = this.screen()?.parent;
    if (!parent) {
      return null;
    }
    // A screen with a path parameter goes back to where the child was; others to their own path
    const def = this.byId.get(parent);
    return (def?.path.includes(':') ? this.lastUrl.get(parent) : undefined) ?? this.urlOf(parent);
  });

  readonly links = computed<readonly ScreenLink[]>(() => {
    const screen = this.screen();
    if (!screen) {
      return [];
    }
    const children = this.config.screens
      .filter((other) => other.parent === screen.id)
      .map((other) => other.id);
    const ids = [...new Set([...children, ...(screen.links ?? [])])];
    return ids.map((id) => ({ id, title: EN.screens[id], url: this.urlOf(id) }));
  });

  constructor() {
    const mode = inject(DisplayModeService);
    effect(() => {
      const screen = this.screen();
      if (screen) {
        mode.set(screen.mode);
      }
    });
    // Guidelines §14: after moving to another screen, focus its heading so screen readers start there
    const injector = inject(Injector);
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() =>
        afterNextRender(
          () => document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }),
          { injector },
        ),
      );
  }

  urlOf(id: ScreenId): string {
    const screen = this.byId.get(id);
    if (!screen) {
      throw new Error(`Unknown screen ${id}`);
    }
    return `/${screen.sample ?? screen.path}`;
  }

  private read(): ScreenDef | null {
    let route: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    let found: ScreenDef | null = null;
    while (route) {
      found = (route.data[SCREEN_DATA] as ScreenDef | undefined) ?? found;
      route = route.firstChild;
    }
    return found;
  }
}
