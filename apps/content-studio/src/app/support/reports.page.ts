import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ApiError, ProblemReport, ReportStatus, StudioSupportApi } from '@fullstar/core';
import { Button, EN, Skeleton, ToastService, errorMessage } from '@fullstar/ui';

/**
 * S7 Problem reports (App Flow §7; Schema §11; Plan 7.3): reports from parents with the item, the
 * version they saw, reason and note, oldest first. Open the item (S5) to fix it, then Mark fixed
 * (the family gets a message) or Dismiss.
 */
@Component({
  selector: 'app-reports-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Skeleton],
  template: `
    <p class="intro">{{ text.intro }}</p>
    <div class="tabs" role="tablist">
      @for (option of tabs; track option.id) {
        <button
          type="button"
          role="tab"
          class="tab"
          [class.tab--active]="status() === option.id"
          [attr.aria-selected]="status() === option.id"
          (click)="show(option.id)"
        >
          {{ option.label }}
        </button>
      }
    </div>
    @if (reports(); as list) {
      @if (list.length) {
        <ul class="list" role="list">
          @for (r of list; track r.id) {
            <li class="item">
              <strong>{{ text.line(kinds[r.kind], r.title, r.version_no) }}</strong>
              <span
                >{{ reasons[r.reason] ?? r.reason }}
                @if (r.note) {
                  · “{{ r.note }}”
                }
              </span>
              <span class="meta">{{ text.from(r.family_ref, dateOf(r.created_at)) }}</span>
              <div class="actions">
                <app-button
                  variant="secondary"
                  [label]="text.openItem"
                  [ariaLabel]="text.openItem + ': ' + r.title"
                  (pressed)="openItem(r)"
                />
                @if (r.status === 'open') {
                  <app-button
                    [label]="text.fixed"
                    [ariaLabel]="text.fixed + ': ' + r.title"
                    [disabled]="busy() !== null"
                    [loading]="busy() === r.id"
                    (pressed)="handle(r, 'fixed')"
                  />
                  <app-button
                    variant="ghost"
                    [label]="text.dismiss"
                    [ariaLabel]="text.dismiss + ': ' + r.title"
                    [disabled]="busy() !== null"
                    (pressed)="handle(r, 'dismissed')"
                  />
                }
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="intro">{{ text.empty }}</p>
      }
    } @else if (failure(); as message) {
      <p class="warning" role="alert">{{ message }}</p>
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
    .intro,
    .meta {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .meta {
      font: var(--type-small);
    }
    .warning {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .tabs {
      display: flex;
      gap: var(--space-2);
    }
    .tab {
      min-height: 44px;
      padding: 0 var(--space-4);
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
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
      font: var(--type-body);
      color: var(--color-text);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-2);
    }
  `,
})
export class ReportsPage {
  protected readonly text = EN.studio.reports;
  protected readonly kinds = EN.studio.kinds as Record<string, string>;
  protected readonly reasons = EN.lessonPreview.reasons;
  protected readonly tabs: readonly { id: ReportStatus; label: string }[] = [
    { id: 'open', label: EN.studio.reports.openTab },
    { id: 'fixed', label: EN.studio.reports.fixedTab },
    { id: 'dismissed', label: EN.studio.reports.dismissedTab },
  ];
  protected readonly status = signal<ReportStatus>('open');
  protected readonly reports = signal<readonly ProblemReport[] | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);

  private readonly api = inject(StudioSupportApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.show('open');
  }

  protected show(status: ReportStatus): void {
    this.status.set(status);
    this.reports.set(null);
    this.failure.set(null);
    this.api
      .reports(status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.reports.set(list),
        error: (error: unknown) =>
          this.failure.set(
            `${this.text.loadFailed} ${errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio')}`,
          ),
      });
  }

  protected dateOf(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  protected openItem(r: ProblemReport): void {
    void this.router.navigate(['/library', r.content_item_id, 'edit']);
  }

  protected handle(r: ProblemReport, status: 'fixed' | 'dismissed'): void {
    this.busy.set(r.id);
    this.api
      .handle(r.id, status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(null);
          this.reports.update((list) => (list ?? []).filter((x) => x.id !== r.id));
          this.toasts.show(status === 'fixed' ? this.text.markedFixed : this.text.dismissed);
        },
        error: (error: unknown) => {
          this.busy.set(null);
          this.toasts.show(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio'),
            {
              kind: 'error',
            },
          );
        },
      });
  }
}
