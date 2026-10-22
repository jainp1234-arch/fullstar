import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiError, StudioSupportApi, StudioTicket, TicketSummary } from '@fullstar/core';
import { Button, EN, Skeleton, TextField, ToastService, errorMessage } from '@fullstar/ui';

/**
 * S12 Support inbox (App Flow §7; Schema §11; Plan 7.3): Contact us tickets, newest first, with
 * status. Open one to read the conversation and reply; the reply appears in the parent's messages.
 */
@Component({
  selector: 'app-support-inbox-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ReactiveFormsModule, Skeleton, TextField],
  template: `
    @if (open(); as t) {
      <app-button
        variant="ghost"
        icon="arrow_back"
        [label]="text.back"
        (pressed)="open.set(null)"
      />
      <h2 class="subject">{{ t.ticket.subject }}</h2>
      <p class="meta">
        {{ text.family(t.ticket.family_ref) }} · {{ text.statuses[t.ticket.status] }}
      </p>
      @for (m of t.messages; track m.id) {
        <p class="line" [class.line--team]="m.author === 'staff'">
          <span class="line__who">{{ m.author === 'staff' ? text.team : text.parent }}:</span>
          {{ m.body }}
        </p>
      }
      <form class="form" [formGroup]="form" novalidate (submit)="reply($event, t)">
        <app-text-field formControlName="body" [label]="text.reply" [rows]="4" [maxLength]="2000" />
        <app-button type="submit" [label]="text.send" [loading]="busy()" />
      </form>
    } @else if (tickets(); as list) {
      <p class="meta">{{ text.intro }}</p>
      @if (list.length) {
        <ul class="list" role="list">
          @for (t of list; track t.id) {
            <li>
              <button type="button" class="ticket" (click)="openTicket(t)">
                <span class="ticket__subject">{{ t.subject }}</span>
                <span class="meta"
                  >{{ text.family(t.family_ref) }} · {{ text.statuses[t.status] }}</span
                >
                @if (t.last_message) {
                  <span class="ticket__last">{{ t.last_message }}</span>
                }
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="meta">{{ text.empty }}</p>
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
    .meta {
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .warning {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .subject {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ticket {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      width: 100%;
      padding: var(--space-4);
      border: 0;
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
      text-align: start;
      cursor: pointer;
    }
    .ticket:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .ticket__subject {
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .ticket__last {
      font: var(--type-body);
      color: var(--color-text);
    }
    .line {
      margin: 0;
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      font: var(--type-body);
      color: var(--color-text);
    }
    .line--team {
      background: var(--color-primary-100);
    }
    .line__who {
      font-weight: 600;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
  `,
})
export class SupportInboxPage {
  protected readonly text = EN.studio.support;
  protected readonly tickets = signal<readonly TicketSummary[] | null>(null);
  protected readonly open = signal<StudioTicket | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly form = new FormGroup({
    body: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(2000)],
    }),
  });

  private readonly api = inject(StudioSupportApi);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.load();
  }

  protected openTicket(t: TicketSummary): void {
    this.api
      .ticket(t.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ticket) => this.open.set(ticket),
        error: (error: unknown) => this.fail(error),
      });
  }

  protected reply(event: Event, t: StudioTicket): void {
    event.preventDefault();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.api
      .reply(t.ticket.id, this.form.getRawValue().body.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.form.reset();
          this.open.set(updated);
          this.toasts.show(this.text.sent);
          this.load();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private load(): void {
    this.api
      .tickets(['open', 'answered'])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.tickets.set(list),
        error: (error: unknown) =>
          this.failure.set(
            `${this.text.loadFailed} ${errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio')}`,
          ),
      });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.toasts.show(
      errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio'),
      {
        kind: 'error',
      },
    );
  }
}
