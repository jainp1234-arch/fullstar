import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ApiError, AuthService, FamilyApi } from '@fullstar/core';
import { Button, EN, errorMessage, Connectivity } from '@fullstar/ui';
import { switchMap } from 'rxjs';
import { PAGE_STYLES } from '../setup/page-styles';
import { PinChoice } from '../setup/pin-choice';
import { rememberPinReset } from './pending-pin-reset';

/** Schema §8.2: PUT /family/pin needs a sign-in less than 5 minutes old. */
const FRESH_LOGIN_S = 5 * 60;

/**
 * A4 Forgot parent PIN (App Flow §4): a new email code through Keycloak (prompt=login), then a
 * new PIN, then parent mode.
 */
@Component({
  selector: 'app-forgot-pin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, PinChoice],
  template: `
    <h1 class="page__title" tabindex="-1">{{ title }}</h1>
    @if (fresh()) {
      <app-pin-choice [prompt]="text.newPin" [disabled]="busy()" (chosen)="save($event)" />
    } @else {
      <p class="page__intro">{{ text.forgotIntro }}</p>
      <app-button
        [label]="text.sendCode"
        [fullWidth]="true"
        [loading]="busy()"
        (pressed)="sendCode()"
      />
    }
    @if (failure(); as message) {
      <p class="page__error" role="alert">{{ message }}</p>
    }
  `,
  styles: [PAGE_STYLES],
})
export class ForgotPinPage {
  protected readonly title = EN.screens.A4;
  protected readonly text = EN.pin;
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  private readonly auth = inject(AuthService);
  private readonly online = inject(Connectivity).online;
  private readonly family = inject(FamilyApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly choice = viewChild(PinChoice);
  private readonly expired = signal(false);

  /** The email code was proven moments ago, so the API will accept a new PIN. */
  protected readonly fresh = computed(() => {
    const authTime = this.auth.user()?.authTime;
    return !this.expired() && !!authTime && Date.now() / 1000 - authTime < FRESH_LOGIN_S;
  });

  protected sendCode(): void {
    // App Flow §11: the email code needs the internet
    if (!this.online()) {
      this.failure.set(EN.parent.offline);
      return;
    }
    this.busy.set(true);
    rememberPinReset();
    void this.auth.signIn({ fresh: true, email: this.auth.user()?.email ?? undefined });
  }

  protected save(pin: string): void {
    this.busy.set(true);
    this.failure.set(null);
    this.family
      .resetPin(pin)
      .pipe(
        switchMap(() => this.family.verifyPin(pin)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => void this.router.navigateByUrl('/parent/progress'),
        error: (error: unknown) => {
          this.busy.set(false);
          const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
          if (code === 'RECENT_LOGIN_REQUIRED') {
            this.expired.set(true);
          } else {
            this.choice()?.restart();
          }
          this.failure.set(errorMessage(code, 'parent'));
        },
      });
  }
}
