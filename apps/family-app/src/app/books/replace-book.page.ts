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
import { ApiError, BookApi, FamilyApi, SubjectBookRow } from '@fullstar/core';
import { Button, EN, Skeleton, errorMessage } from '@fullstar/ui';

/**
 * P9 Replace book (App Flow §6, Schema §11; Plan 7.4, decided 22 Oct 2026): warns which children lose
 * their progress on the book's chapters, then removes the book for all of them. The subject is back
 * to "No book", so the parent uploads the new one whole (P5) or chapter by chapter (P7).
 */
@Component({
  selector: 'app-replace-book-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Skeleton],
  template: `
    @if (replaced()) {
      <p class="note" role="status">{{ text.replaced }}</p>
      <div class="actions">
        <app-button [label]="text.uploadWhole" (pressed)="upload('upload')" />
        <app-button
          variant="secondary"
          [label]="text.uploadByChapter"
          (pressed)="upload('add-chapter')"
        />
      </div>
    } @else if (row(); as r) {
      @if (r.book; as book) {
        <section class="card" aria-labelledby="replace-title">
          <h2 id="replace-title" class="title">{{ text.replaceIntro(r.subject_name) }}</h2>
          <p class="warning">{{ text.replaceWarning(users()) }}</p>
          <p class="note">{{ text.replaceChapters(book.chapters.length) }}</p>
          @if (failure(); as message) {
            <p class="warning" role="alert">{{ message }}</p>
          }
          <div class="actions">
            <app-button
              variant="danger"
              [label]="text.replaceConfirm"
              [loading]="busy()"
              (pressed)="replace(book.id)"
            />
            <app-button variant="ghost" [label]="text.keepBook" (pressed)="leave()" />
          </div>
        </section>
      } @else {
        <p class="note">{{ text.noBookToReplace }}</p>
        <app-button variant="secondary" [label]="text.backToBooks" (pressed)="leave()" />
      }
    } @else if (failure(); as message) {
      <p class="warning" role="alert">{{ message }}</p>
    } @else {
      <app-skeleton shape="list-card" [count]="1" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .title {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .warning {
      margin: 0;
      font: var(--type-body);
      color: var(--color-error-700);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
  `,
})
export class ReplaceBookPage {
  protected readonly text = EN.books;
  protected readonly row = signal<SubjectBookRow | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly replaced = signal(false);

  private readonly family = inject(FamilyApi);
  private readonly api = inject(BookApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly subject = this.route.snapshot.paramMap.get('subject') ?? '';
  private readonly childId = signal<string | null>(null);

  /** The children who use the book, by first name. */
  protected readonly users = computed(() => {
    const ids = this.row()?.book?.child_ids ?? [];
    const names = (this.family.me()?.children ?? [])
      .filter((child) => ids.includes(child.id))
      .map((child) => child.first_name);
    return this.text.and(names);
  });

  constructor() {
    const run = (): void => {
      const children = this.family.me()?.children ?? [];
      const wanted = this.route.snapshot.queryParamMap.get('child');
      const id = children.find((child) => child.id === wanted)?.id ?? children[0]?.id ?? null;
      this.childId.set(id);
      if (!id) {
        this.failure.set(errorMessage('NOT_FOUND', 'parent'));
        return;
      }
      this.api
        .books(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (rows) => {
            const row = rows.find((r) => r.subject === this.subject);
            if (row) {
              this.row.set(row);
            } else {
              this.failure.set(errorMessage('NOT_FOUND', 'parent'));
            }
          },
          error: (error: unknown) => this.fail(error),
        });
    };
    if (this.family.me()) {
      run();
    } else {
      this.family
        .loadMe()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: () => run(), error: (error: unknown) => this.fail(error) });
    }
  }

  protected replace(bookId: string): void {
    this.busy.set(true);
    this.failure.set(null);
    this.api
      .replace(bookId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.replaced.set(true);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected upload(page: 'upload' | 'add-chapter'): void {
    void this.router.navigate(['/parent/books', this.subject, page], {
      queryParams: { child: this.childId() },
      replaceUrl: true,
    });
  }

  protected leave(): void {
    void this.router.navigate(['/parent/books'], { queryParams: { child: this.childId() } });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.failure.set(
      errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
    );
  }
}
