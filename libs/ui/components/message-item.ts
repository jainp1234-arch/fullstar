import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconName, iconGlyph } from '../icons/icons';
import { EN } from '../strings/en';

/** app-message-item (Guidelines §11): one row in the parent bell list; the row is a button. */
@Component({
  selector: 'app-message-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="item" [class.item--unread]="unread()" (click)="pressed.emit()">
      <span class="item__icon" aria-hidden="true">
        <span class="ui-icon">{{ glyph() }}</span>
      </span>
      <span class="item__text">
        <span class="item__title">
          @if (unread()) {
            <span class="ui-visually-hidden">{{ unreadLabel }}:</span>
          }
          {{ title() }}
        </span>
        <span class="item__body">{{ body() }}</span>
        <span class="item__time">{{ time() }}</span>
      </span>
      @if (unread()) {
        <span class="item__dot" aria-hidden="true"></span>
      }
    </button>
  `,
  styles: `
    :host {
      display: block;
    }
    .item {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      width: 100%;
      padding: var(--space-4);
      border: 0;
      border-radius: var(--radius-md);
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
      transition: background var(--dur-fast) var(--ease-standard);
    }
    .item--unread {
      background: var(--color-primary-100);
    }
    .item:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .item__icon {
      flex: none;
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--color-primary-100);
      color: var(--color-primary-600);
    }
    .item--unread .item__icon {
      background: var(--color-surface);
    }
    .item__text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
    }
    .item__title {
      font: var(--type-label);
      color: var(--color-text);
    }
    .item__body {
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .item__time {
      font: var(--type-caption);
      color: var(--color-text-muted);
    }
    /* Muted text fails contrast on primary-100 (WCAG 1.4.3). */
    .item--unread .item__time {
      color: var(--color-text-2);
    }
    .item__dot {
      flex: none;
      width: 8px;
      height: 8px;
      margin-top: var(--space-2);
      border-radius: 50%;
      background: var(--color-pink);
    }
  `,
})
export class MessageItem {
  readonly icon = input.required<IconName>();
  readonly title = input.required<string>();
  readonly body = input.required<string>();
  /** Already formatted: "4:30 pm" or "19 Oct" (Guidelines §15). */
  readonly time = input.required<string>();
  readonly unread = input(false);
  readonly pressed = output<void>();

  protected readonly unreadLabel = EN.common.unread;
  protected readonly glyph = computed(() => iconGlyph(this.icon()));
}
