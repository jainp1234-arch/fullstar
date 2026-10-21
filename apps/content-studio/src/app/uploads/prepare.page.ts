import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApiError,
  CatalogBook,
  ContentApi,
  ContentSummary,
  FamilyPage,
  MIN_CHAPTER_QUESTIONS,
  PrepApi,
  PrepTaskDetail,
} from '@fullstar/core';
import {
  Button,
  EN,
  SectionHeader,
  Skeleton,
  TextField,
  ToastService,
  errorMessage,
  fieldMessage,
} from '@fullstar/ui';

const TITLE_MAX = 200;

/**
 * S9 Prepare chapter (App Flow §7, Schema §11; Plan 5.5, decided 22 Oct 2026: a hub that reuses
 * S4–S6). Left: the family's pages and their text. Right: the prepared (catalog) book and chapter
 * this upload is linked to, found or created here; the chapter's lessons and questions with their
 * status; drafting with Claude from the chapter text (S4), then S5 → S11 → S6 as for library
 * content; and Mark chapter ready, which gives every linked family its lessons.
 */
@Component({
  selector: 'app-prepare-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ReactiveFormsModule, SectionHeader, Skeleton, TextField],
  template: `
    @if (detail(); as d) {
      <p class="lead">
        {{
          uploads.chapterLine(
            d.task.class_level,
            d.task.subject_name,
            d.task.chapter_number,
            d.task.chapter_title
          )
        }}
        · {{ uploads.family(d.task.family_ref) }}
      </p>
      @if (d.task.status === 'open') {
        <div class="notice" role="status">
          <span>{{ text.claimFirst }}</span>
          <app-button [label]="text.claim" [loading]="busy() === 'claim'" (pressed)="claim()" />
        </div>
      } @else if (d.task.status === 'done') {
        <p class="note" role="status">{{ text.done }}</p>
      }
      <div class="columns">
        <section class="pages" [attr.aria-label]="text.pagesTitle">
          <app-section-header [title]="text.pagesTitle" />
          @if (pages(); as list) {
            @for (page of list; track page.id) {
              <figure class="page">
                <img
                  [src]="page.image_url"
                  [alt]="text.pageLabel(page.page_no)"
                  width="300"
                  height="400"
                  loading="lazy"
                />
                <figcaption>
                  <strong>{{ text.pageLabel(page.page_no) }}</strong>
                  @if (page.quality === 'unclear') {
                    · {{ text.unclear }}
                  }
                  <p class="page__text" [attr.lang]="d.task.subject === 'hindi' ? 'hi' : null">
                    {{ page.text }}
                  </p>
                </figcaption>
              </figure>
            }
          } @else {
            <app-skeleton shape="list-card" [count]="2" />
          }
        </section>

        <section class="side">
          <app-section-header [title]="text.catalogTitle" />
          @if (d.catalog; as link) {
            <p class="note">
              {{ link.book_title }} · {{ link.number }}. {{ link.title }} ·
              {{ text.chapterStatus[link.status] }}
            </p>
            <app-section-header [title]="text.contentTitle" />
            <p class="note">
              {{ text.counts(link.published_lessons, link.published_questions, link.unpublished) }}
            </p>
            @if (link.status !== 'ready') {
              <div class="actions">
                <app-button
                  variant="secondary"
                  [label]="text.draftLesson"
                  (pressed)="draft('lesson')"
                />
                <app-button
                  variant="secondary"
                  [label]="text.draftQuestions"
                  (pressed)="draft('question_bank')"
                />
              </div>
            }
            @if (items(); as list) {
              <ul class="items" role="list">
                @for (item of list; track item.id) {
                  <li class="item">
                    <span>
                      {{ library.kinds[item.kind] }} · {{ item.title }} ·
                      {{ library.statuses[item.status] }}
                    </span>
                    <app-button
                      variant="ghost"
                      [label]="text.openItem"
                      [ariaLabel]="text.openItem + ' ' + item.title"
                      (pressed)="openItem(item)"
                    />
                  </li>
                }
              </ul>
            }
            @if (link.status !== 'ready') {
              <p class="note">{{ text.readyRule(minQuestions) }}</p>
              <app-button
                [label]="text.markReady"
                [loading]="busy() === 'ready'"
                [disabled]="busy() !== null"
                (pressed)="markReady(link.catalog_chapter_id)"
              />
            }
          } @else {
            <p class="note">{{ text.catalogIntro }}</p>
            <form class="row" [formGroup]="searchForm" novalidate (submit)="search($event)">
              <app-text-field formControlName="q" [label]="text.search" />
              <app-button type="submit" variant="secondary" [label]="text.searchButton" />
            </form>
            @if (books(); as list) {
              @if (!list.length) {
                <p class="note">{{ text.noBooks }}</p>
              }
              @for (book of list; track book.id) {
                <div class="book">
                  <strong>{{ book.title }}</strong>
                  @if (book.publisher || book.edition) {
                    <span class="note">{{ book.publisher }} {{ book.edition }}</span>
                  }
                  <ul class="items" role="list">
                    @for (chapter of book.chapters; track chapter.id) {
                      <li class="item">
                        <span>
                          {{ chapter.number }}. {{ chapter.title }} ·
                          {{ text.chapterStatus[chapter.status] }}
                        </span>
                        <app-button
                          variant="secondary"
                          [label]="text.link"
                          [ariaLabel]="text.link + ' ' + chapter.title"
                          [disabled]="busy() !== null || d.task.status === 'done'"
                          (pressed)="link(chapter.id, chapter.title)"
                        />
                      </li>
                    }
                  </ul>
                  <form
                    class="row"
                    [formGroup]="chapterForm"
                    novalidate
                    (submit)="addChapter($event, book)"
                  >
                    <app-text-field
                      formControlName="number"
                      inputMode="numeric"
                      [label]="text.chapterNumber"
                    />
                    <app-text-field
                      formControlName="title"
                      [label]="text.chapterTitle"
                      [maxLength]="titleMax"
                    />
                    <app-button
                      type="submit"
                      variant="ghost"
                      icon="add"
                      [label]="text.createChapter"
                    />
                  </form>
                </div>
              }
            }
            <app-section-header [title]="text.newBook" />
            <form class="stack" [formGroup]="bookForm" novalidate (submit)="createBook($event)">
              <app-text-field
                formControlName="title"
                [label]="text.bookTitle"
                [maxLength]="titleMax"
                [error]="bookTitleError()"
              />
              <app-text-field formControlName="publisher" [label]="text.publisher" />
              <app-text-field formControlName="edition" [label]="text.edition" />
              <app-button
                type="submit"
                variant="secondary"
                [label]="text.createBook"
                [loading]="busy() === 'book'"
              />
            </form>
          }
          @if (failure(); as message) {
            <p class="warning" role="alert">{{ message }}</p>
          }
        </section>
      </div>
    } @else if (failure(); as message) {
      <p class="warning" role="alert">{{ message }}</p>
    } @else {
      <app-skeleton shape="list-card" [count]="3" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .lead {
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
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .notice {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-primary-100);
      font: var(--type-body);
    }
    .columns {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--space-6);
    }
    @media (max-width: 900px) {
      .columns {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .pages,
    .side,
    .stack,
    .book {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: var(--space-3);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
      font: var(--type-small);
    }
    .page img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--radius-sm);
    }
    .page__text {
      margin: var(--space-2) 0 0;
      font: var(--type-body);
      white-space: pre-wrap;
    }
    .book {
      padding: var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }
    .items {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item,
    .row,
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      font: var(--type-body);
    }
    .row {
      align-items: flex-end;
      justify-content: flex-start;
    }
  `,
})
export class PreparePage {
  protected readonly text = EN.studio.prepare;
  protected readonly uploads = EN.studio.uploads;
  protected readonly library = EN.studio;
  protected readonly titleMax = TITLE_MAX;
  protected readonly minQuestions = MIN_CHAPTER_QUESTIONS;

