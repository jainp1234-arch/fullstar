import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AttemptEvent, FamilySession, KidEvents, starsFor } from '@fullstar/core';
import { Button, EN, QuestionContent } from '@fullstar/ui';
import { QuizRunner, RunnerAnswer, RunnerQuestion } from './quiz-runner';

const TABLES = Array.from({ length: 19 }, (_, i) => i + 2);
const MATHS = 3;
const CHALLENGE_S = 60;
/** More than anyone answers in a minute; the timer ends the challenge. */
const CHALLENGE_QUESTIONS = 120;

/** n × by with the answer and three near misses, shuffled into A–D. */
function sum(table: number, by: number, seq: number): RunnerQuestion {
  const answer = table * by;
  const wrong = new Set<number>();
  for (const delta of [table, -table, 1, -1, 2, 10]) {
    if (wrong.size < 3 && answer + delta > 0 && answer + delta !== answer) {
      wrong.add(answer + delta);
    }
  }
  const values = [answer, ...wrong].sort(() => Math.random() - 0.5);
  const content = {
    kind: 'question',
    type: 'mcq',
    body: {
      prompt: EN.kid.practice.sum(table, by),
      image_key: null,
      options: values.map((v, i) => ({ id: 'abcd'[i], text: String(v) })),
    },
    solution: {
      correct: ['abcd'[values.indexOf(answer)]],
      explanation: `${table} × ${by} = ${answer}`,
    },
  } as unknown as QuestionContent;
  return { id: `t${table}x${by}#${seq}`, versionId: null, content };
}

function shuffled(table: number): RunnerQuestion[] {
  return Array.from({ length: 10 }, (_, i) => i + 1)
    .sort(() => Math.random() - 0.5)
    .map((by, i) => sum(table, by, i));
}

/**
 * K10 Tables (App Flow §5; Plan 7.1): pick a table from 2 to 20, then practise its 10 sums or take
 * the 60-second challenge (as many right as possible, one answer each). Sums are made on the
 * device, so only the attempt (tables or tables_challenge, with counts) is synced.
 */
@Component({
  selector: 'app-tables-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, QuizRunner],
  template: `
    <h1 class="title" tabindex="-1">{{ table() ? text.table(table()!) : text.pickTable }}</h1>
    @if (!table()) {
      <div class="grid" role="group" [attr.aria-label]="text.pickTable">
        @for (n of tables; track n) {
          <app-button
            variant="secondary"
            [label]="String(n)"
            [ariaLabel]="text.table(n)"
            (pressed)="table.set(n)"
          />
        }
      </div>
    } @else if (!mode()) {
      <div class="actions">
        <app-button
          icon="play_arrow"
          [label]="text.practise"
          [fullWidth]="true"
          (pressed)="practise()"
        />
        <app-button
          variant="secondary"
          icon="hourglass_top"
          [label]="text.challenge"
          [fullWidth]="true"
          (pressed)="challenge()"
        />
      </div>
    } @else {
      @if (mode() === 'challenge') {
        <p class="timer" role="timer" aria-live="off">{{ text.timeLeft(secondsLeft()) }}</p>
        <p class="score" role="status">{{ text.challengeScore(right()) }}</p>
      }
      <app-quiz-runner
        [questions]="questions()"
        [mode]="mode() === 'challenge' ? 'quick' : 'learn'"
        (answered)="answered($event)"
        (finished)="finish($event.correct, $event.total)"
      />
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
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--space-2);
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .timer,
    .score {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
  `,
})
export class TablesPage {
  protected readonly text = EN.kid.practice;
  protected readonly tables = TABLES;
  protected readonly String = String;
  protected readonly table = signal<number | null>(null);
  protected readonly mode = signal<'practise' | 'challenge' | null>(null);
  protected readonly questions = signal<readonly RunnerQuestion[]>([]);
  protected readonly secondsLeft = signal(CHALLENGE_S);
  protected readonly right = signal(0);

  private readonly events = inject(KidEvents);
  private readonly session = inject(FamilySession);
  private readonly router = inject(Router);
  private attempt: AttemptEvent | null = null;
  private answeredCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedMs = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
  }

  protected practise(): void {
    this.begin('practise', shuffled(this.table() ?? 2));
  }

  protected challenge(): void {
    const table = this.table() ?? 2;
    this.begin(
      'challenge',
      Array.from({ length: CHALLENGE_QUESTIONS }, (_, i) =>
        sum(table, 1 + Math.floor(Math.random() * 10), i),
      ),
    );
    this.timer = setInterval(() => {
      this.secondsLeft.update((s) => s - 1);
      if (this.secondsLeft() <= 0) {
        void this.finish(this.right(), this.answeredCount);
      }
    }, 1000);
  }

  protected answered(event: RunnerAnswer): void {
    this.answeredCount++;
    if (event.correct) {
      this.right.update((n) => n + 1);
    }
  }

  protected async finish(correct: number, total: number): Promise<void> {
    this.stopTimer();
    const childId = this.session.activeChildId();
    if (this.attempt && childId && !this.attempt.completed_at) {
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
      queryParams: { stars: starsFor(correct, total), back: '/kid/practice/tables' },
      replaceUrl: true,
    });
  }

  private begin(mode: 'practise' | 'challenge', questions: RunnerQuestion[]): void {
    this.mode.set(mode);
    this.questions.set(questions);
    this.right.set(0);
    this.answeredCount = 0;
    this.secondsLeft.set(CHALLENGE_S);
    this.startedMs = Date.now();
    const childId = this.session.activeChildId();
    if (!childId) {
      return;
    }
    this.attempt = {
      id: crypto.randomUUID(),
      kind: mode === 'challenge' ? 'tables_challenge' : 'tables',
      subject_id: MATHS,
      content_item_id: null,
      content_version_id: null,
      family_chapter_id: null,
      topic_id: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      correct_count: null,
      total_count: null,
      duration_seconds: 0,
      resume_state: { table: this.table() ?? 2 },
    };
    void this.events.attempt(childId, this.attempt);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
