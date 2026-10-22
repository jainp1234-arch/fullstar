import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AttemptEvent,
  FamilySession,
  KidApi,
  KidEvents,
  KidLesson,
  starsFor,
} from '@fullstar/core';
import {
  AnswerButton,
  Button,
  EN,
  IllustrationKey,
  LessonBody,
  LessonScene,
  ProgressBar,
  QuestionCard,
  QuestionContent,
  ReadAloud,
  SpeechBubble,
  contentValue,
  illustrationUrl,
  KidRetry,
  OwlLoader,
} from '@fullstar/ui';
import { gsap } from 'gsap';
import { Choice, choicesOf, pairsOf } from './question-choices';

interface Quiz {
  readonly itemId: string;
  readonly versionId: string;
  readonly content: QuestionContent;
}

/**
 * K4 lesson player (App Flow §5; Schema §5, §11; Plan 6.2): scene by scene with the owl's narration,
 * the illustration animated with GSAP (none with reduced motion), and inline quizzes with A–D
 * answers. Narration scenes move on by themselves after their duration; Pause stops that. Every
 * step is saved on the device first (KidEvents) and synced when online, so a lesson finished
 * offline counts once back online. It resumes where the child left off. The first answer to each
 * quiz counts; the child may try again until it is right. ?chapter= carries the uploaded chapter.
 */
@Component({
  selector: 'app-lesson-player-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AnswerButton,
    Button,
    KidRetry,
    OwlLoader,
    ProgressBar,
    QuestionCard,
    ReadAloud,
    SpeechBubble,
  ],
  template: `
    <h1 class="title" tabindex="-1" [attr.lang]="lang()">{{ lesson()?.title ?? screenTitle }}</h1>
    @if (lesson(); as l) {
      <app-progress-bar
        [value]="index() + 1"
        [max]="scenes().length"
        [label]="text.progress(index() + 1, scenes().length)"
      />
      @if (scene(); as s) {
        @if (quiz(); as q) {
          <app-question-card
            [question]="q.content.body.prompt"
            [position]="quizNumber()"
            [total]="quizzes().length"
            [lang]="lang()"
          >
            @if (q.content.type === 'match') {
              <p class="note">{{ text.matchHint }}</p>
              <ul class="pairs">
                @for (pair of pairs(); track pair.left) {
                  <li class="pairs__row">
                    <span [attr.lang]="lang()">{{ pair.left }}</span>
                    <span aria-hidden="true">→</span>
                    <span [attr.lang]="lang()">{{ solved() ? pair.right : '?' }}</span>
                  </li>
                }
              </ul>
              @if (!solved()) {
                <app-button variant="secondary" [label]="text.showPairs" (pressed)="showPairs(q)" />
              }
            } @else {
              @for (choice of choices(); track choice.letter) {
                <app-answer-button
                  [letter]="choice.letter"
                  [text]="choice.text"
                  [lang]="lang()"
                  [correct]="solved() && choice.correct"
                  [disabled]="solved()"
                  (pressed)="choose(q, choice)"
                />
              }
            }
          </app-question-card>
          @if (solved()) {
            <app-speech-bubble [text]="explanation(q)" [lang]="lang()" />
          } @else if (missed()) {
            <p class="note" role="status">{{ kid.notCorrect }}</p>
          }
        } @else {
          <div class="scene">
            @if (s.visual; as visual) {
              <img
                #picture
                class="scene__picture"
                [src]="pictureUrl(visual.illustration)"
                alt=""
                width="200"
                height="200"
              />
            }
            @if (s.text) {
              <app-speech-bubble [text]="s.text" [lang]="lang()" />
              <app-read-aloud [speaking]="speaking()" (pressed)="readAloud(s.text)" />
            }
          </div>
        }
      }
      <div class="controls">
        <app-button
          variant="secondary"
          icon="arrow_back"
          [label]="text.back"
          [disabled]="index() === 0"
          (pressed)="go(index() - 1)"
        />
        @if (!quiz()) {
          <app-button
            variant="ghost"
            [icon]="paused() ? 'play_arrow' : 'pause'"
            [label]="paused() ? text.play : text.pause"
            (pressed)="paused.set(!paused())"
          />
        }
        <app-button
          [label]="last() ? text.finish : text.next"
          [disabled]="!!quiz() && !solved()"
          (pressed)="last() ? finish() : go(index() + 1)"
        />
      </div>
    } @else if (failed()) {
      <app-kid-retry (retry)="load()" />
    } @else {
      <app-owl-loader />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .title {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
    .scene {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-4);
      min-height: 280px;
    }
    .scene__picture {
      display: block;
      max-width: 60%;
      height: auto;
    }
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .pairs {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
      font: var(--type-body);
    }
    .pairs__row {
      display: flex;
      gap: var(--space-3);
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--space-3);
    }
  `,
})
export class LessonPlayerPage {
  protected readonly text = EN.kid.player;
  protected readonly kid = EN.kid;
  protected readonly screenTitle = EN.screens.K4;
  protected readonly lesson = signal<KidLesson | null>(null);
  protected readonly failed = signal(false);
  protected readonly index = signal(0);
  protected readonly paused = signal(false);
  protected readonly solved = signal(false);
  protected readonly missed = signal(false);
  protected readonly speaking = signal(false);

