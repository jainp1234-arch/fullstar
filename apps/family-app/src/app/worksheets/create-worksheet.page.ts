import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  ApiError,
  BookApi,
  FamilyApi,
  KidApi,
  PracticeHome,
  SubjectBookRow,
  WorksheetApi,
  WorksheetDetail,
} from '@fullstar/core';
import { Button, EN, SelectField, SelectOption, Skeleton, errorMessage } from '@fullstar/ui';
import { startWith } from 'rxjs';

const COUNTS = [5, 10, 15, 20, 25, 30];

/**
 * P11 Create worksheet (App Flow §6; Schema §11; Plan 7.2): child, subject, then a chapter of the
 * book (one with lessons, so it has a question bank) or a practice topic, and how many questions.
 * The API picks and shuffles them; the preview shows the questions with Shuffle again (only before
 * printing), then Print / share (P12).
 */
@Component({
  selector: 'app-create-worksheet-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ReactiveFormsModule, SelectField, Skeleton],
  template: `
    @if (made(); as m) {
      <h2 class="heading">{{ text.preview }}</h2>
      <ol class="questions">
        @for (q of m.questions; track q.position) {
          <li [attr.lang]="m.worksheet.subject === 'hindi' ? 'hi' : null">
            {{ promptOf(q.body) }}
          </li>
        }
      </ol>
      <div class="actions">
        <app-button icon="download" [label]="text.print" (pressed)="print(m)" />
        @if (!m.worksheet.printed_at) {
          <app-button
            variant="secondary"
            [label]="text.shuffle"
            [loading]="busy()"
            (pressed)="shuffle(m)"
          />
        }
      </div>
    } @else if (children().length) {
      <form class="form" [formGroup]="form" novalidate (submit)="create($event)">
        <app-select-field
          formControlName="childId"
          [label]="text.child"
          [options]="childOptions()"
        />
        <app-select-field
          formControlName="subjectId"
          [label]="text.subject"
          [options]="subjectOptions()"
        />
        <app-select-field formControlName="source" [label]="text.from" [options]="sourceOptions" />
        @if (current().source === 'chapter') {
          @if (chapterOptions().length) {
            <app-select-field
              formControlName="sourceId"
              [label]="text.chapterLabel"
              [options]="chapterOptions()"
            />
          } @else {
            <p class="note">{{ text.noChapters }}</p>
          }
        } @else {
          <app-select-field
            formControlName="sourceId"
            [label]="text.topicLabel"
            [options]="topicOptions()"
          />
        }
        <app-select-field formControlName="count" [label]="text.count" [options]="countOptions" />
        @if (failure(); as message) {
          <p class="warning" role="alert">{{ message }}</p>
        }
        <app-button
          type="submit"
          [label]="text.create"
          [loading]="busy()"
          [disabled]="!current().sourceId"
        />
      </form>
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
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .heading {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .questions {
      margin: 0;
      padding-left: var(--space-5);
      font: var(--type-body);
      color: var(--color-text);
    }
    .questions li {
      margin-bottom: var(--space-2);
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
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
  `,
})
export class CreateWorksheetPage {
  protected readonly text = EN.worksheets;
  protected readonly sourceOptions: readonly SelectOption[] = [
    { value: 'chapter', label: EN.worksheets.fromChapter },
    { value: 'topic', label: EN.worksheets.fromTopic },
  ];
  protected readonly countOptions: readonly SelectOption[] = COUNTS.map((n) => ({
    value: String(n),
    label: String(n),
  }));

  protected readonly form = new FormGroup({
    childId: new FormControl('', { nonNullable: true }),
    subjectId: new FormControl('', { nonNullable: true }),
    source: new FormControl<'chapter' | 'topic'>('topic', { nonNullable: true }),
    sourceId: new FormControl('', { nonNullable: true }),
    count: new FormControl('10', { nonNullable: true }),
  });
  protected readonly value = toSignal(this.form.valueChanges.pipe(startWith(null)), {
    initialValue: null,
  });

