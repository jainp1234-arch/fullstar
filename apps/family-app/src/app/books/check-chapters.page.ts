import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiError, BookApi, FamilyApi, FamilyBook, SplitChapter } from '@fullstar/core';
import { Button, EN, Skeleton, TextField, errorMessage, fieldMessage } from '@fullstar/ui';
import { map, startWith } from 'rxjs';

const TITLE_MAX = 200;
const MAX_CHAPTERS = 99;
/** Chapters that can still be moved: read-along is not being prepared yet (Schema §11). */
const OPEN_STATUSES = new Set(['suggested', 'processing', 'needs_attention']);

type ChapterForm = FormGroup<{
  title: FormControl<string>;
  start: FormControl<string>;
}>;

/** Start pages go up, the first is page 1 and the last is within the book. */
function startsInOrder(total: () => number) {
  return (control: AbstractControl): ValidationErrors | null => {
    const starts = (control as FormArray<ChapterForm>).controls.map((group) =>
      Number(group.controls.start.value),
    );
    const ok = starts.every(
      (start, i) =>
        Number.isInteger(start) &&
        (i === 0 ? start === 1 : start > starts[i - 1]) &&
        start <= total(),
    );
    return ok ? null : { order: true };
  };
}

/**
 * P6 Check chapters (App Flow §6, Schema §11; Plan 5.3): the split book-reader suggested for a whole
 * book. The parent renames a chapter, joins it with the one above, adds a chapter start or moves
 * one, then saves the full ordered list; chapters are numbered in order. ?child= chooses the child.
 */
