import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiError, FamilyApi, FamilyChild, ProgressApi, WeekSummary } from '@fullstar/core';
import {
  AVATAR_KEYS,
  Avatar,
  AvatarKey,
  EN,
  IllustrationKey,
  ListCard,
  SectionHeader,
  Skeleton,
  errorMessage,
  ErrorBar,
  Connectivity,
} from '@fullstar/ui';

const AVATARS = new Set<string>(AVATAR_KEYS);

/**
 * P1 Progress (App Flow §6; Schema §7 child_week_summary, §11; Plan 6.4): one child at a time (tabs
 * with two children, ?child=), never compared. This week: time, chapters and worksheets done, and
 * areas to work on; then progress by subject (opens P2) and reading, which arrives with reading
 * tests (Phase 7). A child with no activity yet sees the getting-started checklist.
 */
@Component({
  selector: 'app-progress-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, ErrorBar, ListCard, SectionHeader, Skeleton],
  template: `
    @if (children().length > 1) {
      <div class="tabs" role="tablist" [attr.aria-label]="text.childTabs">
        @for (child of children(); track child.id) {
          <button
            type="button"
            role="tab"
            class="tab"
            [class.tab--active]="child.id === childId()"
            [attr.aria-selected]="child.id === childId()"
            (click)="choose(child.id)"
          >
            <app-avatar [animal]="avatarOf(child)" [size]="40" />
            <span>{{ child.first_name }}</span>
          </button>
        }
      </div>
    }
    @if (!online()) {
      <!-- App Flow §11: progress offline is the last saved view -->
      <p class="saved" role="status">{{ text.savedView }}</p>
    }
    @if (week(); as w) {
      @if (!w.any_activity) {
        <app-section-header [title]="text.firstSteps" />
        <ul class="steps">
          <li>{{ text.stepBooks }}</li>
          <li>{{ text.stepLesson }}</li>
          <li>{{ text.stepReading }}</li>
        </ul>
      }
      <section class="card" [attr.aria-label]="text.thisWeek">
        <h2 class="card__title">{{ text.thisWeek }}</h2>
        <p class="line">{{ text.minutes(w.minutes) }} {{ text.activeDays(w.active_days) }}</p>
        <p class="line">{{ text.chaptersDone(w.chapters_done) }}</p>
        <p class="line">{{ text.worksheetsDone(w.worksheets_done) }}</p>
        <h3 class="card__sub">{{ text.areas }}</h3>
        @if (w.areas.length) {
          <ul class="areas">
            @for (area of w.areas; track area.topic_id) {
              <li>{{ area.name }} · {{ subjectName(area.subject) }}</li>
            }
          </ul>
        } @else {
          <p class="note">{{ text.noAreas }}</p>
        }
      </section>
      <app-section-header [title]="text.bySubject" />
      <div class="subjects">
        @for (subject of w.subjects; track subject.subject_id) {
          <app-list-card
            [illustration]="illustrationOf(subject.code)"
            [title]="subject.name"
            [subtitle]="
              text.subjectLine(subject.chapters_done, subject.chapters_total, subject.lessons_done)
            "
            [chevron]="true"
            [attr.data-screen-link]="linkTo(subject.code)"
            (pressed)="open(subject.code)"
          />
        }
      </div>
      <app-section-header [title]="text.reading" />
      <p class="note">{{ text.noReading }}</p>
    } @else if (failure(); as message) {
      <app-error-bar [message]="message" (retry)="retryLoad()" />
    } @else {
      <app-skeleton shape="list-card" [count]="3" />
    }
  `,
  styles: `
    .saved {
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .tabs {
      display: flex;
      gap: var(--space-3);
    }
    .tab {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: 56px;
      padding: var(--space-1) var(--space-4) var(--space-1) var(--space-1);
      border: 2px solid var(--color-border);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      font: var(--type-label);
      color: var(--color-text);
      cursor: pointer;
    }
    .tab--active {
      border-color: var(--color-primary-600);
      background: var(--color-primary-100);
    }
    .tab:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .card__title {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .card__sub {
      margin: var(--space-2) 0 0;
      font: var(--type-label);
      color: var(--color-ink-heading);
    }
    .line,
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text);
    }
    .note {
      color: var(--color-text-2);
    }
    .warning {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .areas,
    .steps {
      margin: 0;
      padding-left: var(--space-5);
      font: var(--type-body);
      color: var(--color-text);
    }
    .subjects {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
  `,
})
export class ProgressPage {
  protected readonly text = EN.progress;
  protected readonly online = inject(Connectivity).online;
  protected readonly week = signal<WeekSummary | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly childId = signal<string | null>(null);

  private readonly family = inject(FamilyApi);
  private readonly progress = inject(ProgressApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly children = computed<readonly FamilyChild[]>(
    () => this.family.me()?.children ?? [],
  );

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      const run = (): void => {
        const list = this.children();
        const id = list.find((c) => c.id === query.get('child'))?.id ?? list[0]?.id ?? null;
        this.childId.set(id);
        if (id) {
          this.load(id);
        }
      };
      if (this.family.me()) {
        run();
      } else {
        this.family
          .loadMe()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(() => run());
      }
    });
  }

  protected avatarOf(child: FamilyChild): AvatarKey {
    return (AVATARS.has(child.avatar_key) ? child.avatar_key : 'cat') as AvatarKey;
  }

  protected illustrationOf(code: string): IllustrationKey {
    return `subject-${code}` as IllustrationKey;
  }

  protected subjectName(code: string): string {
    return this.week()?.subjects.find((s) => s.code === code)?.name ?? code;
  }

  protected choose(childId: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { child: childId },
      replaceUrl: true,
    });
  }

  protected linkTo(code: string): string {
    return this.location.prepareExternalUrl(`/parent/progress/subject/${code}`);
  }

  protected open(code: string): void {
    void this.router.navigate(['/parent/progress/subject', code], {
      queryParams: { child: this.childId() },
    });
  }

  protected retryLoad(): void {
    const id = this.childId();
    if (id) {
      this.load(id);
    }
  }

  private load(childId: string): void {
    this.failure.set(null);
    this.week.set(null);
    this.progress
      .week(childId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (week) => this.week.set(week),
        error: (error: unknown) =>
          this.failure.set(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
          ),
      });
  }
}
