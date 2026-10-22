import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { iconGlyph } from '../icons/icons';
import { IllustrationKey, illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';
import { CornerTab } from './corner-tab';
import { CardState } from './list-card';

/** app-tile (Guidelines §11): used in a grid of 3 (2 when labels exceed 12 characters). */
@Component({
  selector: 'app-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CornerTab],
  template: `
    <button
      type="button"
      class="tile"
      [class.tile--offline]="state() === 'offline'"
      [attr.aria-disabled]="state() === 'offline' || null"
      (click)="pressed.emit(state())"
    >
      <img [src]="art()" [alt]="artAlt()" width="64" height="64" />
      <span class="tile__label">{{ label() }}</span>
      @if (state() === 'locked') {
        <app-corner-tab [text]="comingSoon" tone="gold" />
      }
      @if (state() === 'offline') {
        <span class="ui-icon tile__offline" [attr.aria-label]="offlineLabel" role="img">{{
          offlineGlyph
        }}</span>
      }
    </button>
  `,
  styles: `
    :host {
      display: block;
    }
    .tile {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      width: 100%;
      min-height: 132px;
      padding: var(--space-4) var(--space-2);
      box-sizing: border-box;
      border: 0;
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--edge-tile), var(--shadow-soft);
      color: var(--color-text);
      cursor: pointer;
      transition:
        transform calc(var(--dur-press) * 1.5) var(--ease-standard),
        box-shadow var(--dur-fast) var(--ease-standard);
    }
    @media (hover: hover) {
      .tile:hover {
        transform: translateY(-1px);
        box-shadow: var(--edge-tile), var(--shadow-soft), var(--shadow-soft);
      }
    }
    .tile:active {
      transform: translateY(2px);
      box-shadow:
        0 2px 0 var(--color-primary-400),
        var(--shadow-soft);
      transition-duration: var(--dur-press);
    }
    .tile:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .tile--offline {
      opacity: 0.5;
    }
    .tile__label {
      font: var(--type-label);
      text-align: center;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .tile__offline {
      position: absolute;
      top: var(--space-2);
      right: var(--space-2);
      font-size: 20px;
      color: var(--color-text-muted);
    }
  `,
})
export class Tile {
  readonly illustration = input.required<IllustrationKey>();
  readonly label = input.required<string>();
  readonly state = input<CardState>('normal');
  readonly pressed = output<CardState>();

  protected readonly comingSoon = EN.common.comingSoon;
  protected readonly offlineGlyph = iconGlyph('cloud_off');
  protected readonly offlineLabel = EN.common.offlineItem;
  protected readonly artKey = computed<IllustrationKey>(() =>
    this.state() === 'locked' ? 'state-wait' : this.illustration(),
  );
  protected readonly art = computed(() => illustrationUrl(this.artKey()));
  /** No alt when it would only repeat the label (WCAG: the button already says it). */
  protected readonly artAlt = computed(() => {
    const alt = EN.illustrations[this.artKey()];
    return this.label().toLowerCase().includes(alt.toLowerCase()) ? '' : alt;
  });
}
