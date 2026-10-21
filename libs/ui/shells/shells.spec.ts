import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { DisplayModeService } from '../mode/display-mode';
import { CurrentScreen } from './current-screen';
import { NAV_ACCESS, SCREEN_CONFIG, ScreenConfig, screenRoutes } from './screen';

@Component({ template: '' })
class Page {}

@Component({ template: '<ng-content />' })
class Shell {}

const CONFIG: ScreenConfig = {
  appName: 'FullStar',
  family: { who: 'C1', parentPin: 'P0', messages: 'P19' },
  screens: [
    { id: 'C1', path: 'who', shell: 'sky-list', mode: 'kid', nav: false, links: ['P0'] },
    { id: 'K1', path: 'kid/learn', shell: 'sky-list', mode: 'kid', tab: 'learn' },
    {
      id: 'K2',
      path: 'kid/learn/:subject',
      sample: 'kid/learn/english',
      shell: 'sky-list',
      mode: 'kid',
      parent: 'K1',
    },
    { id: 'K4', path: 'kid/lesson/x', shell: 'focus', mode: 'kid', parent: 'K2' },
    { id: 'P0', path: 'parent/pin', shell: 'focus', mode: 'parent', parent: 'C1' },
  ],
  nav: {
    kid: [
      { tab: 'learn', label: 'Learn', icon: 'school', screen: 'K1' },
      { tab: 'secret', label: 'Secret', icon: 'lock', screen: 'K1', requires: 'boss' },
    ],
  },
};

describe('screenRoutes', () => {
  it('groups screens under one route per shell, with titles and data', () => {
    const routes = screenRoutes(CONFIG, { 'sky-list': Shell, focus: Shell }, Page);
    expect(routes).toHaveLength(2);
    expect(routes[0].children?.map((child) => child.path)).toEqual([
      'who',
      'kid/learn',
      'kid/learn/:subject',
    ]);
    expect(routes[0].children?.[0].title).toBe('Who is learning? · FullStar');
  });

  it('refuses a missing shell', () => {
    expect(() => screenRoutes(CONFIG, { focus: Shell }, Page)).toThrow('sky-list');
  });
});

describe('CurrentScreen', () => {
  const role = signal<string | null>(null);

  async function at(url: string): Promise<CurrentScreen> {
    role.set(null);
    TestBed.configureTestingModule({
      providers: [
        { provide: NAV_ACCESS, useValue: (requirement: string) => role() === requirement },
        provideRouter(screenRoutes(CONFIG, { 'sky-list': Shell, focus: Shell }, Page)),
        { provide: SCREEN_CONFIG, useValue: CONFIG },
      ],
    });
    const current = TestBed.inject(CurrentScreen);
    await TestBed.inject(Router).navigateByUrl(url);
    TestBed.tick();
    return current;
  }

  it('knows the screen, its tab through parents, Back, links and the mode', async () => {
    const current = await at('/kid/lesson/x');
    expect(current.screen()?.id).toBe('K4');
    expect(current.title()).toBe('Lesson');
    expect(current.tab()).toBe('learn');
    expect(current.isTabRoot()).toBe(false);
    expect(current.parentUrl()).toBe('/kid/learn/english');
    // Focus shell: no navigation (Guidelines §10)
    expect(current.navItems()).toHaveLength(0);
    expect(TestBed.inject(DisplayModeService).mode()).toBe('kid');
  });

  it('shows the mode navigation in list shells', async () => {
    const current = await at('/kid/learn/english');
    expect(current.navItems().map((item) => item.tab)).toEqual(['learn']);
    expect(current.tab()).toBe('learn');
  });

  it('shows items with a requirement only when NAV_ACCESS allows it, and follows changes', async () => {
    const current = await at('/kid/learn/english');
    expect(current.navItems().map((item) => item.tab)).toEqual(['learn']);
    role.set('boss');
    expect(current.navItems().map((item) => item.tab)).toEqual(['learn', 'secret']);
  });

  it('lists children and extra links; hides navigation when asked', async () => {
    const current = await at('/who');
    expect(current.links().map((link) => link.url)).toEqual(['/parent/pin']);
    expect(current.navItems()).toHaveLength(0);
  });

  it('switches the display mode with the screen', async () => {
    const current = await at('/parent/pin');
    expect(current.screen()?.id).toBe('P0');
    expect(TestBed.inject(DisplayModeService).mode()).toBe('parent');
    expect(current.links().map((link) => link.id)).toEqual([]);
  });
});
