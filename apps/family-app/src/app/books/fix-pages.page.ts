import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiError, BookApi, BookPage } from '@fullstar/core';
import { Button, EN, PageThumb, Skeleton, UploadZone, errorMessage } from '@fullstar/ui';

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);
const PHOTO_MAX_BYTES = 10_485_760;

/**
 * P8 Fix unclear pages (App Flow §6, Schema §11; Plan 5.3): only the pages book-reader could not
 * read, each with Retake. A new photo goes straight to storage with its signed URL, then that page
 * alone is checked and read again. ?chapter= names the chapter, ?child= the child for going back.
 */
@Component({
  selector: 'app-fix-pages-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, PageThumb, Skeleton, UploadZone],
  template: `
    @if (pages(); as list) {
      @if (list.length) {
        <p class="intro">{{ text.intro }}</p>
        <p class="note">{{ text.tips }}</p>
        @if (retaking(); as page) {
          <app-upload-zone
            [title]="text.retakeTitle(page.page_no)"
            [limits]="text.retakeLimits"
            [disabled]="busy()"
            (filesSelected)="send(page, $event)"
          />
          <app-button
            variant="ghost"
            [label]="text.cancel"
            [disabled]="busy()"
            (pressed)="retaking.set(null)"
          />
        } @else {
          <div class="thumbs">
            @for (page of list; track page.id) {
              <app-page-thumb
                [src]="page.image_url"
                [page]="page.page_no"
                [unclear]="true"
                (retake)="choose(page)"
              />
            }
          </div>
        }
      } @else {
        <p class="done" role="status">{{ text.allClear }}</p>
      }
      @for (line of sent(); track line) {
        <p class="note" role="status">{{ line }}</p>
      }
      @if (failure(); as message) {
        <p class="warning" role="alert">{{ message }}</p>
      }
      <app-button variant="secondary" [label]="books.backToBooks" (pressed)="leave()" />
    } @else if (failure(); as message) {
      <p class="warning" role="alert">{{ message }}</p>
      <app-button variant="secondary" [label]="books.backToBooks" (pressed)="leave()" />
    } @else {
      <app-skeleton shape="list-card" [count]="2" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .intro,
    .note,
    .done {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .done {
      color: var(--color-text);
    }
    .warning {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .thumbs {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
      gap: var(--space-4);
    }
  `,
})
export class FixPagesPage {
  protected readonly text = EN.fixPages;
  protected readonly books = EN.books;

  protected readonly pages = signal<readonly BookPage[] | null>(null);
  protected readonly retaking = signal<BookPage | null>(null);
  protected readonly busy = signal(false);
  protected readonly sent = signal<readonly string[]>([]);
  protected readonly failure = signal<string | null>(null);

  private readonly api = inject(BookApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const chapterId = this.route.snapshot.queryParamMap.get('chapter');
    if (!chapterId) {
      this.failure.set(errorMessage('NOT_FOUND', 'parent'));
      return;
    }
    this.api
      .pages(chapterId, 'unclear')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.pages.set(list),
        error: (error: unknown) => this.fail(error),
      });
  }

  protected choose(page: BookPage): void {
    this.failure.set(null);
    this.retaking.set(page);
  }

  protected send(page: BookPage, files: File[]): void {
    const photo = files[0];
    if (files.length !== 1 || !PHOTO_TYPES.has(photo.type)) {
      this.failure.set(this.text.onePhoto);
      return;
    }
    if (photo.size > PHOTO_MAX_BYTES) {
      this.failure.set(errorMessage('UPLOAD_LIMIT', 'parent'));
      return;
    }
    this.busy.set(true);
    this.failure.set(null);
    this.api
      .retake(page.id, photo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (step) => {
          if (step.kind !== 'done') {
            return;
          }
          this.busy.set(false);
          this.retaking.set(null);
          if (step.upload.status === 'rejected') {
            this.failure.set(
              this.books.rejected(
                this.books.reasons[step.upload.reject_reason ?? 'unreadable'] ??
                  this.books.reasons['unreadable'],
              ),
            );
            return;
          }
          this.pages.update((list) => (list ?? []).filter((p) => p.id !== page.id));
          this.sent.update((lines) => [...lines, this.text.sent(page.page_no)]);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected leave(): void {
    const child = this.route.snapshot.queryParamMap.get('child') ?? '';
    void this.router.navigateByUrl(`/parent/books?child=${child}`);
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.failure.set(
      errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
    );
  }
}