  protected readonly scenes = computed<readonly LessonScene[]>(() => {
    const lesson = this.lesson();
    if (!lesson) {
      return [];
    }
    const known = new Set(lesson.questions.map((q) => q.id));
    // A quiz whose question was unpublished since is skipped
    return (lesson.body as LessonBody).scenes.filter(
      (scene) => !scene.quiz || known.has(scene.quiz.question_item_id),
    );
  });
  protected readonly scene = computed(() => this.scenes()[this.index()] ?? null);
  protected readonly last = computed(() => this.index() >= this.scenes().length - 1);
  protected readonly lang = computed(() => (this.lesson()?.lang === 'hi' ? 'hi' : null));
  protected readonly quizzes = computed<readonly Quiz[]>(() => {
    const lesson = this.lesson();
    if (!lesson) {
      return [];
    }
    return this.scenes()
      .filter((scene) => scene.quiz)
      .map((scene) => {
        const q = lesson.questions.find((x) => x.id === scene.quiz?.question_item_id);
        return q
          ? {
              itemId: q.id,
              versionId: q.version_id,
              content: contentValue(
                'question',
                q.question_type,
                q.body,
                q.solution,
              ) as QuestionContent,
            }
          : null;
      })
      .filter((quiz): quiz is Quiz => quiz !== null);
  });
  protected readonly quiz = computed(() => {
    const id = this.scene()?.quiz?.question_item_id;
    return id ? (this.quizzes().find((q) => q.itemId === id) ?? null) : null;
  });
  protected readonly quizNumber = computed(() => {
    const quiz = this.quiz();
    return quiz ? this.quizzes().indexOf(quiz) + 1 : 0;
  });
  protected readonly choices = computed(() => {
    const quiz = this.quiz();
    return quiz ? choicesOf(quiz.content) : [];
  });
  protected readonly pairs = computed(() => {
    const quiz = this.quiz()?.content;
    return quiz ? pairsOf(quiz) : [];
  });

