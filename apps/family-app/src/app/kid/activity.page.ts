import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { KidActivity, KidApi, KidLessonCard } from '@fullstar/core';
import { CardState, EN, KidRetry, ListCard, OwlLoader, ToastService } from '@fullstar/ui';
import { OfflineItem, offlineMissing } from './kid-offline';

/**
 * K3 Chapter / topic (App Flow §5; Schema §11; Plan 6.1): Watch lesson (one card per published
 * lesson, or "Coming soon" while our team prepares it), Read along for uploaded chapters, and
 * Worksheet: the newest one a parent made for this chapter or topic (K6); none yet says to ask a parent.
 * ?type=topic for a grade-level topic; otherwise the id is a chapter of the child's book.
 */
@Component({
  selector: 'app-activity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KidRetry, ListCard, OwlLoader],
  template: `
    @if (activity(); as a) {
      <h2 class="title">
        {{ a.number === null ? a.title : text.chapterLine(a.number, a.title) }}
      </h2>
      <div class="cards">
        @for (lesson of a.lessons; track lesson.content_item_id) {
          <app-list-card
            illustration="act-lesson"
            [title]="a.lessons.length === 1 ? text.watchLesson : lesson.title"
            [subtitle]="subtitleOf(lesson)"
            [cornerTab]="lesson.done ? { text: text.done, tone: 'green' } : null"
            [state]="stateOf(lesson.content_item_id)"
            [attr.data-screen-link]="linkTo('/kid/lesson/' + lesson.content_item_id)"
            (pressed)="$event === 'offline' ? needsInternet() : watch(a, lesson)"
          />
        } @empty {
          <app-list-card
            illustration="state-wait"
            [title]="text.watchLesson"
            [cornerTab]="{ text: text.comingSoon, tone: 'gold' }"
            state="locked"
            (pressed)="soon(kid.lessonNotReady)"
          />
        }
        @if (a.read_along) {
          <app-list-card
            illustration="act-readalong"
            [title]="text.readAlong"
            [state]="stateOf('read-along')"
            [attr.data-screen-link]="linkTo('/kid/read-along/' + a.id)"
            (pressed)="$event === 'offline' ? needsInternet() : readAlong(a)"
          />
        }
        @if (a.worksheet_id; as worksheetId) {
          <app-list-card
            illustration="act-worksheet"
            [title]="text.worksheet"
            [state]="stateOf('worksheet')"
            [attr.data-screen-link]="linkTo('/kid/worksheet/' + worksheetId)"
            (pressed)="$event === 'offline' ? needsInternet() : openWorksheet(worksheetId)"
          />
        } @else {
          <app-list-card
            illustration="state-wait"
            [title]="text.worksheet"
            [cornerTab]="{ text: text.comingSoon, tone: 'gold' }"
            state="locked"
            (pressed)="soon(text.worksheetSoon)"
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
    .title {
      margin: 0;
      font: var(--type-h2);
      color: var(--color-ink-heading);
    }
    .cards {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
  `,
})
export class ActivityPage {
  protected readonly text = EN.kid.learn;
  protected readonly kid = EN.kid;
  protected readonly activity = signal<KidActivity | null>(null);
  protected readonly failed = signal(false);

  private readonly api = inject(KidApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  /** Offline: cards whose content the device doesn't have (App Flow §10, Plan 7.5). */
  private readonly missing = offlineMissing(() => {
    const a = this.activity();
    if (!a) {
      return [];
    }
    const items: OfflineItem[] = a.lessons.map((lesson) => ({
      id: lesson.content_item_id,
      call: { method: 'GET', path: `/family/kid/lessons/${lesson.content_item_id}` },
    }));
    if (a.read_along) {
      items.push({ id: 'read-along', readAlong: a.id });
    }
    if (a.worksheet_id) {
      items.push({
        id: 'worksheet',
        call: { method: 'POST', path: `/family/kid/worksheets/${a.worksheet_id}/onscreen` },
      });
    }
    return items;
  });

  constructor() {
    this.load();
  }

  protected stateOf(id: string): CardState {
    return this.missing().has(id) ? 'offline' : 'normal';
  }

  /** Guidelines §16 offline (kid): the card stays, tapping says why. */
  protected needsInternet(): void {
    this.toasts.show(this.kid.offline);
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('chapter') ?? '';
    const topic = this.route.snapshot.queryParamMap.get('type') === 'topic';
    this.failed.set(false);
    (topic ? this.api.topic(id) : this.api.chapter(id))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (activity) => this.activity.set(activity),
        error: () => this.failed.set(true),
      });
  }

  protected subtitleOf(lesson: KidLessonCard): string | null {
    return lesson.duration_seconds ? this.text.minutes(lesson.duration_seconds) : null;
  }

  /** Guidelines §11: a locked card is never hidden silently; tapping says why. */
  protected soon(message: string): void {
    this.toasts.show(message);
  }

  /** K6 with the way back here for K7. */
  protected openWorksheet(worksheetId: string): void {
    void this.router.navigate(['/kid/worksheet', worksheetId], {
      queryParams: { back: this.router.url },
    });
  }

  /** K5 with the way back here for K7. */
  protected readAlong(activity: KidActivity): void {
    void this.router.navigate(['/kid/read-along', activity.id], {
      queryParams: { back: this.router.url },
    });
  }

  /** K4 with the chapter for the attempt and the way back here for K7. */
  protected watch(activity: KidActivity, lesson: KidLessonCard): void {
    void this.router.navigate(['/kid/lesson', lesson.content_item_id], {
      queryParams: {
        ...(activity.kind === 'chapter' ? { chapter: activity.id } : {}),
        back: this.router.url,
      },
    });
  }

  protected linkTo(url: string): string {
    return this.location.prepareExternalUrl(url);
  }

  protected go(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
