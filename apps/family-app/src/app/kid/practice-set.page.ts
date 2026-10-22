import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AttemptEvent,
  FamilySession,
  KidApi,
  KidEvents,
  PracticeSet,
  starsFor,
} from '@fullstar/core';
import {
  Button,
  CurrentScreen,
  EN,
  EmptyState,
  QuestionContent,
  Skeleton,
  contentValue,
} from '@fullstar/ui';
import { Observable } from 'rxjs';
import { QuizRunner, RunnerAnswer, RunnerQuestion } from './quiz-runner';

/** Seed subject ids (Schema §6 V11): the route names the subject by code. */
const SUBJECT_IDS: Readonly<Record<string, number>> = { english: 1, hindi: 2, maths: 3, evs: 4 };

/**
 * K9 Practice set and K11 Fix my mistakes (App Flow §5; Schema §11; Plan 7.1): up to 10 questions,
 * one per screen with instant right / try-again feedback. Each first answer is an answer event
 * (synced like lessons), so wrong ones become mistakes and two right in a row clear them (server
 * trigger). The set is a practice attempt; finishing shows K7 with its stars.
 */
@Component({
  selector: 'app-practice-set-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, QuizRunner, Skeleton],
  template: `
    <h1 class="title" tabindex="-1">{{ title() }}</h1>
    @if (questions(); as list) {
      @if (list.length) {
        <app-quiz-runner
          [questions]="list"
          [lang]="lang()"
          (answered)="answered($event)"
          (finished)="finish($event.correct, $event.total)"
        />
      } @else {
        <app-empty-state
          [illustration]="mistakes() ? 'empty-done' : 'empty-books'"
          [title]="mistakes() ? text.noMistakes : text.nothingYet"
        />
      }
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
export class PracticeSetPage {
  protected readonly text = EN.kid.practice;
  protected readonly kid = EN.kid;
  protected readonly questions = signal<readonly RunnerQuestion[] | null>(null);
  protected readonly failed = signal(false);
  protected readonly mistakes = signal(false);
  protected readonly title = signal('');
  protected readonly lang = signal<string | null>(null);

  private readonly api = inject(KidApi);
  private readonly events = inject(KidEvents);
  private readonly session = inject(FamilySession);
  private readonly screen = inject(CurrentScreen);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private attempt: AttemptEvent | null = null;
  private readonly startedMs = Date.now();

  constructor() {
    this.load();
  }

  protected load(): void {
    const mistakes = this.screen.screen()?.id === 'K11';
    const code = this.route.snapshot.paramMap.get('topic') ?? '';
    const subjectId = SUBJECT_IDS[code];
    this.mistakes.set(mistakes);
    this.title.set(mistakes ? EN.screens.K11 : this.titleOf(code));
    this.lang.set(code === 'hindi' ? 'hi' : null);
    this.failed.set(false);
    const set$: Observable<PracticeSet> | null = mistakes
      ? this.api.mistakes()
      : subjectId
        ? this.api.practiceSet(
            subjectId,
            this.route.snapshot.queryParamMap.get('topic') ?? undefined,
          )
        : null;
    if (!set$) {
      this.questions.set([]);
      return;
    }
    set$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (set) => this.start(set, subjectId ?? 0),
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
    void this.router.navigate(['/kid/well-done'], {
      queryParams: { stars: starsFor(correct, total), back: '/kid/practice' },
      replaceUrl: true,
    });
  }

  private start(set: PracticeSet, subjectId: number): void {
    const childId = this.session.activeChildId();
    const questions = set.questions.map((q) => ({
      id: q.id,
      versionId: q.version_id,
      content: contentValue('question', q.question_type, q.body, q.solution) as QuestionContent,
    }));
    this.questions.set(questions);
    if (!childId || !questions.length) {
      return;
    }
    // A mistakes set mixes subjects; the API names the first question's
    const subject = subjectId || set.subject_id;
    this.attempt = {
      id: crypto.randomUUID(),
      kind: 'practice',
      subject_id: subject,
      content_item_id: null,
      content_version_id: null,
      family_chapter_id: null,
      topic_id: set.topic_id,
      started_at: new Date().toISOString(),
      completed_at: null,
      correct_count: null,
      total_count: null,
      duration_seconds: 0,
      resume_state: null,
    };
    void this.events.attempt(childId, this.attempt);
  }

  private titleOf(code: string): string {
    const t = this.text;
    return code === 'english'
      ? t.englishGrammar
      : code === 'hindi'
        ? t.hindiGrammar
        : code === 'evs'
          ? t.evsQuiz
          : EN.screens.K9;
  }
}
