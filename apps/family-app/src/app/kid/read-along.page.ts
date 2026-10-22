import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AttemptEvent,
  CachedChapter,
  FamilySession,
  KidEvents,
  ReadAlongCache,
  WordTiming,
  wordAt,
} from '@fullstar/core';
import { Button, EN, ProgressBar, Skeleton } from '@fullstar/ui';

/**
 * K5 Read-along (App Flow §5; Schema §11; Plan 6.3): the book page with each word highlighted as it
 * is read aloud, from the page's word timings against the narration's playback time. Tap a word to
 * hear it again; previous and next page. The open chapter is kept on the device (ReadAlongCache),
 * so it reads offline once opened. Progress is a readalong attempt synced like lessons; finishing
 * the last page completes it. Narration is silent stand-in audio until Plan 8.2.
 */
@Component({
  selector: 'app-read-along-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ProgressBar, Skeleton],
  template: `
    <h1 class="title" tabindex="-1" [attr.lang]="lang()">
      {{ opened()?.chapter?.title ?? screenTitle }}
    </h1>
    @if (opened(); as o) {
      @if (o.offline) {
        <p class="note" role="status">{{ text.offline }}</p>
      }
      <app-progress-bar
        [value]="index() + 1"
        [max]="o.chapter.pages.length"
        [label]="text.page(index() + 1, o.chapter.pages.length)"
      />
      @if (page(); as p) {
        <img
          class="page__image"
          [src]="o.images[index()]"
          [alt]="text.pageImage(p.page_no)"
          width="600"
          height="800"
        />
        <p class="words" [attr.lang]="lang()">
          @for (word of timings(); track $index; let i = $index) {
            <button
              type="button"
              class="word"
              [class.word--now]="i === current()"
              [attr.aria-current]="i === current() ? 'true' : null"
              [attr.aria-label]="text.word(word.w)"
              (click)="hear(word)"
            >
              {{ word.w }}</button
            >{{ ' ' }}
          } @empty {
            {{ p.text }}
          }
        </p>
        @if (o.audio[index()]; as src) {
          <audio
            #audio
            [src]="src"
            preload="auto"
            (play)="onPlay()"
            (pause)="playing.set(false)"
            (ended)="ended()"
          ></audio>
          <app-button
            [icon]="playing() ? 'pause' : 'volume_up'"
            [label]="playing() ? text.pause : text.play"
            (pressed)="toggle()"
          />
        } @else {
          <p class="note">{{ text.noAudio }}</p>
        }
      }
      <div class="controls">
        <app-button
          variant="secondary"
          icon="arrow_back"
          [label]="text.previous"
          [disabled]="index() === 0"
          (pressed)="turn(index() - 1)"
        />
        <app-button
          [label]="last() ? text.finish : text.next"
          (pressed)="last() ? finish() : turn(index() + 1)"
        />
      </div>
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
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .page__image {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .words {
      margin: 0;
      font: var(--type-body);
      font-size: 22px;
      line-height: 1.8;
      color: var(--color-text);
    }
    .word {
      padding: 0 2px;
      border: 0;
      border-radius: var(--radius-sm);
      background: none;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    .word--now {
      background: var(--color-gold-100);
      color: var(--color-ink-heading);
      font-weight: 700;
    }
    .word:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 1px;
    }
    .controls {
      display: flex;
      justify-content: space-between;
      gap: var(--space-3);
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
export class ReadAlongPage {
  protected readonly text = EN.kid.readAlong;
  protected readonly kid = EN.kid;
  protected readonly screenTitle = EN.screens.K5;
  protected readonly opened = signal<CachedChapter | null>(null);
  protected readonly failed = signal(false);
  protected readonly index = signal(0);
  protected readonly current = signal(-1);
  protected readonly playing = signal(false);

  protected readonly page = computed(() => this.opened()?.chapter.pages[this.index()] ?? null);
  protected readonly timings = computed<readonly WordTiming[]>(
    () => this.page()?.word_timings ?? [],
  );
  protected readonly last = computed(
    () => this.index() >= (this.opened()?.chapter.pages.length ?? 1) - 1,
  );
  protected readonly lang = computed(() => (this.opened()?.chapter.lang === 'hi' ? 'hi' : null));

  private readonly audio = viewChild<ElementRef<HTMLAudioElement>>('audio');
  private readonly cache = inject(ReadAlongCache);
  private readonly events = inject(KidEvents);
  private readonly session = inject(FamilySession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private attempt: AttemptEvent | null = null;
  private frame = 0;
  /** A tapped word plays until its end only. */
  private stopAt: number | null = null;
  private readonly startedMs = Date.now();

  constructor() {
    this.load();
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.frame);
      this.cache.release();
      void this.save(null);
    });
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('chapterId') ?? '';
    this.failed.set(false);
    this.cache.open(id).then(
      (opened) => this.start(opened),
      () => this.failed.set(true),
    );
  }

  protected toggle(): void {
    const audio = this.audio()?.nativeElement;
    if (!audio) {
      return;
    }
    this.stopAt = null;
    if (audio.paused) {
      void audio.play().catch(() => this.playing.set(false));
    } else {
      audio.pause();
    }
  }

  protected hear(word: WordTiming): void {
    const audio = this.audio()?.nativeElement;
    if (!audio) {
      return;
    }
    audio.currentTime = word.start_ms / 1000;
    this.stopAt = word.end_ms;
    void audio.play().catch(() => this.playing.set(false));
  }

  /** The highlight runs from the moment the audio really plays. */
  protected onPlay(): void {
    this.playing.set(true);
    this.follow();
  }

  protected ended(): void {
    this.playing.set(false);
    this.current.set(-1);
  }

  protected turn(index: number): void {
    this.audio()?.nativeElement.pause();
    this.current.set(-1);
    this.index.set(index);
    void this.save(null);
  }

  protected async finish(): Promise<void> {
    await this.save(new Date().toISOString());
    const back = this.route.snapshot.queryParamMap.get('back');
    void this.router.navigate(['/kid/well-done'], {
      queryParams: { stars: 1, ...(back && back.startsWith('/kid/') ? { back } : {}) },
      replaceUrl: true,
    });
  }

  /** Highlights the word at the audio's time on every frame while it plays. */
  private follow(): void {
    cancelAnimationFrame(this.frame);
    const tick = () => {
      const audio = this.audio()?.nativeElement;
      if (!audio) {
        return;
      }
      const ms = audio.currentTime * 1000;
      if (this.stopAt !== null && ms >= this.stopAt) {
        audio.pause();
        this.stopAt = null;
      }
      this.current.set(wordAt(this.timings(), ms));
      if (!audio.paused) {
        this.frame = requestAnimationFrame(tick);
      }
    };
    this.frame = requestAnimationFrame(tick);
  }

  private start(opened: CachedChapter): void {
    this.opened.set(opened);
    const resume = opened.chapter.resume;
    const page = Number((resume?.resume_state as { page?: unknown } | null)?.page ?? 0);
    this.index.set(
      Number.isInteger(page) && page > 0 && page < opened.chapter.pages.length ? page : 0,
    );
    this.attempt = {
      id: resume?.attempt_id ?? crypto.randomUUID(),
      kind: 'readalong',
      subject_id: opened.chapter.subject_id,
      content_item_id: null,
      content_version_id: null,
      family_chapter_id: opened.chapter.id,
      topic_id: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      correct_count: null,
      total_count: null,
      duration_seconds: 0,
      resume_state: null,
    };
    void this.save(null);
  }

  private async save(completedAt: string | null): Promise<void> {
    const childId = this.session.activeChildId();
    if (!this.attempt || !childId || this.attempt.completed_at) {
      return;
    }
    this.attempt = {
      ...this.attempt,
      completed_at: completedAt,
      duration_seconds: Math.round((Date.now() - this.startedMs) / 1000),
      resume_state: completedAt ? null : { page: this.index() },
    };
    await this.events.attempt(childId, this.attempt);
  }
}
