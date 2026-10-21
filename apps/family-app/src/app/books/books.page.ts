import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApiError,
  BookApi,
  BookChapter,
  FamilyApi,
  FamilyChild,
  SubjectBookRow,
} from '@fullstar/core';
import {
  AVATAR_KEYS,
  Avatar,
  AvatarKey,
  Button,
  EN,
  Skeleton,
  StatusChip,
  ToastService,
  errorMessage,
} from '@fullstar/ui';
import { chipFor } from './book-status';

const AVATARS = new Set<string>(AVATAR_KEYS);

/**
 * P4 Books (App Flow §6, Schema §11; Plan 5.1): one row per subject of the chosen child's class with
 * the book status and each chapter's status; upload a whole book (P5), add a chapter (P7), or share
 * a book with a sibling in the same class. With two children, tabs choose the child (?child=).
 */
@Component({
  selector: 'app-books-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Button, Skeleton, StatusChip],
  template: `
    @if (children().length > 1) {
      <div class="tabs" role="tablist" [attr.aria-label]="text.childTabs">
        @for (child of children(); track child.id) {
          <button
            type="button"
            role="tab"
            class="tab"
            [class.tab--active]="child.id === childId()"
            [attr.aria-selected]="child.id === childId()"
            (click)="choose(child.id)"
          >
            <app-avatar [animal]="avatarOf(child)" [size]="40" />
            <span>{{ child.first_name }}</span>
          </button>
        }
      </div>
    }
    <p class="intro">{{ text.intro }} {{ text.practiceNote }}</p>

    @if (rows(); as list) {
      <ul class="rows" role="list">
        @for (row of list; track row.subject_id) {
          <li class="row">
            <div class="row__head">
              <span class="row__subject">{{ row.subject_name }}</span>
              <app-status-chip [status]="chip(row)" />
            </div>
            @if (row.book; as book) {
              @if (book.chapters.length) {
                <ul class="chapters" role="list">
                  @for (chapter of book.chapters; track chapter.id) {
                    <li class="chapter">
                      <span>{{ text.chapterLine(chapter.number, chapter.title) }}</span>
                      <app-status-chip [status]="chipOf(chapter.status)" />
                      @if (chapter.unclear_pages > 0) {
                        <app-button
                          variant="ghost"
                          icon="photo_camera"
                          [label]="text.fixPages(chapter.unclear_pages)"
                          (pressed)="fixPages(row, chapter.id)"
                        />
                      }
                    </li>
                  }
                </ul>
              }
              @if (book.latest_upload?.status === 'rejected') {
                <p class="warning" role="status">
                  {{ text.latestRejected(reason(book.latest_upload?.reject_reason ?? null)) }}
                </p>
              } @else if (book.latest_upload?.status === 'scanning') {
                <p class="note">{{ text.scanning }}</p>
              }
              @for (sibling of siblingsFor(row); track sibling.id) {
                @if (book.child_ids.includes(sibling.id)) {
                  <p class="note">{{ text.shared(sibling.first_name) }}</p>
                } @else {
                  <app-button
                    variant="ghost"
                    [label]="text.shareWith(sibling.first_name)"
                    (pressed)="share(book.id, sibling)"
                  />
                }
              }
            }
            <div class="row__actions">
              @if (row.book?.chapters?.some(isSuggested)) {
                <app-button
                  icon="fact_check"
                  [label]="text.checkChapters"
                  (pressed)="open(row, 'chapters')"
                />
              }
              @if (!row.book || (row.book.upload_mode === 'whole' && rejectedOnly(row))) {
                <app-button
                  variant="secondary"
                  [label]="text.uploadBook"
                  (pressed)="open(row, 'upload')"
                />
              }
              @if (!row.book || row.book.upload_mode === 'chapterwise') {
                <app-button
                  variant="secondary"
                  icon="add"
                  [label]="row.book?.chapters?.length ? text.addChapter : text.addFirstChapter"
                  (pressed)="open(row, 'add-chapter')"
                />
              }
            </div>
          </li>
        }
      </ul>
    } @else if (failure(); as message) {
      <p class="warning" role="alert">{{ message }}</p>
    } @else {
      <app-skeleton shape="list-card" [count]="4" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .tabs {
      display: flex;
      gap: var(--space-3);
    }
    .tab {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: 56px;
      padding: var(--space-1) var(--space-4) var(--space-1) var(--space-1);
      border: 2px solid var(--color-border);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      font: var(--type-label);
      color: var(--color-text);
      cursor: pointer;
    }
    .tab--active {
      border-color: var(--color-primary-600);
      background: var(--color-primary-100);
    }
    .tab:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .intro,
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .warning {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .rows,
    .chapters {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .rows {
      gap: var(--space-3);
    }
    .row {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .row__head,
    .chapter {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .row__subject {
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .chapters {
      gap: var(--space-2);
      font: var(--type-body);
      color: var(--color-text);
    }
    .row__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
  `,
})
export class BooksPage {
  protected readonly text = EN.books;
  protected readonly rows = signal<readonly SubjectBookRow[] | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly childId = signal<string | null>(null);

