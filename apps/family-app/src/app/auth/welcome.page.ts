import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@fullstar/core';
import { Button, EN, illustrationUrl } from '@fullstar/ui';

/** A1 Welcome (App Flow §4): Sign in goes to the Keycloak email page; Sign up asks consent first. */
@Component({
  selector: 'app-welcome-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <div class="welcome">
      <img [src]="owl" alt="" width="120" height="120" />
      <h1 class="welcome__title" tabindex="-1">{{ appName }}</h1>
      <p class="welcome__tagline">{{ text.welcomeTagline }}</p>
      <div class="welcome__actions">
        <app-button [label]="text.signIn" [fullWidth]="true" (pressed)="signIn()" />
        <app-button
          [label]="text.signUp"
          variant="secondary"
          [fullWidth]="true"
          (pressed)="signUp()"
        />
      </div>
    </div>
  `,
  styles: `
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-4);
      padding-top: var(--space-6);
      text-align: center;
    }
    .welcome img {
      display: block;
    }
    .welcome__title {
      margin: 0;
      font: var(--type-display);
      color: var(--color-ink-heading);
    }
    .welcome__title:focus {
      outline: none;
    }
    .welcome__tagline {
      max-width: 32ch;
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .welcome__actions {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      width: 100%;
      max-width: 400px;
      margin-top: var(--space-4);
    }
  `,
})
export class WelcomePage {
  protected readonly text = EN.auth;
  protected readonly appName = EN.app.name;
  protected readonly owl = illustrationUrl('mascot-owl');

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected signIn(): void {
    void this.auth.signIn();
  }

  protected signUp(): void {
    void this.router.navigateByUrl('/sign-up');
  }
}
