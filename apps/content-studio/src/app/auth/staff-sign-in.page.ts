import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiError, AuthService, StudioApi } from '@fullstar/core';
import { Button, EN, errorMessage } from '@fullstar/ui';

/**
 * S1 Staff sign-in (App Flow §7, Schema §8.3): Keycloak asks for the email code, then the
 * authenticator code. Back here, an active staff row is required before the dashboard.
 */
@Component({
  selector: 'app-staff-sign-in-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    @if (failure(); as message) {
      <p class="staff__error" role="alert">{{ message }}</p>
    }
    @if (auth.authenticated()) {
      <app-button [label]="text.signOut" variant="secondary" (pressed)="signOut()" />
    } @else {
      <p class="staff__intro">{{ text.staffIntro }}</p>
      <app-button [label]="text.signIn" (pressed)="signIn()" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-4);
      max-width: 480px;
    }
    .staff__intro {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .staff__error {
      margin: 0;
      font: var(--type-body);
      color: var(--color-error-700);
    }
  `,
})
export class StaffSignInPage {
  protected readonly text = EN.auth;
  protected readonly auth = inject(AuthService);
  protected readonly failure = signal<string | null>(null);

  private readonly studio = inject(StudioApi);
  private readonly router = inject(Router);

  constructor() {
    if (inject(ActivatedRoute).snapshot.queryParamMap.has('denied')) {
      this.failure.set(EN.auth.staffDenied);
      return;
    }
    if (this.auth.authenticated()) {
      this.studio.loadMe().subscribe({
        next: () => void this.router.navigateByUrl('/dashboard'),
        error: (error: unknown) => {
          const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
          this.failure.set(
            code === 'FORBIDDEN' ? EN.auth.staffDenied : errorMessage(code, 'studio'),
          );
        },
      });
    }
  }

  protected signIn(): void {
    void this.auth.signIn();
  }

  protected signOut(): void {
    void this.auth.signOut();
  }
}