  protected readonly detail = signal<PrepTaskDetail | null>(null);
  protected readonly pages = signal<readonly FamilyPage[] | null>(null);
  protected readonly books = signal<readonly CatalogBook[] | null>(null);
  protected readonly items = signal<readonly ContentSummary[] | null>(null);
  protected readonly busy = signal<'claim' | 'book' | 'link' | 'ready' | 'chapter' | null>(null);
  protected readonly failure = signal<string | null>(null);
  private readonly bookSubmitted = signal(false);

  protected readonly searchForm = new FormGroup({
    q: new FormControl('', { nonNullable: true }),
  });
  protected readonly bookForm = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(TITLE_MAX)],
    }),
    publisher: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
    edition: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
  });
  protected readonly chapterForm = new FormGroup({
    number: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{1,2}$/)],
    }),
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(TITLE_MAX)],
    }),
  });

  private readonly prep = inject(PrepApi);
  private readonly content = inject(ContentApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly taskId = this.route.snapshot.paramMap.get('taskId') ?? '';
  private readonly task = computed(() => this.detail()?.task ?? null);

  constructor() {
    this.load();
  }

  protected bookTitleError(): string | null {
    const control = this.bookForm.controls.title;
    if (!(control.touched || this.bookSubmitted()) || control.valid) {
      return null;
    }
    return control.errors?.['maxlength']
      ? fieldMessage('INVALID_LENGTH')
      : fieldMessage('REQUIRED');
  }

  protected claim(): void {
    this.busy.set('claim');
    this.prep
      .claim(this.taskId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(null);
          this.load();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected search(event: Event): void {
    event.preventDefault();
    const task = this.task();
    if (!task) {
      return;
    }
    this.prep
      .books(task.class_level, task.subject, this.searchForm.controls.q.value.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (books) => this.books.set(books),
        error: (error: unknown) => this.fail(error),
      });
  }

  protected createBook(event: Event): void {
    event.preventDefault();
    this.bookSubmitted.set(true);
    const task = this.task();
    if (!task || this.bookForm.invalid) {
      this.bookForm.markAllAsTouched();
      return;
    }
    const form = this.bookForm.getRawValue();
    this.busy.set('book');
    this.prep
      .createBook({
        class_level: task.class_level,
        subject: task.subject,
        title: form.title.trim(),
        ...(form.publisher.trim() ? { publisher: form.publisher.trim() } : {}),
        ...(form.edition.trim() ? { edition: form.edition.trim() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (book) => {
          this.busy.set(null);
          this.bookForm.reset();
          this.bookSubmitted.set(false);
          this.books.set([book, ...(this.books() ?? []).filter((b) => b.id !== book.id)]);
          this.chapterForm.reset({
            number: String(task.chapter_number),
            title: task.chapter_title,
          });
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected addChapter(event: Event, book: CatalogBook): void {
    event.preventDefault();
    if (this.chapterForm.invalid) {
      this.chapterForm.markAllAsTouched();
      return;
    }
    const form = this.chapterForm.getRawValue();
    this.busy.set('chapter');
    this.prep
      .createChapter(book.id, Number(form.number), form.title.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.busy.set(null);
          this.chapterForm.reset();
          this.books.set((this.books() ?? []).map((b) => (b.id === updated.id ? updated : b)));
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected link(catalogChapterId: string, title: string): void {
    this.busy.set('link');
    this.prep
      .link(this.taskId, catalogChapterId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.busy.set(null);
          this.toasts.show(
            detail.task.status === 'done' ? this.text.instant : this.text.linked(title),
          );
          this.show(detail);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  /** S4 with the chapter's text; saves come back here. */
  protected draft(type: 'lesson' | 'question_bank'): void {
    const d = this.detail();
    if (!d?.catalog) {
      return;
    }
    void this.router.navigate(['/library/draft'], {
      queryParams: {
        type,
        class: d.task.class_level,
        subject: d.task.subject,
        family_chapter: d.task.family_chapter_id,
        catalog_chapter: d.catalog.catalog_chapter_id,
        task: d.task.id,
      },
    });
  }

  protected openItem(item: ContentSummary): void {
    void this.router.navigate(['/library', item.id, 'edit']);
  }

  protected markReady(catalogChapterId: string): void {
    this.busy.set('ready');
    this.failure.set(null);
    this.prep
      .markReady(catalogChapterId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(null);
          this.toasts.show(this.text.ready);
          this.load();
        },
        error: (error: unknown) => {
          // 409 names what is missing
          if (error instanceof ApiError && error.code === 'CONFLICT') {
            this.busy.set(null);
            this.failure.set(error.message);
            return;
          }
          this.fail(error);
        },
      });
  }

  private load(): void {
    this.prep
      .task(this.taskId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.show(detail);
          if (!this.pages()) {
            this.prep
              .pages(detail.task.family_chapter_id)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (pages) => this.pages.set(pages),
                error: (error: unknown) => this.fail(error),
              });
          }
        },
        error: (error: unknown) =>
          this.failure.set(
            `${this.text.loadFailed} ${errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio')}`,
          ),
      });
  }

  private show(detail: PrepTaskDetail): void {
    this.detail.set(detail);
    this.failure.set(null);
    if (!detail.catalog) {
      if (!this.chapterForm.dirty) {
        this.chapterForm.reset({
          number: String(detail.task.chapter_number),
          title: detail.task.chapter_title,
        });
      }
      return;
    }
    this.content
      .items({ catalog_chapter_id: detail.catalog.catalog_chapter_id, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => this.items.set(page.items),
        error: (error: unknown) => this.fail(error),
      });
  }

  private fail(error: unknown): void {
    this.busy.set(null);
    const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    this.failure.set(errorMessage(code, 'studio'));
  }
}
