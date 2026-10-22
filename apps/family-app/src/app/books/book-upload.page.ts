import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApiError,
  BookApi,
  BookUpload,
  FamilyApi,
  FamilyBook,
  SubjectBookRow,
  UploadRequest,
} from '@fullstar/core';
import {
  Button,
  CurrentScreen,
  EN,
  PageThumb,
  TextField,
  UploadZone,
  errorMessage,
  fieldMessage,
} from '@fullstar/ui';
import { Observable, of, switchMap } from 'rxjs';

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);
const TITLE_MAX = 200;
const THUMBS_SHOWN = 12;

interface Picked {
  readonly files: readonly File[];
  readonly source: 'pdf' | 'photos';
  readonly previews: readonly string[];
}

/**
 * P5 Upload whole book and P7 Add a chapter (App Flow §6, Schema §8.4, §11; Plan 5.1). Pick a PDF or
 * photos, check the limits on the device, send the files straight to storage with the signed URLs,
 * then complete: the API checks the files and starts the virus scan. ?child= chooses the child;
 * ?next= returns to setup (B3).
 */
@Component({
  selector: 'app-book-upload-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, PageThumb, ReactiveFormsModule, TextField, UploadZone],
  template: `
    <p class="intro">{{ chapterMode() ? text.chapterIntro : text.wholeIntro }}</p>
    @if (blocked(); as message) {
      <p class="warning" role="status">{{ message }}</p>
      <app-button variant="secondary" [label]="text.backToBooks" (pressed)="leave()" />
    } @else if (result(); as done) {
      @if (done.status === 'rejected') {
        <p class="warning" role="alert">
          {{
            done.reject_reason === 'infected'
              ? text.infected
              : text.rejected(reason(done.reject_reason))
          }}
        </p>
        <app-button [label]="text.clear" (pressed)="reset()" />
      } @else {
        <p class="done" role="status">{{ text.sent }}</p>
        <app-button [label]="text.backToBooks" (pressed)="leave()" />
      }
    } @else {
      @if (chapterMode()) {
        <form class="form" [formGroup]="chapter" novalidate (submit)="$event.preventDefault()">
          <app-text-field
            formControlName="number"
            inputMode="numeric"
            [label]="text.chapterNumber"
            [error]="numberError()"
          />
          <app-text-field
            formControlName="title"
            [label]="text.chapterTitle"
            [maxLength]="titleMax"
            [error]="titleError()"
          />
        </form>
      }
      @if (picked(); as chosen) {
        <p class="note">
          {{
            chosen.source === 'pdf'
              ? text.selectedPdf(chosen.files[0].name, megabytes(chosen.files[0].size))
              : text.selectedPhotos(chosen.files.length)
          }}
        </p>
        @if (chosen.previews.length) {
          <div class="thumbs">
            @for (src of chosen.previews; track src; let i = $index) {
              <app-page-thumb [src]="src" [page]="i + 1" />
            }
          </div>
        }
        <div class="actions">
          <app-button
            [label]="progress() ?? text.send"
            [loading]="busy()"
            [disabled]="busy()"
            (pressed)="send(chosen)"
          />
          <app-button
            variant="ghost"
            [label]="text.clear"
            [disabled]="busy()"
            (pressed)="reset()"
          />
        </div>
      } @else {
        <app-upload-zone (filesSelected)="pick($event)" />
      }
      @if (failure(); as message) {
        <p class="warning" role="alert">{{ message }}</p>
      }
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
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .thumbs {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
      gap: var(--space-3);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
  `,
})
export class BookUploadPage {
  protected readonly text = EN.books;
  protected readonly titleMax = TITLE_MAX;
  protected readonly chapterMode = computed(() => this.screen.screen()?.id === 'P7');

