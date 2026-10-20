import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { IllustrationKey, illustrationUrl } from '../illustrations/illustrations';
import { DisplayModeService } from '../mode/display-mode';
import { EN } from '../strings/en';
import { Button } from './button';

/** app-empty-state (Guidelines §11): the owl in kid mode, the given illustration elsewhere. */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <img [src]="art()" [alt]="artAlt()" width="120" height="120" />
    <h2 class="empty__title">{{ title() }}</h2>
    @if (body(); as text) {
      <p class="empty__body">{{ text }}</p>
    }
    @if (actionLabel(); as label) {
      <app-button [label]="label" (pressed)="action.emit()" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-9) var(--space-4) var(--space-6);
      text-align: center;
    }
    img {
      display: block;
    }
    .empty__title {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
    .empty__body {
      display: -webkit-box;
      max-width: 36ch;
      margin: 0;
      overflow: hidden;
      font: var(--type-body);
      color: var(--color-text-2);
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
  `,
})
export class EmptyState {
  readonly illustration = input<IllustrationKey>('empty-books');
  readonly title = input.required<string>();
  readonly body = input<string | null>(null);
  /** One optional button; starts with a verb (Guidelines §15). */
  readonly actionLabel = input<string | null>(null);
  readonly action = output<void>();

  private readonly mode = inject(DisplayModeService).mode;
  private readonly artKey = computed<IllustrationKey>(() =>
    this.mode() === 'kid' ? 'mascot-owl' : this.illustration(),
  );
  protected readonly art = computed(() => illustrationUrl(this.artKey()));
  protected readonly artAlt = computed(() => EN.illustrations[this.artKey()]);
}
