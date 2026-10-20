import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/** Guidelines §17–§18: the root element's data-mode picks the type scale. */
export type DisplayMode = 'kid' | 'parent' | 'studio';

@Injectable({ providedIn: 'root' })
export class DisplayModeService {
  private readonly document = inject(DOCUMENT);

  private readonly current = signal<DisplayMode>(this.read());

  readonly mode = this.current.asReadonly();

  set(mode: DisplayMode): void {
    this.document.documentElement.dataset['mode'] = mode;
    this.current.set(mode);
  }

  private read(): DisplayMode {
    const value = this.document.documentElement.dataset['mode'];
    return value === 'parent' || value === 'studio' ? value : 'kid';
  }
}
