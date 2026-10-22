import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ApiError, FamilyApi, ProgressApi, SubjectDetail } from '@fullstar/core';
import { EN, SectionHeader, Skeleton, errorMessage } from '@fullstar/ui';
import { of, switchMap, throwError } from 'rxjs';

const SUBJECT_IDS: Readonly<Record<string, number>> = { english: 1, hindi: 2, maths: 3, evs: 4 };

/**
 * P2 Subject detail (App Flow §6; Schema §11; Plan 6.4): the book's chapters with done, practice
 * accuracy by topic (first answers only), and weak spots the parent ticked on worksheets (Phase 7).
 */
@Component({
  selector: 'app-subject-progress-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeader, Skeleton],
  template: `
    @if (detail(); as d) {
      <h2 class="title">{{ d.name }}</h2>
      <app-section-header [title]="text.chapters" />
      @if (d.chapters.length) {
        <ul class="rows">
          @for (chapter of d.chapters; track chapter.id) {
            <li class="row">
              <span>{{ text.chapterLine(chapter.number, chapter.title) }}</span>
              <span class="row__state">{{ chapter.done ? text.done : text.notYet }}</span>
            </li>
          }
        </ul>
      } @else {
        <p class="note">{{ text.noChapters }}</p>
      }
      <app-section-header [title]="text.accuracy" />
      @if (d.accuracy.length) {
        <ul class="rows">
          @for (topic of d.accuracy; track topic.topic_id) {
            <li class="row">
              <span>{{ topic.name }}</span>
              <span class="row__state">{{ text.accuracyLine(topic.correct, topic.answered) }}</span>
            </li>
          }
        </ul>
      } @else {
        <p class="note">{{ text.noAnswers }}</p>
      }
      <app-section-header [title]="text.weakSpots" />
      @if (d.weak_spots.length) {
        <ul class="rows">
          @for (spot of d.weak_spots; track spot.topic_id) {
            <li class="row">
              <span>{{ spot.name }}</span>
              <span class="row__state">{{ text.weakLine(spot.ticks) }}</span>
            </li>
          }
        </ul>
      } @else {
        <p class="note">{{ text.noWeakSpots }}</p>
      }
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
    .title {
      margin: 0;
      font: var(--type-h2);
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
    .rows {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      font: var(--type-body);
      color: var(--color-text);
    }
    .row__state {
      color: var(--color-text-2);
    }
  `,
})
export class SubjectProgressPage {
  protected readonly text = EN.progress;
  protected readonly detail = signal<SubjectDetail | null>(null);
  protected readonly failure = signal<string | null>(null);

  private readonly family = inject(FamilyApi);
  private readonly progress = inject(ProgressApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const subjectId = SUBJECT_IDS[this.route.snapshot.paramMap.get('subject') ?? ''];
    const wanted = this.route.snapshot.queryParamMap.get('child');
    // The child comes from ?child= once the family is known
    (this.family.me() ? of(null) : this.family.loadMe())
      .pipe(
        switchMap(() => this.progressFor(wanted, subjectId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (detail) => this.detail.set(detail),
        error: (error: unknown) =>
          this.failure.set(
            `${this.text.loadFailed} ${errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent')}`,
          ),
      });
  }

  private progressFor(wanted: string | null, subjectId: number | undefined) {
    const children = this.family.me()?.children ?? [];
    const childId = children.find((c) => c.id === wanted)?.id ?? children[0]?.id;
    if (!childId || !subjectId) {
      return throwError(() => new ApiError(404, 'NOT_FOUND', 'Not found'));
    }
    return this.progress.subject(childId, subjectId);
  }
}
