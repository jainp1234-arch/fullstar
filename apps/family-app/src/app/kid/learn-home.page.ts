import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ContinueCard, KidApi, KidEvents, KidHome, KidSubjectTile } from '@fullstar/core';
import {
  BannerCard,
  EN,
  IllustrationKey,
  ListCard,
  StarPill,
  KidRetry,
  OwlLoader,
  CardState,
  ToastService,
} from '@fullstar/ui';
import { offlineMissing } from './kid-offline';

/**
 * K1 My subjects (App Flow §5; Schema §11 GET /family/kid/home; Plan 6.1): a greeting with the star
 * pill, a Continue card when something was left halfway, then one card per subject saying "My book"
 * or "Class 3 practice".
 */
@Component({
  selector: 'app-learn-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BannerCard, KidRetry, ListCard, OwlLoader, StarPill],
  template: `
    @if (home(); as h) {
      <div class="top">
        <h2 class="hello">{{ text.hello(h.child.first_name) }}</h2>
        <app-star-pill [count]="h.stars" />
      </div>
      @if (h.continue_card; as card) {
        <button
          type="button"
          class="continue"
          [attr.data-screen-link]="linkTo(continueUrl(card))"
          (click)="go(continueUrl(card))"
        >
          <app-banner-card
            [eyebrow]="text.continueEyebrow"
            [body]="continueText(card)"
            [illustration]="card.kind === 'lesson' ? 'act-lesson' : 'act-readalong'"
          />
        </button>
      }
      <div class="subjects">
        @for (subject of h.subjects; track subject.subject_id) {
          <app-list-card
            [illustration]="illustrationOf(subject)"
            [title]="subject.name"
            [subtitle]="subject.mode === 'book' ? text.myBook : text.practice(h.child.class_level)"
            [state]="stateOf(subject)"
            [attr.data-screen-link]="linkTo(subjectUrl(subject))"
            (pressed)="$event === 'offline' ? needsInternet() : go(subjectUrl(subject))"
          />
        }
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
      gap: var(--space-4);
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
    }
    .hello {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-text-on-sky);
    }
    .continue {
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      background: none;
      text-align: start;
      cursor: pointer;
      border-radius: var(--radius-xl);
    }
    .continue:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .subjects {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
  `,
})
export class LearnHomePage {
  protected readonly text = EN.kid.learn;
  protected readonly kid = EN.kid;
  protected readonly home = signal<KidHome | null>(null);
  protected readonly failed = signal(false);

  private readonly api = inject(KidApi);
  private readonly events = inject(KidEvents);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(ToastService);
  /** Offline: subjects not opened before (App Flow §10, Plan 7.5). */
  private readonly missing = offlineMissing(() =>
    (this.home()?.subjects ?? []).map((s) => ({
      id: String(s.subject_id),
      call: { method: 'GET' as const, path: `/family/kid/subjects/${s.subject_id}` },
    })),
  );

  protected stateOf(subject: KidSubjectTile): CardState {
    return this.missing().has(String(subject.subject_id)) ? 'offline' : 'normal';
  }

  protected needsInternet(): void {
    this.toasts.show(this.kid.offline);
  }

  constructor() {
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
          this.events.seed(home.child.id, home.stars, home.minutes_today);
        },
        error: () => this.failed.set(true),
      });
  }

  protected illustrationOf(subject: KidSubjectTile): IllustrationKey {
    return `subject-${subject.code}`;
  }

  protected subjectUrl(subject: KidSubjectTile): string {
    return `/kid/learn/${subject.code}`;
  }

  /** A lesson opens K4 where it was left; read-along opens K5. */
  protected continueUrl(card: ContinueCard): string {
    return card.kind === 'lesson' && card.content_item_id
      ? `/kid/lesson/${encodeURIComponent(card.content_item_id)}`
      : `/kid/read-along/${encodeURIComponent(card.family_chapter_id ?? '')}`;
  }

  protected continueText(card: ContinueCard): string {
    return card.kind === 'lesson' && card.title
      ? this.text.continueLesson(card.title)
      : this.text.continueReadAlong;
  }

  /** The address for the route walk in e2e/routes.ts. */
  protected linkTo(url: string): string {
    return this.location.prepareExternalUrl(url);
  }

  protected go(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
