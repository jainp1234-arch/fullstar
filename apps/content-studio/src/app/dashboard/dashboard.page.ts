import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ApiError, DashboardCounts, StudioApi } from '@fullstar/core';
import {
  ActionCard,
  Button,
  CurrentScreen,
  EN,
  IconName,
  ScreenId,
  Skeleton,
  errorMessage,
} from '@fullstar/ui';

interface DashboardCard {
  readonly icon: IconName;
  readonly label: string;
  readonly screen: ScreenId;
}

/**
 * S2 Dashboard (App Flow §7, Schema §11): new uploads, drafts in progress, recently published,
 * open problem reports and open support tickets; each card opens its queue.
 */
@Component({
  selector: 'app-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActionCard, Button, Skeleton],
  template: `
    @if (cards(); as list) {
      <div class="ui-action-grid">
        @for (card of list; track card.screen + card.icon) {
          <app-action-card
            [icon]="card.icon"
            [label]="card.label"
            [attr.data-screen-link]="linkOf(card.screen)"
            (pressed)="open(card.screen)"
          />
        }
      </div>
    } @else if (failure(); as message) {
      <div class="error" role="alert">
        <span>{{ message }}</span>
        <app-button variant="ghost" [label]="text.tryAgain" (pressed)="load()" />
      </div>
    } @else {
      <app-skeleton shape="action-card" [count]="5" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .error {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-error-100);
      color: var(--color-error-700);
      font: var(--type-body);
    }
  `,
})
export class DashboardPage {
  protected readonly text = EN.studio.dashboard;
  protected readonly cards = signal<readonly DashboardCard[] | null>(null);
  protected readonly failure = signal<string | null>(null);

  private readonly studio = inject(StudioApi);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly screens = inject(CurrentScreen);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.failure.set(null);
    this.studio
      .dashboard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (counts) => this.cards.set(cardsFor(counts)),
        error: (error: unknown) =>
          this.failure.set(
            `${this.text.loadFailed} ${errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio')}`,
          ),
      });
  }

  /** The address of a card's screen, for the route walk in e2e/routes.ts. */
  protected linkOf(screen: ScreenId): string {
    return this.location.prepareExternalUrl(this.screens.urlOf(screen));
  }

  protected open(screen: ScreenId): void {
    void this.router.navigateByUrl(this.screens.urlOf(screen));
  }
}

function cardsFor(counts: DashboardCounts): readonly DashboardCard[] {
  const text = EN.studio.dashboard;
  return [
    { icon: 'inbox', label: text.uploadsWaiting(counts.uploads_waiting), screen: 'S8' },
    { icon: 'library_books', label: text.drafts(counts.drafts), screen: 'S3' },
    {
      icon: 'check_circle',
      label: text.recentlyPublished(counts.recently_published),
      screen: 'S3',
    },
    { icon: 'report', label: text.openReports(counts.open_reports), screen: 'S7' },
    { icon: 'notifications', label: text.openTickets(counts.open_tickets), screen: 'S12' },
  ];
}
