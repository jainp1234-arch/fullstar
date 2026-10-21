import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FamilyApi, FamilySession } from '@fullstar/core';
import {
  AVATAR_KEYS,
  AvatarKey,
  Button,
  ChildProfile,
  EN,
  EmptyState,
  ProfilePicker,
} from '@fullstar/ui';

const AVATARS = new Set<string>(AVATAR_KEYS);

/** C1 Who is learning? (App Flow §5): the family's children from GET /family/me. */
@Component({
  selector: 'app-who-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, ProfilePicker],
  template: `
    @if (profiles().length) {
      <app-profile-picker
        [profiles]="profiles()"
        [showParentButton]="false"
        (picked)="pick($event)"
      />
    } @else {
      <div class="who__empty">
        <app-empty-state [title]="text.noChildrenTitle" [body]="text.noChildrenBody" />
        <app-button [label]="text.finishSetup" (pressed)="finishSetup()" />
      </div>
    }
  `,
  styles: `
    .who__empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-6);
      border-radius: var(--radius-xl);
      background: var(--color-surface);
    }
  `,
})
export class WhoPage {
  protected readonly text = EN.auth;

  private readonly family = inject(FamilyApi);
  private readonly session = inject(FamilySession);
  private readonly router = inject(Router);

  protected readonly profiles = computed<readonly ChildProfile[]>(() => {
    const state = this.family.state();
    if (!state || state === 'new') {
      return [];
    }
    return state.children.map((child) => ({
      id: child.id,
      name: child.first_name,
      avatar: AVATARS.has(child.avatar_key) ? (child.avatar_key as AvatarKey) : 'cat',
    }));
  });

  protected pick(childId: string): void {
    this.session.selectChild(childId);
    this.session.lockParent();
    void this.router.navigateByUrl('/kid/learn');
  }

  protected finishSetup(): void {
    const state = this.family.state();
    const pinSet = !!state && state !== 'new' && state.family.pin_set;
    void this.router.navigateByUrl(pinSet ? '/setup/child' : '/setup/pin');
  }
}
