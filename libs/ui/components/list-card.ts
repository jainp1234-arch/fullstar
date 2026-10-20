import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { iconGlyph } from '../icons/icons';
import { IllustrationKey, illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';
import { CornerTab, CornerTabTone } from './corner-tab';

/** Guidelines §12: locked shows state-wait and "Coming soon"; offline is dimmed with cloud_off. */
export type CardState = 'normal' | 'locked' | 'offline';

/** app-list-card (Guidelines §11): the whole card is one button. */
@Component({
  selector: 'app-list-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CornerTab],
  template: `
    <button
      type="button"
      class="card"
      [class.card--offline]="state() === 'offline'"
      [attr.aria-disabled]="state() === 'offline' || null"
      (click)="pressed.emit(state())"
    >
      <span class="card__art">
        <img [src]="art()" [alt]="artAlt()" width="56" height="56" />
      </span>
      <span class="card__text">
        <span class="card__title">{{ title() }}</span>
        @if (subtitle(); as text) {
          <span class="card__subtitle">{{ text }}</span>
        }
      </span>
      @if (chevron()) {
        <span class="ui-icon card__chevron" aria-hidden="true">{{ chevronGlyph }}</span>
      }
      @if (tab(); as shownTab) {
        <app-corner-tab [text]="shownTab.text" [tone]="shownTab.tone" />
      }
      @if (state() === 'offline') {
        <span class="ui-icon card__offline" [attr.aria-label]="offlineLabel" role="img">{{
          offlineGlyph
        }}</span>
      }
    </button>
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--space-4);
      width: 100%;
      min-height: 96px;
      padding: var(--space-5) var(--space-4);
      box-sizing: border-box;
      border: 0;
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--edge-card), var(--shadow-soft);
      color: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        transform calc(var(--dur-press) * 1.5) var(--ease-standard),
        box-shadow var(--dur-fast) var(--ease-standard);
    }
    @media (hover: hover) {
      .card:hover {
        transform: translateY(-1px);
        box-shadow: var(--edge-card), var(--shadow-soft), var(--shadow-soft);
      }
    }
    .card:active {
      transform: translateY(2px);
      box-shadow:
        0 2px 0 var(--color-edge),
        var(--shadow-soft);
      transition-duration: var(--dur-press);
    }
    .card:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .card--offline {
      opacity: 0.5;
    }
    .card__art {
      flex: none;
      display: grid;
      place-items: center;
      padding: var(--space-2);
      border-radius: 14px;
      background: var(--color-primary-100);
    }
    .card__art img {
      display: block;
    }
    .card__text {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
    }
    .card__title {
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .card__subtitle {
      font: var(--type-small);
      font-weight: 400;
      color: var(--color-text-2);
    }
    .card__chevron {
      margin-left: auto;
      color: var(--color-text-muted);
    }
    .card__offline {
      position: absolute;
      right: var(--space-3);
      bottom: var(--space-3);
      font-size: 20px;
      color: var(--color-text-muted);
    }
  `,
})
export class ListCard {
  readonly illustration = input.required<IllustrationKey>();
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly cornerTab = input<{ text: string; tone: CornerTabTone } | null>(null);
  readonly state = input<CardState>('normal');
  /** Trailing chevron: parent mode only. */
  readonly chevron = input(false);
  /** Emits the state, so a locked or offline tap can show a toast (Guidelines §12). */
  readonly pressed = output<CardState>();

  protected readonly chevronGlyph = iconGlyph('chevron_right');
  protected readonly offlineGlyph = iconGlyph('cloud_off');
  protected readonly offlineLabel = EN.common.offlineItem;

  protected readonly artKey = computed<IllustrationKey>(() =>
    this.state() === 'locked' ? 'state-wait' : this.illustration(),
  );
  protected readonly art = computed(() => illustrationUrl(this.artKey()));
  protected readonly artAlt = computed(() => EN.illustrations[this.artKey()]);
  protected readonly tab = computed(() =>
    this.state() === 'locked'
      ? { text: EN.common.comingSoon, tone: 'gold' as const }
      : this.cornerTab(),
  );
}
