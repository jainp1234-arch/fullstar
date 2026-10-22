import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AttemptEvent,
  FamilySession,
  KidEvents,
  WorksheetApi,
  WorksheetDetail,
  starsFor,
} from '@fullstar/core';
import { Button, EN, QuestionContent, Skeleton, contentValue } from '@fullstar/ui';
import { QuizRunner, RunnerAnswer, RunnerQuestion } from './quiz-runner';

/**
 * K6 Worksheet on screen (App Flow §5; Schema §11; Plan 7.2): the worksheet a parent made, one
 * question at a time with big answer buttons. Starting it counts as its first print (no more
 * shuffles). Answers and the worksheet attempt are synced like practice; it ends on K7.
 */
@Component({
  selector: 'app-worksheet-onscreen-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, QuizRunner, Skeleton],
  template: `
    <h1 class="title" tabindex="-1">{{ title() }}</h1>
    @if (questions(); as list) {
      <app-quiz-runner
        [questions]="list"
        [lang]="lang()"
        (answered)="answered($event)"
        (finished)="finish($event.correct, $event.total)"
      />
    } @else if (failed()) {
      <div class="failed" role="alert">
        <p>{{ kid.somethingFailed }}</p>
        <app-button [label]="kid.tryAgain" (pressed)="load()" />
      </div>
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
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
    .failed {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
      font: var(--type-body);
    }
  `,
})
export class WorksheetOnscreenPage {
  protected readonly kid = EN.kid;
  protected readonly title = signal<string>(EN.screens.K6);
  protected readonly questions = signal<readonly RunnerQuestion[] | null>(null);
  protected readonly failed = signal(false);
  protected readonly lang = signal<string | null>(null);

  private readonly api = inject(WorksheetApi);
  private readonly events = inject(KidEvents);
  private readonly session = inject(FamilySession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private attempt: AttemptEvent | null = null;
  private readonly startedMs = Date.now();

  constructor() {
    this.load();
  }

  protected load(): void {
    this.failed.set(false);
    this.api
      .onScreen(this.route.snapshot.paramMap.get('worksheetId') ?? '')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => this.start(detail),
        error: () => this.failed.set(true),
      });
  }

  protected answered(event: RunnerAnswer): void {
    const childId = this.session.activeChildId();
    if (!this.attempt || !childId || !event.question.versionId) {
      return;
    }
    void this.events.answer(childId, {
      id: crypto.randomUUID(),
      attempt_id: this.attempt.id,
      question_item_id: event.question.id,
      question_version_id: event.question.versionId,
      is_correct: event.correct,
      answer: event.answer,
      answered_at: new Date().toISOString(),
    });
  }

  protected async finish(correct: number, total: number): Promise<void> {
    const childId = this.session.activeChildId();
    if (this.attempt && childId) {
      this.attempt = {
        ...this.attempt,
        completed_at: new Date().toISOString(),
        correct_count: correct,
        total_count: total,
        duration_seconds: Math.round((Date.now() - this.startedMs) / 1000),
      };
      await this.events.attempt(childId, this.attempt);
    }
    const back = this.route.snapshot.queryParamMap.get('back');
    void this.router.navigate(['/kid/well-done'], {
      queryParams: {
        stars: starsFor(correct, total),
        ...(back && back.startsWith('/kid/') ? { back } : {}),
      },
      replaceUrl: true,
    });
  }

  private start(detail: WorksheetDetail): void {
    const w = detail.worksheet;
    this.title.set(
      w.chapter_number !== null
        ? EN.kid.learn.chapterLine(w.chapter_number, w.source_title)
        : w.source_title,
    );
    this.lang.set(w.subject === 'hindi' ? 'hi' : null);
    this.questions.set(
      detail.questions.map((q) => ({
        id: q.id,
        versionId: q.version_id,
        content: contentValue('question', q.question_type, q.body, q.solution) as QuestionContent,
      })),
    );
    const childId = this.session.activeChildId();
    if (!childId) {
      return;
    }
    this.attempt = {
      id: crypto.randomUUID(),
      kind: 'worksheet',
      subject_id: w.subject_id,
      content_item_id: null,
      content_version_id: null,
      family_chapter_id: w.family_chapter_id,
      topic_id: w.topic_id,
      started_at: new Date().toISOString(),
      completed_at: null,
      correct_count: null,
      total_count: null,
      duration_seconds: 0,
      resume_state: null,
    };
    void this.events.attempt(childId, this.attempt);
  }
}