  /** The whole form, read again on every change. */
  protected readonly current = computed(() => {
    this.value();
    return this.form.getRawValue();
  });
  protected readonly made = signal<WorksheetDetail | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  private readonly books = signal<readonly SubjectBookRow[]>([]);
  private readonly practice = signal<PracticeHome | null>(null);

  private readonly family = inject(FamilyApi);
  private readonly bookApi = inject(BookApi);
  private readonly kidApi = inject(KidApi);
  private readonly api = inject(WorksheetApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly children = computed(() => this.family.me()?.children ?? []);
  protected readonly childOptions = computed<readonly SelectOption[]>(() =>
    this.children().map((c) => ({ value: c.id, label: c.first_name })),
  );
  protected readonly subjectOptions = computed<readonly SelectOption[]>(() =>
    this.books().map((row) => ({ value: String(row.subject_id), label: row.subject_name })),
  );
  protected readonly chapterOptions = computed<readonly SelectOption[]>(() => {
    const subjectId = Number(this.formValue().subjectId);
    const book = this.books().find((row) => row.subject_id === subjectId)?.book;
    return (book?.chapters ?? [])
      .filter((c) => c.status === 'lessons_ready')
      .map((c) => ({ value: c.id, label: this.text.chapter(c.number, c.title) }));
  });
  protected readonly topicOptions = computed<readonly SelectOption[]>(() => {
    const subjectId = Number(this.formValue().subjectId);
    const subject = this.practice()?.subjects.find((s) => s.subject_id === subjectId);
    return (subject?.topics ?? [])
      .filter((t) => t.questions >= 5)
      .map((t) => ({ value: t.id, label: t.name }));
  });

  constructor() {
    this.form.controls.childId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((childId) => this.loadChild(childId));
    // A new subject or source starts with its first chapter or topic
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.pickFirst());
    const start = () => {
      const first = this.children()[0];
      if (first) {
        this.form.controls.childId.setValue(first.id);
      }
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

  private formValue() {
    this.value();
    return this.form.getRawValue();
  }

  protected promptOf(body: unknown): string {
    return String((body as { prompt?: unknown }).prompt ?? '');
  }

  protected create(event: Event): void {
    event.preventDefault();
    const v = this.form.getRawValue();
    if (!v.sourceId) {
      return;
    }
    this.busy.set(true);
    this.failure.set(null);
    this.api
      .create({
        child_id: v.childId,
        subject_id: Number(v.subjectId),
        source: v.source,
        ...(v.source === 'chapter' ? { family_chapter_id: v.sourceId } : { topic_id: v.sourceId }),
        question_count: Number(v.count),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (made) => {
          this.busy.set(false);
          this.made.set(made);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected shuffle(m: WorksheetDetail): void {
    this.busy.set(true);
    this.api
      .reshuffle(m.worksheet.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (made) => {
          this.busy.set(false);
          this.made.set(made);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected print(m: WorksheetDetail): void {
    void this.router.navigate(['/parent/worksheets', m.worksheet.id, 'print']);
  }

  private loadChild(childId: string): void {
    if (!childId) {
      return;
    }
    this.bookApi
      .books(childId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => {
        this.books.set(rows);
        if (!rows.some((r) => String(r.subject_id) === this.form.controls.subjectId.value)) {
          this.form.controls.subjectId.setValue(String(rows[0]?.subject_id ?? ''));
        }
      });
    this.kidApi
      .practice(childId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((home) => {
        this.practice.set(home);
        this.pickFirst();
      });
  }

  private pickFirst(): void {
    const options =
      this.form.controls.source.value === 'chapter' ? this.chapterOptions() : this.topicOptions();
    const current = this.form.controls.sourceId.value;
    if (!options.some((o) => o.value === current)) {
      this.form.controls.sourceId.setValue(options[0]?.value ?? '', { emitEvent: false });
      this.form.updateValueAndValidity();
    }
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    if (error instanceof ApiError && error.fields['question_count']) {
      this.failure.set(this.text.notEnough);
      return;
    }
    this.failure.set(
      errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
    );
  }
}