  private readonly picture = viewChild<ElementRef<HTMLImageElement>>('picture');
  private readonly buttons = viewChildren(AnswerButton);
  private readonly api = inject(KidApi);
  private readonly events = inject(KidEvents);
  private readonly session = inject(FamilySession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private attempt: AttemptEvent | null = null;
  /** First answers by question: they decide the stars. */
  private readonly firstAnswers = new Map<string, boolean>();
  private sceneStart = Date.now();
  private elapsedMs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
    // Narration scenes move on by themselves unless paused; quizzes wait for the answer
    effect(() => {
      const scene = this.scene();
      const paused = this.paused();
      this.clearTimer();
      if (!scene || scene.quiz || paused || this.last()) {
        return;
      }
      this.timer = setTimeout(() => this.go(this.index() + 1), Math.max(1500, scene.duration_ms));
    });
    // GSAP plays the scene's animation; with reduced motion the picture just appears
    effect(() => {
      const element = this.picture()?.nativeElement;
      const animation = this.scene()?.visual?.animation;
      if (!element || !animation || animation === 'none' || reducedMotion()) {
        return;
      }
      const from =
        animation === 'fade-up'
          ? { opacity: 0, y: 24 }
          : animation === 'slide-in'
            ? { opacity: 0, x: -32 }
            : { scale: 0.6 };
      gsap.from(element, {
        ...from,
        duration: 0.5,
        ease: animation === 'pop' ? 'back.out(2)' : 'power2.out',
      });
    });
    this.destroyRef.onDestroy(() => {
      this.clearTimer();
      window.speechSynthesis?.cancel();
      // Leaving halfway keeps the place for the Continue card
      void this.save(null);
    });
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('lessonId') ?? '';
    this.failed.set(false);
    this.api
      .lesson(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lesson) => this.start(lesson),
        error: () => this.failed.set(true),
      });
  }

  protected pictureUrl(key: string): string {
    return illustrationUrl(key as IllustrationKey);
  }

  protected explanation(quiz: Quiz): string {
    const solution = quiz.content.solution as { explanation?: string };
    return `${this.kid.correct} ${solution.explanation ?? ''}`.trim();
  }

  protected go(index: number): void {
    const target = Math.max(0, Math.min(this.scenes().length - 1, index));
    if (target === this.index()) {
      return;
    }
    this.elapsedMs += Date.now() - this.sceneStart;
    this.sceneStart = Date.now();
    window.speechSynthesis?.cancel();
    this.speaking.set(false);
    this.index.set(target);
    this.solved.set(false);
    this.missed.set(false);
    void this.save(null);
  }

  protected choose(quiz: Quiz, choice: Choice): void {
    this.record(quiz, choice.correct, choice.answer);
    if (choice.correct) {
      this.solved.set(true);
      this.missed.set(false);
      return;
    }
    this.missed.set(true);
    this.buttons()
      .find((button) => button.letter() === choice.letter)
      ?.shake();
  }

  /** Match pairs are shown, not answered; they count as tried and right. */
  protected showPairs(quiz: Quiz): void {
    this.record(quiz, true, { shown: true });
    this.solved.set(true);
  }

  protected readAloud(text: string): void {
    const speech = window.speechSynthesis;
    if (!speech) {
      return;
    }
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.lang() === 'hi' ? 'hi-IN' : 'en-IN';
    utterance.onend = () => this.speaking.set(false);
    this.speaking.set(true);
    speech.speak(utterance);
  }

  protected async finish(): Promise<void> {
    this.elapsedMs += Date.now() - this.sceneStart;
    this.sceneStart = Date.now();
    const total = this.quizzes().length;
    const correct = [...this.firstAnswers.values()].filter(Boolean).length;
    await this.save(new Date().toISOString(), total ? correct : null, total || null);
    const back = this.route.snapshot.queryParamMap.get('back');
    void this.router.navigate(['/kid/well-done'], {
      queryParams: {
        stars: starsFor(total ? correct : null, total || null),
        ...(back && back.startsWith('/kid/') ? { back } : {}),
      },
      replaceUrl: true,
    });
  }

  private start(lesson: KidLesson): void {
    const childId = this.session.activeChildId();
    if (!childId) {
      this.failed.set(true);
      return;
    }
    this.lesson.set(lesson);
    const resume = lesson.resume;
    const position = Number(
      (resume?.resume_state as { position_s?: unknown } | null)?.position_s ?? 0,
    );
    this.attempt = {
      id: resume?.attempt_id ?? crypto.randomUUID(),
      kind: 'lesson',
      subject_id: lesson.subject_id,
      content_item_id: lesson.id,
      content_version_id: lesson.version_id,
      family_chapter_id: this.route.snapshot.queryParamMap.get('chapter'),
      topic_id: lesson.topic_id,
      started_at: new Date().toISOString(),
      completed_at: null,
      correct_count: null,
      total_count: null,
      duration_seconds: 0,
      resume_state: null,
    };
    // Resume at the scene that was playing at position_s
    let at = 0;
    let scene = 0;
    for (const [i, s] of this.scenes().entries()) {
      if (at + s.duration_ms / 1000 > position) {
        scene = i;
        break;
      }
      at += s.duration_ms / 1000;
      scene = Math.min(i + 1, this.scenes().length - 1);
    }
    this.index.set(position > 0 ? scene : 0);
    this.sceneStart = Date.now();
    void this.save(null);
  }

  private record(quiz: Quiz, correct: boolean, answer: unknown): void {
    const childId = this.session.activeChildId();
    if (!this.attempt || !childId || this.firstAnswers.has(quiz.itemId)) {
      return;
    }
    this.firstAnswers.set(quiz.itemId, correct);
    void this.events.answer(childId, {
      id: crypto.randomUUID(),
      attempt_id: this.attempt.id,
      question_item_id: quiz.itemId,
      question_version_id: quiz.versionId,
      is_correct: correct,
      answer,
      answered_at: new Date().toISOString(),
    });
  }

  /** The attempt's state on the device; position_s is where the current scene starts. */
  private async save(
    completedAt: string | null,
    correct: number | null = null,
    total: number | null = null,
  ): Promise<void> {
    const childId = this.session.activeChildId();
    if (!this.attempt || !childId || this.attempt.completed_at) {
      return;
    }
    const position = this.scenes()
      .slice(0, this.index())
      .reduce((sum, s) => sum + s.duration_ms / 1000, 0);
    this.attempt = {
      ...this.attempt,
      completed_at: completedAt,
      correct_count: correct,
      total_count: total,
      duration_seconds: Math.round((this.elapsedMs + Date.now() - this.sceneStart) / 1000),
      resume_state: completedAt ? null : { position_s: Math.round(position) },
    };
    await this.events.attempt(childId, this.attempt);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

function reducedMotion(): boolean {
  return (
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
