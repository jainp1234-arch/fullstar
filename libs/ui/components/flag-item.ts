import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { iconGlyph } from '../icons/icons';
import { EN } from '../strings/en';
import { Button } from './button';

/** Content check severities (App Flow S11): critical blocks publishing; warnings can be accepted. */
export type FlagSeverity = 'critical' | 'warning';

/** app-flag-item (Guidelines §11): one Studio content-check row. */
@Component({
  selector: 'app-flag-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <article [class]="'flag flag--' + severity()">
      <div class="flag__head">
        <span class="flag__chip">
          <span class="ui-icon flag__chip-icon" aria-hidden="true">{{ severityGlyph() }}</span>
          {{ severityLabel() }}
        </span>
        <span class="flag__category">{{ category() }}</span>
      </div>
      <button type="button" class="flag__location" (click)="goTo.emit()">{{ location() }}</button>
      <p class="flag__reason">{{ reason() }}</p>
      <div class="flag__actions">
        <app-button [label]="text.goToItem" variant="secondary" (pressed)="goTo.emit()" />
        @if (severity() === 'warning') {
          <app-button [label]="text.acceptWithNote" variant="ghost" (pressed)="accept.emit()" />
        }
      </div>
    </article>
  `,
  styles: `
    :host {
      display: block;
    }
    .flag {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-4) var(--space-4) var(--space-4) var(--space-5);
      border-left: 4px solid;
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .flag--critical {
      border-left-color: var(--color-error-700);
    }
    .flag--warning {
      border-left-color: var(--color-gold-600);
    }
    .flag__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
    }
    .flag__chip {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      height: 28px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-pill);
      font: var(--type-small);
    }
    .flag__chip-icon {
      font-size: 18px;
    }
    .flag--critical .flag__chip {
      background: var(--color-error-100);
      color: var(--color-error-700);
    }
    .flag--warning .flag__chip {
      background: var(--color-gold-100);
      color: var(--color-gold-800);
    }
    .flag__category {
      font: var(--type-label);
      color: var(--color-text);
    }
    .flag__location {
      align-self: flex-start;
      padding: 0;
      border: 0;
      background: none;
      font: var(--type-label);
      color: var(--color-primary-600);
      text-decoration: underline;
      cursor: pointer;
    }
    .flag__location:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .flag__reason {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .flag__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      margin-top: var(--space-2);
    }
  `,
})
export class FlagItem {
  readonly severity = input.required<FlagSeverity>();
  readonly category = input.required<string>();
  /** Where in the lesson, e.g. "Lesson 2, scene 3"; pressing it goes there. */
  readonly location = input.required<string>();
  readonly reason = input.required<string>();
  readonly goTo = output<void>();
  /** Warnings only: the screen asks for the note. */
  readonly accept = output<void>();

  protected readonly text = EN.contentCheck;
  protected readonly severityLabel = computed(() =>
    this.severity() === 'critical' ? EN.contentCheck.critical : EN.contentCheck.warning,
  );
  protected readonly severityGlyph = computed(() =>
    iconGlyph(this.severity() === 'critical' ? 'error' : 'warning'),
  );
}
