import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiError, AuthService, FamilyApi } from '@fullstar/core';
import { Button, EN, errorMessage } from '@fullstar/ui';
import { rememberConsent } from './pending-consent';

/**
 * A2 consent (App Flow §4, DPDP): shown before Sign up, and after sign-in when no family exists
 * yet. Signed out → remember the consent and go to Keycloak; signed in → create the family.
 */
@Component({
  selector: 'app-consent-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ReactiveFormsModule],
  template: `
    <h1 class="consent__title" tabindex="-1">{{ title }}</h1>
    <p class="consent__intro">{{ text.consentIntro }}</p>
    <form class="consent__form" [formGroup]="form" (ngSubmit)="submit()">
      <label class="consent__check">
        <input
          type="checkbox"
          [formControl]="agreed"
          [attr.aria-invalid]="showRequired() || null"
          [attr.aria-describedby]="showRequired() ? 'consent-required' : null"
        />
        <span>{{ text.consentLabel }}</span>
      </label>
      @if (showRequired()) {
        <p class="consent__error" id="consent-required">{{ text.consentRequired }}</p>
      }
      @if (failure(); as message) {
        <p class="consent__error" role="alert">{{ message }}</p>
      }
      <app-button
        type="submit"
        [label]="signedIn ? text.createFamily : text.continue"
        [fullWidth]="true"
        [loading]="busy()"
        [disabled]="!consentVersion()"
      />
    </form>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      max-width: 480px;
    }
    .consent__title {
      margin: 0;
      font: var(--type-h1);
      color: var(--color-ink-heading);
    }
    .consent__title:focus {
      outline: none;
    }
    .consent__intro {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .consent__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .consent__check {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      font: var(--type-body);
      color: var(--color-text);
      cursor: pointer;
    }
    .consent__check input {
      flex: none;
      width: 24px;
      height: 24px;
      margin: 0;
      accent-color: var(--color-primary-600);
    }
    .consent__check input:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .consent__error {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
  `,
})
export class ConsentPage {
  protected readonly text = EN.auth;
  protected readonly title = EN.screens.A2;
  protected readonly agreed = new FormControl(false, {
    nonNullable: true,
    validators: [Validators.requiredTrue],
  });
  protected readonly form = new FormGroup({ agreed: this.agreed });
  protected readonly consentVersion = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly showRequired = signal(false);

  private readonly auth = inject(AuthService);
  private readonly family = inject(FamilyApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly signedIn = this.auth.authenticated();

  constructor() {
    this.family
      .publicConfig()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (config) => this.consentVersion.set(config.consent_version),
        error: (error: unknown) => this.fail(error),
      });
  }

  protected submit(): void {
    const version = this.consentVersion();
    this.failure.set(null);
    if (this.agreed.invalid || !version) {
      this.showRequired.set(true);
      return;
    }
    this.showRequired.set(false);
    if (!this.auth.authenticated()) {
      rememberConsent(version);
      this.busy.set(true);
      void this.auth.signIn();
      return;
    }
    this.busy.set(true);
    this.family
      .createFamily(version)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => void this.router.navigateByUrl('/setup/pin'),
        error: (error: unknown) => {
          this.busy.set(false);
          this.fail(error);
        },
      });
  }

  private fail(error: unknown): void {
    const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    this.failure.set(errorMessage(code, 'parent'));
  }
}