  private readonly family = inject(FamilyApi);
  private readonly books = inject(BookApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly children = computed<readonly FamilyChild[]>(
    () => this.family.me()?.children ?? [],
  );
  private readonly current = computed(
    () => this.children().find((child) => child.id === this.childId()) ?? null,
  );

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      const wanted = query.get('child');
      const run = (): void => {
        const list = this.children();
        const id = list.find((child) => child.id === wanted)?.id ?? list[0]?.id ?? null;
        this.childId.set(id);
        if (id) {
          this.load(id);
        }
      };
      if (this.family.me()) {
        run();
      } else {
        this.family
          .loadMe()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(() => run());
      }
    });
  }

  protected avatarOf(child: FamilyChild): AvatarKey {
    return (AVATARS.has(child.avatar_key) ? child.avatar_key : 'cat') as AvatarKey;
  }

  protected chip(row: SubjectBookRow) {
    return chipFor(row.book?.status ?? null);
  }

  protected chipOf(status: Parameters<typeof chipFor>[0]) {
    return chipFor(status);
  }

  protected reason(code: string | null): string {
    return (code && this.text.reasons[code]) || this.text.reasons['unreadable'];
  }

  /** A whole book whose only upload was refused can be sent again. */
  protected rejectedOnly(row: SubjectBookRow): boolean {
    const latest = row.book?.latest_upload;
    return !latest || latest.status === 'rejected' || latest.status === 'failed';
  }

  /** Siblings in the same class can share this book (Schema §4.3 child_books). */
  protected siblingsFor(row: SubjectBookRow): readonly FamilyChild[] {
    const me = this.current();
    if (!me || !row.book) {
      return [];
    }
    return this.children().filter(
      (child) => child.id !== me.id && child.class_level === me.class_level,
    );
  }

  protected choose(childId: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { child: childId },
      replaceUrl: true,
    });
  }

  protected readonly isSuggested = (chapter: BookChapter): boolean =>
    chapter.status === 'suggested';

  protected open(row: SubjectBookRow, page: 'upload' | 'add-chapter' | 'chapters'): void {
    void this.router.navigate(['/parent/books', row.subject, page], {
      queryParams: { child: this.childId() },
    });
  }

  protected fixPages(row: SubjectBookRow, chapterId: string): void {
    void this.router.navigate(['/parent/books', row.subject, 'fix-pages'], {
      queryParams: { child: this.childId(), chapter: chapterId },
    });
  }

  protected share(bookId: string, sibling: FamilyChild): void {
    this.books
      .share(bookId, sibling.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toasts.show(this.text.sharedDone(sibling.first_name));
          const id = this.childId();
          if (id) {
            this.load(id);
          }
        },
        error: (error: unknown) =>
          this.toasts.show(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
            {
              kind: 'error',
            },
          ),
      });
  }

  private load(childId: string): void {
    this.failure.set(null);
    this.books
      .books(childId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.rows.set(rows),
        error: (error: unknown) =>
          this.failure.set(
            `${this.text.loadFailed} ${errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent')}`,
          ),
      });
  }
}
