import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FamilyApi } from '@fullstar/core';
import { Button, EN, NoticeCard } from '@fullstar/ui';
import { PAGE_STYLES } from './page-styles';

/**
 * B3 Add books (App Flow §4). Plan 3.1: only "Later" for now; uploads arrive in Phase 5. Shows
 * the subjects of the children's classes and that grade-level practice is ready without a book.
 */
@Component({
  selector: 'app-setup-books-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, NoticeCard],
  template: `
    <h1 class="page__title" tabindex="-1">{{ title }}</h1>
    <p class="page__intro">{{ text.booksIntro }}</p>
    @if (subjects().length) {
      <ul class="subjects" role="list">
        @for (subject of subjects(); track subject) {
          <li class="subjects__row">
            <span>{{ subject }}</span>
            <span class="subjects__later">{{ text.later }}</span>
          </li>
        }
      </ul>
    }
    <app-notice-card
      illustration="empty-books"
      [title]="text.booksPracticeNote"
      [body]="text.booksLaterNote"
    />
    <app-button [label]="text.later" [fullWidth]="true" (pressed)="next()" />
  `,
  styles: [
    PAGE_STYLES,
    `
      .subjects {
        margin: 0;
        padding: 0;
        list-style: none;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-surface);
      }
      .subjects__row {
        display: flex;
        justify-content: space-between;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
        font: var(--type-body);
        color: var(--color-text);
      }
      .subjects__row + .subjects__row {
        border-top: 1px solid var(--color-border);
      }
      .subjects__later {
        font: var(--type-small);
        color: var(--color-text-2);
      }
    `,
  ],
})
export class SetupBooksPage {
  protected readonly title = EN.screens.B3;
  protected readonly text = EN.setup;

  private readonly family = inject(FamilyApi);
  private readonly router = inject(Router);
  private readonly config = toSignal(this.family.publicConfig(), { initialValue: null });

  /** One row per subject across the children's classes (App Flow B3). */
  protected readonly subjects = computed(() => {
    const levels = new Set((this.family.me()?.children ?? []).map((child) => child.class_level));
    const names = (this.config()?.classes ?? [])
      .filter((entry) => levels.has(entry.class_level))
      .flatMap((entry) => entry.subjects.map((subject) => subject.name));
    return [...new Set(names)];
  });

  protected next(): void {
    void this.router.navigateByUrl('/setup/time-limit');
  }
}
