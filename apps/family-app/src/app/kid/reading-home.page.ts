import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ReadingApi, ReadingHome } from '@fullstar/core';
import {
  Button,
  EN,
  IllustrationKey,
  KidRetry,
  OwlLoader,
  SectionHeader,
  illustrationUrl,
} from '@fullstar/ui';

const TREE: readonly IllustrationKey[] = ['level-seed', 'level-plant', 'level-tree'];

/**
 * K12 Reading home (App Flow §5, §9; Schema §11 GET /family/kid/reading; Plan 8.3): today's story,
 * the reading level as a growing tree, words to practise from the last test, and tries left today.
 * The first time: "Let's read your first story!" with a big start button.
 */
@Component({
  selector: 'app-reading-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, KidRetry, OwlLoader, SectionHeader],
  template: `
    @if (home(); as h) {
      <div class="level">
        <img [src]="tree()" [alt]="treeAlt()" width="96" height="96" />
        <span class="level__text">{{ text.level(h.level) }}</span>
      </div>
      @if (h.passage; as passage) {
        @if (!h.any_tests) {
          <div class="first">
            <img [src]="owl" alt="" width="120" height="120" />
            <h2 class="first__title">{{ text.firstStory }}</h2>
            <app-button [label]="text.start" icon="mic" [fullWidth]="true" (pressed)="start()" />
          </div>
        } @else {
          <section class="story" aria-labelledby="story-title">
            <span class="story__eyebrow"
              >{{ text.todaysStory }} · {{ text.language[passage.lang] }}</span
            >
            <h2 id="story-title" class="story__title" [attr.lang]="passage.lang">
              {{ passage.title }}
            </h2>
            <p class="story__left">{{ text.testsLeft(h.tests_left_today) }}</p>
            @if (h.tests_left_today > 0) {
              <app-button [label]="text.start" icon="mic" [fullWidth]="true" (pressed)="start()" />
            }
          </section>
        }
      } @else {
        <p class="note">{{ text.noPassage }}</p>
      }
      <app-section-header [title]="text.wordsToPractise" surface="sky" />
      @if (h.last_result?.words_to_practise?.length) {
        <ul class="words" role="list">
          @for (word of h.last_result?.words_to_practise ?? []; track word) {
            <li [attr.lang]="h.passage?.lang ?? null">{{ word }}</li>
          }
        </ul>
      } @else {
        <p class="note">{{ text.noWords }}</p>
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
    .level {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .level__text {
      font: var(--type-h2);
      color: var(--color-text-on-sky);
    }
    .first,
    .story {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-5);
      border-radius: var(--radius-xl);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .first {
      align-items: center;
      text-align: center;
    }
    .first__title,
    .story__title {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
    .story__eyebrow,
    .story__left {
      margin: 0;
      font: var(--type-label);
      color: var(--color-text-2);
    }
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-on-sky);
    }
    .words {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .words li {
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      font: var(--type-label);
      color: var(--color-ink-heading);
    }
  `,
})
export class ReadingHomePage {
  protected readonly text = EN.kid.reading;
  protected readonly owl = illustrationUrl('mascot-owl');
  protected readonly home = signal<ReadingHome | null>(null);
  protected readonly failed = signal(false);
  protected readonly tree = computed(() =>
    illustrationUrl(TREE[Math.min(Math.max((this.home()?.level ?? 1) - 1, 0), TREE.length - 1)]),
  );
  protected readonly treeAlt = computed(
    () => this.text.levelPicture[Math.min(Math.max((this.home()?.level ?? 1) - 1, 0), 2)],
  );

  private readonly api = inject(ReadingApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.failed.set(false);
    this.api
      .home()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (home) => this.home.set(home),
        error: () => this.failed.set(true),
      });
  }

  protected start(): void {
    void this.router.navigateByUrl('/kid/read/test');
  }
}
