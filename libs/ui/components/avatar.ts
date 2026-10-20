import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { iconGlyph } from '../icons/icons';
import { AvatarKey, IllustrationKey, illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';

export type AvatarSize = 40 | 64 | 96 | 128;

/** app-avatar (Guidelines §11): an animal on a primary-100 circle; selected adds ring and badge. */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--avatar-size.px]': 'size()' },
  template: `
    <span class="avatar" [class.avatar--selected]="selected()">
      <img [src]="src()" [alt]="alt()" />
    </span>
    @if (selected()) {
      <span class="badge" role="img" [attr.aria-label]="selectedLabel">
        <span class="ui-icon" aria-hidden="true">{{ checkGlyph }}</span>
      </span>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-block;
      width: var(--avatar-size);
      height: var(--avatar-size);
    }
    .avatar {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      border: 3px solid var(--color-surface);
      border-radius: 50%;
      background: var(--color-primary-100);
      overflow: hidden;
    }
    .avatar--selected {
      box-shadow: 0 0 0 4px var(--color-primary-600);
    }
    .avatar img {
      display: block;
      width: 80%;
      height: 80%;
    }
    .badge {
      position: absolute;
      right: 0;
      bottom: 0;
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border: 2px solid var(--color-surface);
      border-radius: 50%;
      background: var(--color-primary-600);
      color: #ffffff;
    }
    .badge .ui-icon {
      font-size: 16px;
    }
  `,
})
export class Avatar {
  readonly animal = input.required<AvatarKey>();
  readonly size = input<AvatarSize>(64);
  readonly selected = input(false);
  /** True when the child's name is shown next to it, so the picture is decorative. */
  readonly decorative = input(false);

  protected readonly selectedLabel = EN.a11y.selected;
  protected readonly checkGlyph = iconGlyph('check');
  private readonly key = computed<IllustrationKey>(() => `avatar-${this.animal()}`);
  protected readonly src = computed(() => illustrationUrl(this.key()));
  protected readonly alt = computed(() => (this.decorative() ? '' : EN.illustrations[this.key()]));
}
