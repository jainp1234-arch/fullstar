import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiError, SupportApi, SupportTicket } from '@fullstar/core';
import {
  Button,
  EN,
  SectionHeader,
  TextField,
  ToastService,
  errorMessage,
  fieldMessage,
} from '@fullstar/ui';

/**
 * P16 Help (App Flow §6; Plan 7.3): FAQs, the Contact us form (a support ticket) and the parent's
 * conversations with our team. Replies also arrive as messages (P19), which link here.
 */
@Component({
  selector: 'app-help-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ReactiveFormsModule, SectionHeader, TextField],
  template: `
    <app-section-header [title]="text.faqTitle" />
    <div class="faqs">
      @for (faq of text.faqs; track faq.q) {
        <details class="faq">
          <summary>{{ faq.q }}</summary>
          <p>{{ faq.a }}</p>
        </details>
      }
    </div>

    <app-section-header [title]="text.contactTitle" />
    <form class="contact" [formGroup]="form" novalidate (submit)="send($event)">
      <app-text-field
        formControlName="subject"
        [label]="text.subject"
        [maxLength]="120"
        [error]="errorOf('subject')"
      />
      <app-text-field
        formControlName="message"
        [label]="text.message"
        [rows]="5"
        [maxLength]="2000"
        [error]="errorOf('message')"
      />
      <p class="note">{{ text.contactHint }}</p>
      <app-button type="submit" [label]="text.send" [fullWidth]="true" [loading]="busy()" />
    </form>

    @if (tickets().length) {
      <app-section-header [title]="text.yourMessages" />
      <ul class="tickets" role="list">
        @for (ticket of tickets(); track ticket.id) {
          <li class="ticket">
            <div class="ticket__head">
              <strong>{{ ticket.subject }}</strong>
              <span class="note">{{ text.statuses[ticket.status] }}</span>
            </div>
            @for (m of ticket.messages; track m.id) {
              <p class="line" [class.line--team]="m.author === 'staff'">
                <span class="line__who">{{ m.author === 'staff' ? text.team : text.you }}:</span>
                {{ m.body }}
              </p>
            }
            @if (replying() === ticket.id) {
              <form
                class="contact"
                [formGroup]="replyForm"
                novalidate
                (submit)="reply($event, ticket)"
              >
                <app-text-field
                  formControlName="body"
                  [label]="text.reply"
                  [rows]="3"
                  [maxLength]="2000"
                />
                <app-button type="submit" [label]="text.sendReply" [loading]="busy()" />
              </form>
            } @else {
              <app-button
                variant="ghost"
                [label]="text.reply"
                [ariaLabel]="text.reply + ': ' + ticket.subject"
                (pressed)="replying.set(ticket.id)"
              />
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .faqs {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .faq {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }
    .faq summary {
      min-height: 48px;
      padding: var(--space-3) var(--space-4);
      box-sizing: border-box;
      font: var(--type-label);
      color: var(--color-text);
      cursor: pointer;
    }
    .faq summary:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
      border-radius: var(--radius-lg);
    }
    .faq p {
      margin: 0;
      padding: 0 var(--space-4) var(--space-4);
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .contact {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .note {
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .tickets {
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
      gap: var(--space-2);
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
    .ticket__head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--space-2);
      font: var(--type-body);
      color: var(--color-ink-heading);
    }
    .line {
      margin: 0;
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      background: var(--color-page);
      font: var(--type-body);
      color: var(--color-text);
    }
    .line--team {
      background: var(--color-primary-100);
    }
    .line__who {
      font-weight: 600;
    }
  `,
})
export class HelpPage {
  protected readonly text = EN.help;
  protected readonly form = new FormGroup({
    subject: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    message: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(2000)],
    }),
  });
  protected readonly replyForm = new FormGroup({
    body: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(2000)],
    }),
  });
  protected readonly tickets = signal<readonly SupportTicket[]>([]);
  protected readonly replying = signal<string | null>(null);
  protected readonly busy = signal(false);
  private readonly submitted = signal(false);

  private readonly api = inject(SupportApi);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.api
      .tickets()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (list) => this.tickets.set(list), error: () => undefined });
  }

  protected errorOf(field: 'subject' | 'message'): string | null {
    const control = this.form.controls[field];
    if (!(control.touched || this.submitted()) || control.valid) {
      return null;
    }
    return control.errors?.['maxlength']
      ? fieldMessage('INVALID_LENGTH')
      : fieldMessage('REQUIRED');
  }

  protected send(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.api
      .open(v.subject.trim(), v.message.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ticket) => {
          this.busy.set(false);
          this.submitted.set(false);
          this.form.reset();
          this.tickets.update((list) => [ticket, ...list]);
          this.toasts.show(this.text.sent);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected reply(event: Event, ticket: SupportTicket): void {
    event.preventDefault();
    if (this.replyForm.invalid) {
      return;
    }
    this.busy.set(true);
    this.api
      .reply(ticket.id, this.replyForm.getRawValue().body.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.replyForm.reset();
          this.replying.set(null);
          this.tickets.update((list) => list.map((t) => (t.id === updated.id ? updated : t)));
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.toasts.show(
      errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
      {
        kind: 'error',
      },
    );
  }
}
