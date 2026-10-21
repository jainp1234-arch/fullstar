import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { KidApi, KidEntry, KidSubject } from '@fullstar/core';
import {
  Button,
  EN,
  EmptyState,
  IllustrationKey,
  ListCard,
  SectionHeader,
  Skeleton,
} from '@fullstar/ui';
import { map, switchMap, throwError } from 'rxjs';

/**
 * K2 Subject (App Flow §5; Schema §11 GET /family/kid/subjects/{id}; Plan 6.1): with a book, its
 * ready chapters; without one, the class's grade-level topics. Finished ones carry a Done tab.
 */
@Component({
  selector: 'app-subject-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, ListCard, SectionHeader, Skeleton],
  template: `
    @if (subject(); as s) {
      <app-section-header
        [title]="s.mode === 'book' ? text.chaptersTitle : text.topicsTitle"
        surface="sky"
      />
      @if (s.entries.length) {
        <div class="entries">
          @for (entry of s.entries; track entry.id) {
            <app-list-card
              [illustration]="illustration(s)"
              [title]="titleOf(entry)"
              [cornerTab]="entry.done ? { text: text.done, tone: 'green' } : null"
              [attr.data-screen-link]="linkTo(s, entry)"
              (pressed)="open(s, entry)"
            />
          }
        </div>
      } @else {
        <app-empty-state illustration="empty-books" [title]="text.nothingYet" />
      }
    } @else if (failed()) {
      <div class="failed" role="alert">
        <p>{{ kid.somethingFailed }}</p>
        <app-button [label]="kid.tryAgain" (pressed)="load()" />
      </div>
    } @else {
      <app-skeleton shape="list-card" [count]="4" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .entries {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .failed {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
      font: var(--type-body);
      color: var(--color-text-on-sky);
    }
  `,
})
export class SubjectPage {
  protected readonly text = EN.kid.learn;
  protected readonly kid = EN.kid;
  protected readonly subject = signal<KidSubject | null>(null);
  protected readonly failed = signal(false);

  private readonly api = inject(KidApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.load();
  }

  protected load(): void {
    const code = this.route.snapshot.paramMap.get('subject');
    this.failed.set(false);
    // The route names the subject by code; the API by id, from the child's home
    this.api
      .home()
      .pipe(
        map((home) => home.subjects.find((s) => s.code === code)),
        switchMap((tile) =>
          tile ? this.api.subject(tile.subject_id) : throwError(() => new Error('unknown subject')),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (subject) => this.subject.set(subject),
        error: () => this.failed.set(true),
      });
  }

  protected illustration(subject: KidSubject): IllustrationKey {
    return `subject-${subject.code}`;
  }

  protected titleOf(entry: KidEntry): string {
    return entry.number === null ? entry.title : this.text.chapterLine(entry.number, entry.title);
  }

  protected linkTo(subject: KidSubject, entry: KidEntry): string {
    // The route walk in e2e/routes.ts compares paths only
    return this.location.prepareExternalUrl(this.urlOf(subject, entry).split('?')[0]);
  }

  protected open(subject: KidSubject, entry: KidEntry): void {
    void this.router.navigateByUrl(this.urlOf(subject, entry));
  }

  /** K3 is the same screen for a chapter and a topic; ?type= tells which. */
  private urlOf(subject: KidSubject, entry: KidEntry): string {
    const type = subject.mode === 'book' ? 'chapter' : 'topic';
    return `/kid/learn/${subject.code}/${encodeURIComponent(entry.id)}?type=${type}`;
  }
}
