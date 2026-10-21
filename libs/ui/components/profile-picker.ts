import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AvatarKey } from '../illustrations/illustrations';
import { EN } from '../strings/en';
import { Avatar } from './avatar';
import { IconButton } from './icon-button';

export interface ChildProfile {
  readonly id: string;
  readonly name: string;
  readonly avatar: AvatarKey;
}

/** app-profile-picker (Guidelines §11, App Flow C1): children's pictures and names on the sky. */
@Component({
  selector: 'app-profile-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, IconButton],
  template: `
    @if (showParentButton()) {
      <app-icon-button
        class="picker__parent"
        icon="lock"
        surface="sky"
        [label]="parentLabel"
        (pressed)="parent.emit()"
      />
    }
    <ul class="picker__list">
      @for (child of profiles(); track child.id) {
        <li>
          <button type="button" class="profile" (click)="picked.emit(child.id)">
            <app-avatar [animal]="child.avatar" [size]="128" [decorative]="true" />
            <span class="profile__name">{{ child.name }}</span>
          </button>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      padding: var(--space-10) var(--space-4) var(--space-6);
    }
    .picker__parent {
      position: absolute;
      top: 0;
      right: var(--space-4);
    }
    .picker__list {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--space-7);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .profile {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2);
      border: 0;
      border-radius: var(--radius-xl);
      background: transparent;
      cursor: pointer;
      transition: transform calc(var(--dur-press) * 1.5) var(--ease-standard);
    }
    .profile:active {
      transform: translateY(2px);
      transition-duration: var(--dur-press);
    }
    .profile:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .profile__name {
      font: var(--type-h2);
      color: var(--color-text-on-sky);
    }
  `,
})
export class ProfilePicker {
  readonly profiles = input.required<readonly ChildProfile[]>();
  /** Off when the screen header already has the Parent button (C1 in shell A). */
  readonly showParentButton = input(true);
  /** Emits the child's id. */
  readonly picked = output<string>();
  /** The "Parent" button: the screen asks for the PIN (App Flow P0). */
  readonly parent = output<void>();

  protected readonly parentLabel = EN.nav.parentButton;
}
