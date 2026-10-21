import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApiError,
  LessonCard,
  LessonPreview,
  MessageApi,
  PreviewResult,
  ReportReason,
} from '@fullstar/core';
import {
  Button,
  ContentPreview,
  ContentValue,
  EN,
  SelectField,
  SelectOption,
  Skeleton,
  TextField,
  ToastService,
  contentValue,
  errorMessage,
} from '@fullstar/ui';

const NOTE_MAX = 500;
const REASONS: readonly ReportReason[] = [
  'wrong_answer',
  'spelling',
  'not_suitable',
  'audio_problem',
  'other',
];

interface Shown {
  readonly preview: LessonPreview;
  readonly lesson: ContentValue;
  readonly questions: readonly { readonly id: string; readonly value: ContentValue }[];
}

/**
 * P8a Preview new lessons (App Flow §6; Schema §11; Plan 5.5): the published lessons of an uploaded
 * chapter (?chapter=), each marked "New · preview recommended" until answered. A lesson shows with
 * its question bank in the kid-mode preview; Looks good, or Report a problem with a reason and an
 * optional note (it reaches our team's report queue). Previewing is advised, not required.
 */
@Component({
  selector: 'app-lesson-preview-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ContentPreview, ReactiveFormsModule, SelectField, Skeleton, TextField],
  template: `
    @if (shown(); as s) {
      <h2 class="title">{{ s.preview.lesson.title }}</h2>
      <app-content-preview
        [value]="s.lesson"
        [lang]="s.preview.lesson.lang === 'hi' ? 'hi' : null"
      />
      <p class="note">{{ text.questions(s.questions.length) }}</p>
      @for (question of s.questions; track question.id) {
        <app-content-preview
          [value]="question.value"
          [lang]="s.preview.lesson.lang === 'hi' ? 'hi' : null"
        />
      }
      @if (reporting()) {
        <form class="form" [formGroup]="report" novalidate (submit)="sendReport($event, s)">
          <p class="note">{{ text.reportTitle }}</p>
          <app-select-field
            formControlName="reason"
            [label]="text.reason"
            [options]="reasonOptions"
          />
          <app-text-field
            formControlName="note"
            [label]="text.note"
            [rows]="3"
            [maxLength]="noteMax"
          />
          <div class="actions">
            <app-button type="submit" [label]="text.send" [loading]="busy()" />
            <app-button variant="ghost" [label]="text.cancel" (pressed)="reporting.set(false)" />
          </div>
        </form>
      } @else {
        <div class="actions">
          <app-button
            [label]="text.looksGood"
            icon="check"
            [loading]="busy()"
            [disabled]="busy()"
            (pressed)="answer(s, 'looks_good')"
          />
          <app-button
            variant="secondary"
            icon="flag"
            [label]="text.report"
            [disabled]="busy()"
            (pressed)="reporting.set(true)"
          />
        </div>
      }
      <app-button variant="ghost" [label]="text.back" (pressed)="back()" />
    } @else if (lessons(); as list) {
      <p class="intro">{{ text.intro }}</p>
      @if (list.length) {
        <ul class="lessons" role="list">
          @for (lesson of list; track lesson.content_item_id) {
            <li class="lesson">
              <div class="lesson__text">
                <span class="lesson__title">{{ lesson.title }}</span>
                <span class="lesson__state">{{ stateOf(lesson) }}</span>
              </div>
              <app-button
                variant="secondary"
                [label]="text.open"
                [ariaLabel]="text.open + ' ' + lesson.title"
                (pressed)="open(lesson.content_item_id)"
              />
            </li>
          }
        </ul>
      } @else {
        <p class="note">{{ text.none }}</p>
      }
      <app-button variant="ghost" [label]="books.backToBooks" (pressed)="leave()" />
    } @else if (failure(); as message) {
      <p class="warning" role="alert">{{ message }}</p>
      <app-button variant="ghost" [label]="books.backToBooks" (pressed)="leave()" />
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
    .title {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
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
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .lessons {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .lesson {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .lesson__text {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .lesson__title {
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .lesson__state {
      font: var(--type-small);
      color: var(--color-text-2);
    }
  `,
})
export class LessonPreviewPage {
  protected readonly text = EN.lessonPreview;
  protected readonly books = EN.books;
  protected readonly noteMax = NOTE_MAX;
  protected readonly reasonOptions: readonly SelectOption[] = REASONS.map((value) => ({
    value,
    label: EN.lessonPreview.reasons[value],
  }));

  protected readonly lessons = signal<readonly LessonCard[] | null>(null);
  protected readonly shown = signal<Shown | null>(null);
  protected readonly reporting = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected readonly report = new FormGroup({
    reason: new FormControl<ReportReason>('wrong_answer', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(NOTE_MAX)] }),
  });

  private readonly api = inject(MessageApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly chapterId = this.route.snapshot.queryParamMap.get('chapter');

  constructor() {
    this.loadLessons();
  }

  protected stateOf(lesson: LessonCard): string {
    if (lesson.preview_result === 'looks_good') {
      return this.text.looksGood;
    }
    return lesson.preview_result === 'reported' ? this.text.reported : this.text.recommended;
  }

  protected open(contentItemId: string): void {
    this.failure.set(null);
    this.api
      .preview(contentItemId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) =>
          this.shown.set({
            preview,
            lesson: contentValue('lesson', null, preview.lesson.body, null),
            questions: preview.questions.map((q) => ({
              id: q.id,
              value: contentValue('question', q.question_type, q.body, q.solution),
            })),
          }),
        error: (error: unknown) => this.fail(error),
      });
  }

  protected answer(
    shown: Shown,
    result: PreviewResult,
    reason?: ReportReason,
    note?: string,
  ): void {
    this.busy.set(true);
    this.api
      .previewResult(shown.preview.lesson.id, result, reason, note)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.reporting.set(false);
          this.toasts.show(result === 'reported' ? this.text.thanks : this.text.thanksGood);
          this.back();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected sendReport(event: Event, shown: Shown): void {
    event.preventDefault();
    if (this.report.invalid) {
      this.report.markAllAsTouched();
      return;
    }
    const form = this.report.getRawValue();
    this.answer(shown, 'reported', form.reason, form.note.trim() || undefined);
  }

  protected back(): void {
    this.shown.set(null);
    this.report.reset();
    this.loadLessons();
  }

  protected leave(): void {
    const child = this.route.snapshot.queryParamMap.get('child') ?? '';
    void this.router.navigateByUrl(`/parent/books?child=${child}`);
  }

  private loadLessons(): void {
    if (!this.chapterId) {
      this.failure.set(errorMessage('NOT_FOUND', 'parent'));
      return;
    }
    this.api
      .chapterLessons(this.chapterId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.lessons.set(list),
        error: (error: unknown) => this.fail(error),
      });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.failure.set(
      errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
    );
  }
}