@Component({
  selector: 'app-check-chapters-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ReactiveFormsModule, Skeleton, TextField],
  template: `
    @if (saved()) {
      <p class="done" role="status">{{ text.saved }}</p>
      <app-button [label]="books.backToBooks" (pressed)="leave()" />
    } @else if (blocked(); as message) {
      <p class="note" role="status">{{ message }}</p>
      <app-button variant="secondary" [label]="books.backToBooks" (pressed)="leave()" />
    } @else if (book()) {
      <p class="intro">{{ text.intro }}</p>
      <p class="note">{{ text.totalPages(total()) }}</p>
      <form class="list" [formGroup]="form" novalidate (submit)="$event.preventDefault()">
        <ol class="chapters" formArrayName="chapters">
          @for (group of chapters.controls; track group; let i = $index) {
            <li class="chapter" [formGroupName]="i">
              <p class="chapter__line">
                {{ books.chapterLine(i + 1, group.controls.title.value || '…') }} ·
                {{ text.pagesOf(startOf(i), endOf(i)) }}
              </p>
              <app-text-field
                formControlName="title"
                [label]="books.chapterTitle"
                [maxLength]="titleMax"
                [error]="titleError(group)"
              />
              @if (i > 0) {
                <app-text-field
                  formControlName="start"
                  inputMode="numeric"
                  [label]="text.startPage"
                />
              }
              <div class="actions">
                @if (i > 0) {
                  <app-button
                    variant="ghost"
                    [label]="text.mergeUp"
                    [disabled]="busy()"
                    (pressed)="mergeUp(i)"
                  />
                }
                @if (canAddAfter(i)) {
                  <app-button
                    variant="ghost"
                    icon="add"
                    [label]="text.addStart"
                    [disabled]="busy()"
                    (pressed)="addAfter(i)"
                  />
                }
              </div>
            </li>
          }
        </ol>
      </form>
      @if (orderError()) {
        <p class="warning" role="alert">{{ text.startOrder }}</p>
      }
      @if (failure(); as message) {
        <p class="warning" role="alert">{{ message }}</p>
      }
      <app-button [label]="text.save" [loading]="busy()" [disabled]="busy()" (pressed)="save()" />
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
    .chapters {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .chapter {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .chapter__line {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
})
export class CheckChaptersPage {
  protected readonly text = EN.splitCheck;
  protected readonly books = EN.books;
  protected readonly titleMax = TITLE_MAX;

  protected readonly book = signal<FamilyBook | null>(null);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly blocked = signal<string | null>(null);
  protected readonly total = computed(
    () => this.book()?.chapters.reduce((sum, c) => sum + c.page_count, 0) ?? 0,
  );

  protected readonly chapters = new FormArray<ChapterForm>([], {
    validators: startsInOrder(() => this.total()),
  });
  protected readonly form = new FormGroup({ chapters: this.chapters });

  private readonly submitted = signal(false);
  private readonly family = inject(FamilyApi);
  private readonly api = inject(BookApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  /** Re-reads the form on every change, so page ranges and errors follow the fields. */
  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(
      startWith(null),
      map(() => this.chapters.getRawValue()),
    ),
    { initialValue: [] },
  );
  protected readonly orderError = computed(() => {
    this.formValue();
    return this.submitted() && this.chapters.hasError('order');
  });
  private childId: string | null = null;

  constructor() {
    const subject = this.route.snapshot.paramMap.get('subject');
    const wanted = this.route.snapshot.queryParamMap.get('child');
    const start = (): void => {
      const children = this.family.me()?.children ?? [];
      this.childId = children.find((c) => c.id === wanted)?.id ?? children[0]?.id ?? null;
      if (!this.childId) {
        return;
      }
      this.api
        .books(this.childId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (rows) => this.show(rows.find((r) => r.subject === subject)?.book ?? null),
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
  }

  protected startOf(i: number): number {
    return Number(this.formValue()[i]?.start ?? 0);
  }

  protected endOf(i: number): number {
    const next = this.formValue()[i + 1];
    return next ? Number(next.start) - 1 : this.total();
  }

  protected canAddAfter(i: number): boolean {
    return this.chapters.length < MAX_CHAPTERS && this.endOf(i) > this.startOf(i);
  }

  protected titleError(group: ChapterForm): string | null {
    const control = group.controls.title;
    if (!(control.touched || this.submitted()) || control.valid) {
      return null;
    }
    return control.errors?.['maxlength']
      ? fieldMessage('INVALID_LENGTH')
      : fieldMessage('REQUIRED');
  }

  /** The chapter's pages go to the chapter above. */
  protected mergeUp(i: number): void {
    this.chapters.removeAt(i);
  }

  /** A new chapter starting halfway through this one's pages. */
  protected addAfter(i: number): void {
    const from = this.startOf(i);
    const start = from + Math.max(1, Math.floor((this.endOf(i) - from + 1) / 2));
    this.chapters.insert(i + 1, this.group(this.text.newTitle(i + 2), start));
  }

  protected save(): void {
    this.submitted.set(true);
    this.failure.set(null);
    const book = this.book();
    if (!book || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const split: SplitChapter[] = this.chapters.getRawValue().map((chapter, i) => ({
      number: i + 1,
      title: chapter.title.trim(),
      start_page: Number(chapter.start),
    }));
    this.busy.set(true);
    this.api
      .confirmSplit(book.id, split)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.saved.set(true);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected leave(): void {
    void this.router.navigateByUrl(`/parent/books?child=${this.childId ?? ''}`);
  }

  private show(book: FamilyBook | null): void {
    if (!book || book.upload_mode !== 'whole' || !book.chapters.length) {
      this.blocked.set(this.text.nothingToCheck);
      return;
    }
    if (book.chapters.some((c) => !OPEN_STATUSES.has(c.status))) {
      this.blocked.set(this.text.alreadyFixed);
      return;
    }
    let start = 1;
    for (const chapter of book.chapters) {
      this.chapters.push(this.group(chapter.title, start));
      start += chapter.page_count;
    }
    this.book.set(book);
  }

  private group(title: string, start: number): ChapterForm {
    return new FormGroup({
      title: new FormControl(title, {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(TITLE_MAX)],
      }),
      start: new FormControl(String(start), {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^\d{1,3}$/)],
      }),
    });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    if (code === 'CONFLICT') {
      this.blocked.set(this.text.alreadyFixed);
    } else {
      this.failure.set(errorMessage(code, 'parent'));
    }
  }
}
