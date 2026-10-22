import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ApiError, ReadingApi, ReadingHome, recordingType } from '@fullstar/core';
import { Button, EN, KidRetry, OwlLoader, ProgressBar, illustrationUrl } from '@fullstar/ui';

/** App Flow K13: a 2-minute timer. */
const LIMIT_S = 120;
/** MediaRecorder types the API takes, the browser's first supported one is used. */
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

type Stage = 'ready' | 'recording' | 'sending' | 'mic-off' | 'limit';

/**
 * K13 Reading test (App Flow §5, §10; Schema §11; Plan 8.3): picture instructions, the passage, a
 * big microphone button and a 2-minute timer. The recording is uploaded, scoring is queued and K14
 * shows the result. A refused microphone asks for a parent, with the steps for them.
 */
@Component({
  selector: 'app-reading-test-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, KidRetry, OwlLoader, ProgressBar],
  template: `
    @if (home(); as h) {
      @if (h.passage; as passage) {
        @switch (stage()) {
          @case ('mic-off') {
            <div class="help" role="alert">
              <img [src]="owl" alt="" width="120" height="120" />
              <p class="help__kid">{{ text.micOff }}</p>
              <p class="help__parent">{{ text.micSteps }}</p>
              <app-button [label]="kid.tryAgain" (pressed)="record()" />
            </div>
          }
          @case ('limit') {
            <p class="help__kid" role="status">{{ text.testsLeft(0) }}</p>
            <app-button [label]="text.backToReading" (pressed)="back()" />
          }
          @default {
            <div class="intro">
              <img [src]="mic" alt="" width="64" height="64" />
              <p>{{ text.instructions }}</p>
            </div>
            <h1 class="title" [attr.lang]="passage.lang">{{ passage.title }}</h1>
            <p class="passage" [attr.lang]="passage.lang">{{ passage.text }}</p>
            @if (stage() === 'recording') {
              <app-progress-bar
                [value]="elapsed()"
                [max]="limit"
                [label]="text.timeLeft(limit - elapsed())"
              />
              <p class="status" role="status">
                {{ text.recording }} {{ text.timeLeft(limit - elapsed()) }}
              </p>
              <app-button [label]="text.stop" icon="check" [fullWidth]="true" (pressed)="stop()" />
            } @else if (stage() === 'sending') {
              <p class="status" role="status">{{ text.sending }}</p>
              <app-owl-loader />
            } @else {
              <app-button
                [label]="text.record"
                icon="mic"
                [fullWidth]="true"
                (pressed)="record()"
              />
            }
          }
        }
      } @else {
        <p class="help__kid">{{ text.noPassage }}</p>
      }
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
      gap: var(--space-4);
    }
    .intro {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      font: var(--type-body);
      color: var(--color-text);
    }
    .intro p {
      margin: 0;
    }
    .title {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
    .passage {
      margin: 0;
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-cream);
      font: var(--type-read-aloud, var(--type-body));
      line-height: 1.7;
      color: var(--color-text);
    }
    .status {
      margin: 0;
      font: var(--type-label);
      color: var(--color-text-2);
    }
    .help {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      text-align: center;
    }
    .help__kid {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
    .help__parent {
      max-width: 40ch;
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
  `,
})
export class ReadingTestPage {
  protected readonly text = EN.kid.reading;
  protected readonly kid = EN.kid;
  protected readonly owl = illustrationUrl('mascot-owl');
  protected readonly mic = illustrationUrl('act-reading');
  protected readonly limit = LIMIT_S;
  protected readonly home = signal<ReadingHome | null>(null);
  protected readonly failed = signal(false);
  protected readonly stage = signal<Stage>('ready');
  protected readonly elapsed = signal(0);

  private readonly api = inject(ReadingApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.destroyRef.onDestroy(() => this.release());
    this.load();
  }

  protected load(): void {
    this.failed.set(false);
    this.api
      .home()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (home) => {
          this.home.set(home);
          this.stage.set(home.tests_left_today > 0 ? 'ready' : 'limit');
        },
        error: () => this.failed.set(true),
      });
  }

  protected async record(): Promise<void> {
    const type = TYPES.find(
      (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
    );
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // NotAllowedError, or no microphone: App Flow §10 asks for a parent
      this.stage.set('mic-off');
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => this.send(new Blob(chunks, { type: recorder.mimeType }));
    this.recorder = recorder;
    recorder.start(1000);
    this.elapsed.set(0);
    this.stage.set('recording');
    this.timer = setInterval(() => {
      this.elapsed.update((s) => s + 1);
      if (this.elapsed() >= LIMIT_S) {
        this.stop();
      }
    }, 1000);
  }

  protected stop(): void {
    clearInterval(this.timer);
    if (this.recorder?.state === 'recording') {
      this.stage.set('sending');
      this.recorder.stop();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
  }

  protected back(): void {
    void this.router.navigateByUrl('/kid/read');
  }

  private send(recording: Blob): void {
    const passage = this.home()?.passage;
    const type = recordingType(recording.type) ?? 'audio/webm';
    if (!passage) {
      return;
    }
    this.api
      .send(passage.id, recording, type)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (test) =>
          void this.router.navigate(['/kid/read/result'], {
            queryParams: { test: test.id },
            replaceUrl: true,
          }),
        error: (error: unknown) => {
          if (error instanceof ApiError && error.code === 'READING_LIMIT') {
            this.stage.set('limit');
            return;
          }
          this.stage.set('ready');
          this.failed.set(true);
          this.home.set(null);
        },
      });
  }

  private release(): void {
    clearInterval(this.timer);
    if (this.recorder?.state === 'recording') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
  }
}
