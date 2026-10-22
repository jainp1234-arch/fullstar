import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, finalize, mergeMap, timer } from 'rxjs';

/** After the first screen is up, how long to wait before fetching the other screens. */
const DELAY_MS = 2000;

/**
 * Plan 9.3: every screen is its own chunk, so the first load is small; the other screens are then
 * fetched in the background, so the app keeps working if the connection drops before the service
 * worker has cached them (offline-first kid mode, Plan 7.5). When all are in,
 * <html data-screens-loaded> is set (end-to-end tests wait for it before going offline).
 */
@Injectable({ providedIn: 'root' })
export class IdlePreloading implements PreloadingStrategy {
  private readonly document = inject(DOCUMENT);
  private pending = 0;

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    this.pending++;
    return timer(DELAY_MS).pipe(
      mergeMap(() => load()),
      finalize(() => {
        this.pending--;
        if (this.pending === 0) {
          this.document.documentElement.dataset['screensLoaded'] = '';
        }
      }),
    );
  }
}
