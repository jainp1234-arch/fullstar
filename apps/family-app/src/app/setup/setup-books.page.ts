import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FamilyApi } from '@fullstar/core';
import { Button, EN, NoticeCard } from '@fullstar/ui';
import { PAGE_STYLES } from './page-styles';

interface SubjectRow {
  readonly code: string;
  readonly name: string;
}

/**
 * B3 Add books (App Flow §4; Plan 5.1). One row per subject of the first child's class with Upload
 * book (P5), Add first chapter (P7) or Later; the upload screens return here (?next=). Grade-level
 * practice is ready without a book, and P4 keeps reminding until each subject has one.
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
        @for (subject of subjects(); track subject.code) {
          <li class="subjects__row">
            <span class="subjects__name">{{ subject.name }}</span>
            <div class="subjects__actions">
              <app-button
                variant="secondary"
                [label]="books.uploadBook"
                (pressed)="open(subject, 'upload')"
              />
              <app-button
                variant="ghost"
                [label]="books.addFirstChapter"
                (pressed)="open(subject, 'add-chapter')"
              />
            </div>
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
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
        font: var(--type-body);
        color: var(--color-text);
      }
      .subjects__row + .subjects__row {
        border-top: 1px solid var(--color-border);
      }
      .subjects__name {
        font: var(--type-label);
      }
      .subjects__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
    `,
  ],
})
export class SetupBooksPage {
  protected readonly title = EN.screens.B3;
  protected readonly text = EN.setup;
  protected readonly books = EN.books;

  private readonly family = inject(FamilyApi);
  private readonly router = inject(Router);
  private readonly config = toSignal(this.family.publicConfig(), { initialValue: null });
  private readonly child = computed(() => this.family.me()?.children[0] ?? null);

  /** The subjects of the first child's class (App Flow B3). */
  protected readonly subjects = computed<readonly SubjectRow[]>(() => {
    const level = this.child()?.class_level;
    const entry = (this.config()?.classes ?? []).find((c) => c.class_level === level);
    return (entry?.subjects ?? []).map((subject) => ({ code: subject.code, name: subject.name }));
  });

  protected open(subject: SubjectRow, page: 'upload' | 'add-chapter'): void {
    void this.router.navigate(['/parent/books', subject.code, page], {
      queryParams: { child: this.child()?.id, next: '/setup/books' },
    });
  }

  protected next(): void {
    void this.router.navigateByUrl('/setup/time-limit');
  }
}
