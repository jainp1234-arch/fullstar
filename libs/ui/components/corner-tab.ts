import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** gold: "Chapter n", "New", "Coming soon"; blue: "Class 3 practice"; green: "Done". */
export type CornerTabTone = 'gold' | 'blue' | 'green';

/** app-corner-tab (Guidelines §11): attached to a card's top-right corner. */
@Component({
  selector: 'app-corner-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [class]="'tab tab--' + tone()">{{ text() }}</span>`,
  styles: `
    :host {
      position: absolute;
      top: 0;
      right: 0;
    }
    .tab {
      display: block;
      padding: 3px 14px;
      border-radius: 0 var(--radius-lg) 0 14px;
      font: var(--type-small);
      font-weight: 600;
    }
    .tab--gold {
      background: var(--color-gold-100);
      color: var(--color-gold-800);
    }
    .tab--blue {
      background: var(--color-blue-100);
      color: var(--color-blue-700);
    }
    .tab--green {
      background: var(--color-success-100);
      color: var(--color-success-700);
    }
  `,
})
export class CornerTab {
  readonly text = input.required<string>();
  readonly tone = input<CornerTabTone>('gold');
}
