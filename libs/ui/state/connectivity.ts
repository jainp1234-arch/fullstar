import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Whether the device is online (App Flow §10, §11; Plan 7.5). From navigator.onLine and the
 * online/offline events; a failed request is not taken as offline.
 */
@Injectable({ providedIn: 'root' })
export class Connectivity {
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly state = signal(this.window?.navigator.onLine ?? true);

  readonly online = this.state.asReadonly();

  constructor() {
    const win = this.window;
    if (!win) {
      return;
    }
    const update = (): void => this.state.set(win.navigator.onLine);
    win.addEventListener('online', update);
    win.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      win.removeEventListener('online', update);
      win.removeEventListener('offline', update);
    });
  }
}