  protected readonly chapter = new FormGroup({
    number: new FormControl('1', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{1,2}$/)],
    }),
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(TITLE_MAX)],
    }),
  });

  protected readonly picked = signal<Picked | null>(null);
  protected readonly busy = signal(false);
  protected readonly progress = signal<string | null>(null);
  protected readonly result = signal<BookUpload | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly blocked = signal<string | null>(null);
  private readonly row = signal<SubjectBookRow | null>(null);
  private readonly submitted = signal(false);

  private readonly screen = inject(CurrentScreen);
  private readonly family = inject(FamilyApi);
  private readonly books = inject(BookApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly config = toSignal(this.family.publicConfig(), { initialValue: null });
  private childId: string | null = null;

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    const subject = this.route.snapshot.paramMap.get('subject');
    const start = (): void => {
      const children = this.family.me()?.children ?? [];
      this.childId =
        children.find((c) => c.id === query.get('child'))?.id ?? children[0]?.id ?? null;
      if (!this.childId) {
        return;
      }
      this.books
        .books(this.childId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (rows) => {
            const row = rows.find((r) => r.subject === subject) ?? null;
            this.row.set(row);
            this.checkMode(row);
          },
          error: (error: unknown) => this.fail(error),
        });
    };
    if (this.family.me()) {
      start();
    } else {
      this.family
        .loadMe()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => start());
    }
    this.destroyRef.onDestroy(() => this.revokePreviews());
  }

  protected megabytes(bytes: number): string {
    return (bytes / 1_048_576).toFixed(1);
  }

  protected reason(code: string | null): string {
    return (code && this.text.reasons[code]) || this.text.reasons['unreadable'];
  }

  protected numberError(): string | null {
    const control = this.chapter.controls.number;
    return (control.touched || this.submitted()) && control.invalid
      ? fieldMessage('INVALID')
      : null;
  }

  protected titleError(): string | null {
    const control = this.chapter.controls.title;
    if (!(control.touched || this.submitted()) || control.valid) {
      return null;
    }
    return control.errors?.['maxlength']
      ? fieldMessage('INVALID_LENGTH')
      : fieldMessage('REQUIRED');
  }

  /** Limits checked on the device first (the API checks them again): 413 UPLOAD_LIMIT otherwise. */
  protected pick(files: File[]): void {
    this.failure.set(null);
    const limits = this.config()?.upload_limits;
    const pdfs = files.filter((f) => f.type === 'application/pdf');
    const photos = files.filter((f) => PHOTO_TYPES.has(f.type));
    if (
      pdfs.length + photos.length !== files.length ||
      (pdfs.length && photos.length) ||
      !files.length
    ) {
      this.failure.set(
        pdfs.length && photos.length ? this.text.mixed : errorMessage('UPLOAD_LIMIT', 'parent'),
      );
      return;
    }
    const tooBig =
      limits &&
      (pdfs.length > 1 ||
        photos.length > limits.photos_per_upload ||
        pdfs.some((f) => f.size > limits.pdf_max_bytes) ||
        photos.some((f) => f.size > limits.photo_max_bytes));
    if (tooBig || pdfs.length > 1) {
      this.failure.set(errorMessage('UPLOAD_LIMIT', 'parent'));
      return;
    }
    this.revokePreviews();
    this.picked.set({
      files,
      source: pdfs.length ? 'pdf' : 'photos',
      previews: photos.slice(0, THUMBS_SHOWN).map((file) => URL.createObjectURL(file)),
    });
  }

  protected reset(): void {
    this.revokePreviews();
    this.picked.set(null);
    this.result.set(null);
    this.failure.set(null);
    this.progress.set(null);
  }

  protected send(chosen: Picked): void {
    this.submitted.set(true);
    if (this.chapterMode() && this.chapter.invalid) {
      this.chapter.markAllAsTouched();
      return;
    }
    const row = this.row();
    if (!row || !this.childId) {
      return;
    }
    const chapterwise = this.chapterMode();
    const request: UploadRequest = chapterwise
      ? {
          source: chosen.source,
          chapter: {
            number: Number(this.chapter.controls.number.value),
            title: this.chapter.controls.title.value.trim(),
          },
        }
      : { source: chosen.source };
    const book$: Observable<FamilyBook> = row.book
      ? of(row.book)
      : this.books.createBook(this.childId, row.subject_id, chapterwise ? 'chapterwise' : 'whole');
    this.busy.set(true);
    this.failure.set(null);
    book$
      .pipe(
        switchMap((book) => {
          this.row.set({ ...row, book });
          return this.books.upload(book.id, request, chosen.files);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (step) => {
          if (step.kind === 'sending') {
            this.progress.set(this.text.sending(step.sent, step.total));
          } else {
            this.busy.set(false);
            this.progress.set(null);
            this.result.set(step.upload);
          }
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected leave(): void {
    const next = this.route.snapshot.queryParamMap.get('next');
    void this.router.navigateByUrl(
      next && next.startsWith('/') && !next.startsWith('//')
        ? next
        : `/parent/books?child=${this.childId ?? ''}`,
    );
  }

  /** P5 is for whole books and P7 for chapter-by-chapter books. */
  private checkMode(row: SubjectBookRow | null): void {
    const book = row?.book;
    if (!book) {
      return;
    }
    if (this.chapterMode() && book.upload_mode === 'whole') {
      this.blocked.set(this.text.chapterwiseIsWhole);
    } else if (!this.chapterMode() && book.upload_mode === 'chapterwise') {
      this.blocked.set(this.text.wholeIsChapterwise);
    } else if (
      !this.chapterMode() &&
      book.latest_upload &&
      !['rejected', 'failed'].includes(book.latest_upload.status)
    ) {
      this.blocked.set(this.text.alreadyUploaded);
    } else if (this.chapterMode()) {
      const next = Math.max(0, ...book.chapters.map((c) => c.number)) + 1;
      this.chapter.controls.number.setValue(String(next));
    }
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.progress.set(null);
    const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    if (code === 'CONFLICT' && this.chapterMode()) {
      this.failure.set(this.text.chapterExists);
    } else if (code === 'BOOK_EXISTS') {
      this.failure.set(this.text.alreadyUploaded);
    } else {
      this.failure.set(errorMessage(code, 'parent'));
    }
  }

  private revokePreviews(): void {
    for (const src of this.picked()?.previews ?? []) {
      URL.revokeObjectURL(src);
    }
  }
}
