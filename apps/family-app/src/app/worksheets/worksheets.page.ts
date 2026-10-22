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
import { Router } from '@angular/router';
import { ApiError, FamilyApi, WorksheetApi, WorksheetSummary } from '@fullstar/core';
import {
  Button,
  EN,
  EmptyState,
  IllustrationKey,
  ListCard,
  Skeleton,
  errorMessage,
  ErrorBar,
} from '@fullstar/ui';

/**
 * P10 Worksheets (App Flow §6; Plan 7.2): the worksheets made so far, newest first, by subject and
 * chapter or topic, with Create worksheet. Each opens Print / share (P12) or Solutions (P13).
 */
@Component({
  selector: 'app-worksheets-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, ErrorBar, ListCard, Skeleton],
  template: `
    @if (worksheets(); as list) {
      @if (list.length) {
        <app-button
          icon="add"
          [label]="text.create"
          [attr.data-screen-link]="linkTo('/parent/worksheets/new')"
          (pressed)="go('/parent/worksheets/new')"
        />
        <ul class="list" role="list">
          @for (w of list; track w.id) {
            <li class="item">
              <app-list-card
                [illustration]="illustrationOf(w)"
                [title]="childName(w.child_id) + ' · ' + sourceOf(w)"
                [subtitle]="text.line(w.subject_name, dateOf(w.created_at), w.question_count)"
              />
              <div class="actions">
                <app-button
                  variant="secondary"
                  icon="download"
                  [label]="text.print"
                  [ariaLabel]="text.print + ': ' + sourceOf(w)"
                  [attr.data-screen-link]="linkTo('/parent/worksheets/' + w.id + '/print')"
                  (pressed)="go('/parent/worksheets/' + w.id + '/print')"
                />
                <app-button
                  variant="ghost"
                  icon="fact_check"
                  [label]="text.solutions"
                  [ariaLabel]="text.solutions + ': ' + sourceOf(w)"
                  [attr.data-screen-link]="linkTo('/parent/worksheets/' + w.id + '/solutions')"
                  (pressed)="go('/parent/worksheets/' + w.id + '/solutions')"
                />
              </div>
            </li>
          }
        </ul>
      } @else {
        <app-empty-state
          illustration="act-worksheet"
          [title]="text.empty"
          [actionLabel]="text.createFirst"
          (action)="go('/parent/worksheets/new')"
        />
      }
    } @else if (failure(); as message) {
      <app-error-bar [message]="message" (retry)="load()" />
    } @else {
      <app-skeleton shape="list-card" [count]="3" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .warning {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
})
export class WorksheetsPage {
  protected readonly text = EN.worksheets;
  protected readonly worksheets = signal<readonly WorksheetSummary[] | null>(null);
  protected readonly failure = signal<string | null>(null);

  private readonly api = inject(WorksheetApi);
  private readonly family = inject(FamilyApi);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private readonly names = computed(
    () => new Map((this.family.me()?.children ?? []).map((c) => [c.id, c.first_name])),
  );

  constructor() {
    if (!this.family.me()) {
      this.family.loadMe().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
    this.load();
  }

  protected load(): void {
    this.failure.set(null);
    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.worksheets.set(list),
        error: (error: unknown) =>
          this.failure.set(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
          ),
      });
  }

  protected childName(id: string): string {
    return this.names().get(id) ?? '';
  }

  protected sourceOf(w: WorksheetSummary): string {
    return w.chapter_number !== null
      ? this.text.chapter(w.chapter_number, w.source_title)
      : w.source_title;
  }

  protected dateOf(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  protected illustrationOf(w: WorksheetSummary): IllustrationKey {
    return `subject-${w.subject}` as IllustrationKey;
  }

  protected linkTo(url: string): string {
    return this.location.prepareExternalUrl(url);
  }

  protected go(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
