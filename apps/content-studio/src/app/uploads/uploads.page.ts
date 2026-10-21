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
import { ApiError, PrepApi, PrepTask } from '@fullstar/core';
import { Button, EN, Skeleton, ToastService, errorMessage } from '@fullstar/ui';

type Tab = 'waiting' | 'mine';

/**
 * S8 Uploaded books queue (App Flow §7, Schema §11 /studio/prep-tasks; Plan 5.5): chapters families
 * uploaded that are ready to read along, oldest first, with class, subject, chapter and waiting
 * time. Claim assigns one to me; Prepare opens S9.
 */
@Component({
  selector: 'app-uploads-page',
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
          [class.tab--active]="tab() === option.id"
          [attr.aria-selected]="tab() === option.id"
          (click)="tab.set(option.id)"
        >
          {{ option.label }}
        </button>
      }
    </div>
    @if (shown(); as list) {
      @if (list.length) {
        <ul class="tasks" role="list">
          @for (task of list; track task.id) {
            <li class="task">
              <div class="task__text">
                <span class="task__title">
                  {{
                    text.chapterLine(
                      task.class_level,
                      task.subject_name,
                      task.chapter_number,
                      task.chapter_title
                    )
                  }}
                </span>
                <span class="task__meta">
                  {{ text.family(task.family_ref) }} · {{ text.pages(task.page_count) }} ·
                  {{ text.waiting(minutesWaiting(task)) }}
                  @if (task.assigned && !task.mine) {
                    · {{ text.byOther }}
                  }
                </span>
              </div>
              <div class="task__actions">
                @if (task.status === 'open') {
                  <app-button
                    variant="secondary"
                    [label]="text.claim"
                    [loading]="busy() === task.id"
                    [disabled]="busy() !== null"
                    (pressed)="claim(task)"
                  />
                }
                <app-button
                  [label]="text.open"
                  [attr.data-screen-link]="linkOf(task)"
                  (pressed)="open(task)"
                />
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="note">{{ text.empty }}</p>
      }
    } @else if (failure(); as message) {
      <p class="warning" role="alert">{{ message }}</p>
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
    .intro,
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
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
    .tasks {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .task {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .task__text {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .task__title {
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .task__meta {
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .task__actions {
      display: flex;
      gap: var(--space-2);
    }
  `,
})
export class UploadsPage {
  protected readonly text = EN.studio.uploads;
  protected readonly tabs: readonly { id: Tab; label: string }[] = [
    { id: 'waiting', label: EN.studio.uploads.waitingTab },
    { id: 'mine', label: EN.studio.uploads.mineTab },
  ];
  protected readonly tab = signal<Tab>('waiting');
  protected readonly tasks = signal<readonly PrepTask[] | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly shown = computed(() => {
    const list = this.tasks();
    if (!list) {
      return null;
    }
    return list.filter((t) =>
      this.tab() === 'waiting' ? t.status === 'open' : t.status === 'in_progress',
    );
  });

  private readonly prep = inject(PrepApi);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly now = Date.now();

  constructor() {
    this.load();
  }

  protected minutesWaiting(task: PrepTask): number {
    return Math.max(0, Math.floor((this.now - Date.parse(task.opened_at)) / 60_000));
  }

  protected linkOf(task: PrepTask): string {
    return this.location.prepareExternalUrl(this.urlOf(task));
  }

  protected open(task: PrepTask): void {
    void this.router.navigateByUrl(this.urlOf(task));
  }

  protected claim(task: PrepTask): void {
    this.busy.set(task.id);
    this.prep
      .claim(task.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(null);
          this.open(task);
        },
        error: (error: unknown) => {
          this.busy.set(null);
          const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
          this.toasts.show(
            code === 'CONFLICT' ? this.text.claimedByOther : errorMessage(code, 'studio'),
            {
              kind: 'error',
            },
          );
          this.load();
        },
      });
  }

  private urlOf(task: PrepTask): string {
    return `/uploads/${encodeURIComponent(task.id)}/prepare`;
  }

  private load(): void {
    this.failure.set(null);
    this.prep
      .tasks(['open', 'in_progress'])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tasks) => this.tasks.set(tasks),
        error: (error: unknown) =>
          this.failure.set(
            `${this.text.loadFailed} ${errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio')}`,
          ),
      });
  }
}
