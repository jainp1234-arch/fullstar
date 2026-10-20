import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';
import { CurrentScreen } from './current-screen';

/**
 * Stands in for every screen until it is built (Plan 2.3): the screen ID, a note, and links to
 * the screens it leads to. Shells A, B and E show the title in their header; C and D here.
 */
@Component({
  selector: 'app-placeholder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="ph" [class.ph--sky]="onSky()">
      @if (shell() === 'celebration') {
        <img class="ph__owl" [src]="owl" alt="" width="160" height="160" />
      }
      @if (ownTitle()) {
        <h1 class="ph__title" tabindex="-1">{{ current.title() }}</h1>
      }
      <p class="ph__id">{{ current.screen()?.id }}</p>
      <p class="ph__body">{{ text.body }}</p>
      @if (current.links().length) {
        <h2 class="ph__heading">{{ text.goesTo }}</h2>
        <ul class="ph__links">
          @for (link of current.links(); track link.id) {
            <li>
              <a class="ph__link" [routerLink]="link.url">{{ link.id }} · {{ link.title }}</a>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .ph {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      color: var(--color-text);
    }
    .ph--sky {
      color: var(--color-text-on-sky);
    }
    .ph__owl {
      display: block;
      align-self: center;
    }
    .ph__title {
      margin: 0;
      font: var(--type-display);
      color: var(--color-ink-heading);
    }
    .ph--sky .ph__title {
      color: var(--color-text-on-sky);
      text-align: center;
    }
    .ph__title:focus {
      outline: none;
    }
    .ph__id {
      align-self: flex-start;
      margin: 0;
      padding: 2px var(--space-3);
      border-radius: var(--radius-pill);
      background: var(--color-primary-100);
      color: var(--color-primary-600);
      font: var(--type-small);
    }
    .ph--sky .ph__id {
      background: var(--color-sky-pill);
      color: var(--color-text-on-sky);
    }
    .ph__body {
      margin: 0;
      font: var(--type-body);
    }
    .ph__heading {
      margin: var(--space-4) 0 0;
      font: var(--type-h2);
    }
    .ph__links {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ph__link {
      display: flex;
      align-items: center;
      min-height: var(--tap-default);
      padding: 0 var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--edge-card);
      color: var(--color-primary-600);
      font: var(--type-label);
      text-decoration: none;
    }
    .ph__link:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
  `,
})
export class PlaceholderPage {
  protected readonly current = inject(CurrentScreen);
  protected readonly text = EN.placeholder;
  protected readonly owl = illustrationUrl('mascot-owl');
  protected readonly shell = computed(() => this.current.screen()?.shell);
  protected readonly ownTitle = computed(
    () => this.shell() === 'focus' || this.shell() === 'celebration',
  );
  protected readonly onSky = computed(
    () => this.shell() === 'sky-list' || this.shell() === 'celebration',
  );
}
