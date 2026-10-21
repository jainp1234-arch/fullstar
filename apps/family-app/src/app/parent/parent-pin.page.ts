import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError, FamilyApi } from '@fullstar/core';
import { EN, PinPad, errorMessage } from '@fullstar/ui';
import { PAGE_STYLES } from '../setup/page-styles';

const DEFAULT_NEXT = '/parent/progress';

/** Only paths inside the app (no other origin, no //host) may be returned to after the PIN. */
export function safeNext(value: string | null): string {
  return value && /^\/(?!\/)/.test(value) && !value.includes('\\') ? value : DEFAULT_NEXT;
}

/**
 * P0 Parent PIN (App Flow §6, §10): a wrong PIN shakes the pad; after 5 the API locks parent mode
 * for a minute (423 PIN_LOCKED) and the pad waits. Forgot PIN goes to A4.
 */
@Component({
  selector: 'app-parent-pin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PinPad, RouterLink],
  template: `
    <h1 class="page__title" tabindex="-1">{{ title }}</h1>
    <p class="page__intro">{{ text.enter }}</p>
    <app-pin-pad [disabled]="busy() || locked()" (completed)="verify($event)" />
    <p class="page__error" role="alert">{{ failure() }}</p>
    <a class="pin__forgot" routerLink="/parent/forgot-pin">{{ text.forgot }}</a>
  `,
  styles: [
    PAGE_STYLES,
    `
      :host {
        align-items: center;
        text-align: center;
        margin: 0 auto;
      }
      .page__error:empty {
        display: none;
      }
      .pin__forgot {
        font: var(--type-label);
        color: var(--color-primary-600);
      }
      .pin__forgot:focus-visible {
        outline: 3px solid var(--color-cyan);
        outline-offset: 2px;
      }
    `,
  ],
})
export class ParentPinPage {
  protected readonly title = EN.screens.P0;
  protected readonly text = EN.pin;
  protected readonly busy = signal(false);
  protected readonly locked = signal(false);
  protected readonly failure = signal<string | null>(null);

  private readonly family = inject(FamilyApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pad = viewChild.required(PinPad);
  private unlockTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.unlockTimer));
  }

  protected verify(pin: string): void {
    this.busy.set(true);
    this.failure.set(null);
    this.family
      .verifyPin(pin)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () =>
          void this.router.navigateByUrl(safeNext(this.route.snapshot.queryParamMap.get('next'))),
        error: (error: unknown) => {
          this.busy.set(false);
          this.pad().reject();
          if (!(error instanceof ApiError)) {
            this.failure.set(errorMessage('INTERNAL_ERROR', 'parent'));
            return;
          }
          if (error.code === 'PIN_REQUIRED' && error.fields['pin']) {
            this.failure.set(EN.errors.fields.wrongPin);
            return;
          }
          if (error.code === 'PIN_LOCKED' || error.code === 'RATE_LIMITED') {
            this.lockFor(error.retryAfterS ?? 60);
          }
          this.failure.set(errorMessage(error.code, 'parent', error.retryAfterS));
        },
      });
  }

  private lockFor(seconds: number): void {
    this.locked.set(true);
    clearTimeout(this.unlockTimer);
    this.unlockTimer = setTimeout(() => {
      this.locked.set(false);
      this.failure.set(null);
    }, seconds * 1000);
  }
}
