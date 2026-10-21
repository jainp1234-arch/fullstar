import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError, AuthService, FamilyApi, FamilyState } from '@fullstar/core';
import { Button, EN, OwlLoader, errorMessage } from '@fullstar/ui';
import { Observable, of, switchMap } from 'rxjs';
import { takeConsent } from './pending-consent';

/**
 * A3 (App Flow §4): the code is entered on the Keycloak page; Keycloak returns here. New
 * families go to consent (or are created with the consent given before sign-up), then B1;
 * returning families go to C1.
 */
@Component({
  selector: 'app-sign-in-return-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, OwlLoader],
  template: `
    <h1 class="return__title" tabindex="-1">
      {{ failure() ? text.signInFailed : text.signingIn }}
    </h1>
    @if (failure(); as message) {
      <p class="return__error" role="alert">{{ message }}</p>
      <app-button [label]="text.tryAgain" (pressed)="retry()" />
    } @else {
      <app-owl-loader />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      max-width: 480px;
    }
    .return__title {
      margin: 0;
      font: var(--type-h1);
      color: var(--color-ink-heading);
    }
    .return__title:focus {
      outline: none;
    }
    .return__error {
      margin: 0;
      font: var(--type-body);
      color: var(--color-error-700);
    }
  `,
})
export class SignInReturnPage {
  protected readonly text = EN.auth;
  protected readonly failure = signal<string | null>(null);

  private readonly auth = inject(AuthService);
  private readonly family = inject(FamilyApi);
  private readonly router = inject(Router);

  constructor() {
    this.route();
  }

  protected retry(): void {
    if (!this.auth.authenticated()) {
      void this.auth.signIn();
      return;
    }
    this.failure.set(null);
    this.route();
  }

  private route(): void {
    if (!this.auth.authenticated()) {
      this.failure.set(errorMessage('UNAUTHENTICATED', 'parent'));
      return;
    }
    this.family
      .loadMe()
      .pipe(switchMap((state) => this.withPendingConsent(state)))
      .subscribe({
        next: (state) => void this.router.navigateByUrl(nextPath(state)),
        error: (error: unknown) =>
          this.failure.set(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
          ),
      });
  }

  /** Consent given before sign-up creates the family straight away. */
  private withPendingConsent(state: FamilyState): Observable<FamilyState> {
    const consent = state === 'new' ? takeConsent() : null;
    return consent ? this.family.createFamily(consent) : of(state);
  }
}

function nextPath(state: FamilyState): string {
  if (state === 'new' || state === null) {
    return '/sign-up';
  }
  return state.family.pin_set ? '/who' : '/setup/pin';
}
