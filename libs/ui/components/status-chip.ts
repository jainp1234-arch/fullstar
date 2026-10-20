import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconName, iconGlyph } from '../icons/icons';
import { EN } from '../strings/en';

/** Book statuses shown to parents (App Flow P4). */
export type BookStatus =
  | 'no-book'
  | 'getting-ready'
  | 'needs-attention'
  | 'read-along-ready'
  | 'lessons-preparing'
  | 'lessons-ready';

type Tone = 'blue' | 'gold' | 'error' | 'green';

/** Guidelines §11 tones; §14: always an icon and text, never colour alone. */
const STATUS: Record<BookStatus, { tone: Tone; icon: IconName; label: string }> = {
  'no-book': { tone: 'blue', icon: 'menu_book', label: EN.bookStatus.noBook },
  'getting-ready': { tone: 'gold', icon: 'hourglass_top', label: EN.bookStatus.gettingReady },
  'needs-attention': { tone: 'error', icon: 'error', label: EN.bookStatus.needsAttention },
  'read-along-ready': { tone: 'blue', icon: 'volume_up', label: EN.bookStatus.readAlongReady },
  'lessons-preparing': {
    tone: 'gold',
    icon: 'hourglass_top',
    label: EN.bookStatus.lessonsPreparing,
  },
  'lessons-ready': { tone: 'green', icon: 'check_circle', label: EN.bookStatus.lessonsReady },
};

/** app-status-chip (Guidelines §11). */
@Component({
  selector: 'app-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class]="'chip chip--' + spec().tone">
      <span class="ui-icon chip__icon" aria-hidden="true">{{ glyph() }}</span>
      {{ spec().label }}
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      height: 28px;
      padding: 0 var(--space-3);
      box-sizing: border-box;
      border-radius: var(--radius-pill);
      font: var(--type-small);
      white-space: nowrap;
    }
    .chip__icon {
      font-size: 18px;
    }
    .chip--blue {
      background: var(--color-blue-100);
      color: var(--color-blue-700);
    }
    .chip--gold {
      background: var(--color-gold-100);
      color: var(--color-gold-800);
    }
    .chip--error {
      background: var(--color-error-100);
      color: var(--color-error-700);
    }
    .chip--green {
      background: var(--color-success-100);
      color: var(--color-success-700);
    }
  `,
})
export class StatusChip {
  readonly status = input.required<BookStatus>();

  protected readonly spec = computed(() => STATUS[this.status()]);
  protected readonly glyph = computed(() => iconGlyph(this.spec().icon));
}
