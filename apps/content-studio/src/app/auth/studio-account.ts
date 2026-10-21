import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthService, StudioApi } from '@fullstar/core';
import { EN } from '@fullstar/ui';

/** The signed-in staff member in the Studio top bar, with Sign out. */
@Component({
  selector: 'app-studio-account',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label(); as text) {
      <div class="account">
        <span class="account__name">{{ text }}</span>
        <button type="button" class="account__out" (click)="signOut()">{{ signOutLabel }}</button>
      </div>
    }
  `,
  styles: `
    .account {
      display: flex;
      align-items: center;
      gap: var(--space-4);
    }
    .account__name {
      font: var(--type-small);
      color: var(--color-text-on-sky-2);
    }
    .account__out {
      min-height: 40px;
      padding: 0 var(--space-4);
      border: 1.5px solid rgba(255, 255, 255, 0.5);
      border-radius: var(--radius-pill);
      background: transparent;
      color: var(--color-text-on-sky);
      font: var(--type-label);
      cursor: pointer;
    }
    .account__out:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
  `,
})
export class StudioAccount {
  protected readonly signOutLabel = EN.auth.signOut;

  private readonly auth = inject(AuthService);
  private readonly studio = inject(StudioApi);

  protected readonly label = computed(() => {
    const me = this.studio.me();
    return this.auth.authenticated() && me
      ? EN.auth.signedInAs(me.display_name, EN.auth.roles[me.role])
      : null;
  });

  protected signOut(): void {
    void this.auth.signOut();
  }
}
