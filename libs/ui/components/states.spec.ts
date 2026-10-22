import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CurrentScreen } from '../shells/current-screen';
import { OfflineBanner } from '../shells/offline-banner';
import { Connectivity } from '../state/connectivity';
import { ErrorBar } from './error-bar';
import { KidRetry } from './kid-retry';
import { all, el, render } from './testing';

/** Plan 7.5: Guidelines §12 error and offline states with the §16 words. */
describe('states', () => {
  const online = signal(true);
  const mode = signal<'kid' | 'parent'>('parent');

  beforeEach(() => {
    online.set(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: Connectivity, useValue: { online } },
        { provide: CurrentScreen, useValue: { screen: () => ({ id: 'P1', mode: mode() }) } },
      ],
    });
  });

  it('app-kid-retry: the owl, "Let\'s try again" and one Try again button; never red', async () => {
    const fixture = await render(KidRetry);
    expect(el(fixture, 'img').getAttribute('src')).toBe('ui/illustrations/mascot-owl.webp');
    expect(el(fixture, 'p').textContent).toBe("Let's try again.");
    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);
    const buttons = all(fixture, 'button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Try again']);
    buttons[0].click();
    expect(retried).toBe(1);
  });

  it('app-kid-retry offline: the cloud picture and "This needs the internet."', async () => {
    online.set(false);
    const fixture = await render(KidRetry);
    expect(el(fixture, 'img').getAttribute('src')).toBe('ui/illustrations/state-offline.webp');
    expect(el(fixture, 'p').textContent).toBe('This needs the internet.');
  });

  it('app-error-bar: the §16 parent text by default, a Try again ghost button', async () => {
    const fixture = await render(ErrorBar);
    expect(el(fixture, '[role="alert"] p').textContent).toBe(
      'Something went wrong on our side. Please try again in a few minutes.',
    );
    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);
    el(fixture, 'button').click();
    expect(retried).toBe(1);
    fixture.componentRef.setInput('message', "You're offline. Some features are paused.");
    await fixture.whenStable();
    expect(el(fixture, 'p').textContent).toBe("You're offline. Some features are paused.");
  });

  it('the offline banner shows in parent mode only, while offline', async () => {
    mode.set('parent');
    const fixture = await render(OfflineBanner);
    expect(all(fixture, '[role="status"]')).toHaveLength(0);
    online.set(false);
    await fixture.whenStable();
    expect(el(fixture, '[role="status"]').textContent).toBe(
      "You're offline. Some features are paused.",
    );
    mode.set('kid');
    await fixture.whenStable();
    expect(all(fixture, '[role="status"]')).toHaveLength(0);
  });
});
