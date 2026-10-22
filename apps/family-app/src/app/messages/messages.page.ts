import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  ApiError,
  BookApi,
  FamilyApi,
  FamilyMessage,
  MessageApi,
  MessageLink,
  SubjectBookRow,
} from '@fullstar/core';
import { Button, EN, Skeleton, errorMessage, ErrorBar } from '@fullstar/ui';
import { Observable, forkJoin, map, of } from 'rxjs';

/** Book screens a message can lead to, by App Flow id. */
const BOOK_PAGES: Readonly<Record<string, string>> = {
  P6: 'chapters',
  P8: 'fix-pages',
  P8a: 'preview',
};

/**
 * P19 Messages (App Flow §6; Schema §4.6, §11; Plan 5.5): newest first. Opening one marks it read
 * and goes to the screen its link names (P4 books, P6 check chapters, P8 fix pages, P8a preview).
 */
@Component({
  selector: 'app-messages-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, DatePipe, ErrorBar, Skeleton],
  template: `
    @if (messages(); as list) {
      @if (list.length) {
        <ul class="list" role="list">
          @for (message of list; track message.id) {
            <li class="message" [class.message--unread]="!message.read_at">
              <div class="message__text">
                <span class="message__title">
                  @if (!message.read_at) {
                    <span class="badge">{{ text.unread }}</span>
                  }
                  {{ message.title }}
                </span>
                <span class="message__body">{{ message.body }}</span>
                <time class="message__time" [attr.datetime]="message.created_at">
                  {{ message.created_at | date: 'd MMM, h:mm a' }}
                </time>
              </div>
              <app-button
                variant="secondary"
                [label]="text.open"
                [ariaLabel]="text.open + ': ' + message.title"
                (pressed)="open(message)"
              />
            </li>
          }
        </ul>
        @if (next()) {
          <app-button variant="ghost" [label]="text.more" (pressed)="load(next())" />
        }
      } @else {
        <p class="note">{{ text.empty }}</p>
      }
    } @else if (failure(); as message) {
      <app-error-bar [message]="message" (retry)="load(null)" />
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
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .message {
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
    .message--unread {
      border-left: 4px solid var(--color-primary-600);
    }
    .message__text {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
      flex: 1 1 240px;
    }
    .message__title {
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .message__body {
      font: var(--type-body);
      color: var(--color-text);
    }
    .message__time {
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .badge {
      display: inline-block;
      margin-right: var(--space-2);
      padding: 0 var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--color-primary-100);
      font: var(--type-small);
      color: var(--color-primary-700);
    }
  `,
})
export class MessagesPage {
  protected readonly text = EN.messages;
  protected readonly messages = signal<readonly FamilyMessage[] | null>(null);
  protected readonly next = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  private readonly api = inject(MessageApi);
  private readonly family = inject(FamilyApi);
  private readonly books = inject(BookApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.load(null);
  }

  protected load(cursor: string | null): void {
    this.failure.set(null);
    this.api
      .messages(cursor ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.messages.set([...(cursor ? (this.messages() ?? []) : []), ...page.items]);
          this.next.set(page.next_cursor);
        },
        error: (error: unknown) =>
          this.failure.set(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
          ),
      });
  }

  protected open(message: FamilyMessage): void {
    const read$ = message.read_at ? of(message) : this.api.markRead(message.id);
    forkJoin([read$, this.destination(message.link)])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([read, url]) => {
          this.messages.update((list) => (list ?? []).map((m) => (m.id === read.id ? read : m)));
          if (url) {
            void this.router.navigateByUrl(url);
          }
        },
        error: (error: unknown) =>
          this.failure.set(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
          ),
      });
  }

  /** The app address of a message link; book screens need the subject, found from the child's books. */
  private destination(link: MessageLink | null): Observable<string | null> {
    if (!link) {
      return of(null);
    }
    // A reply from our team opens the conversation (Plan 7.3)
    if (link.screen === 'P16') {
      return of('/parent/settings/help');
    }
    const page = BOOK_PAGES[link.screen];
    if (link.screen !== 'P4' && !page) {
      return of(null);
    }
    const children = this.family.me()?.children ?? [];
    if (!children.length) {
      return of('/parent/books');
    }
    return forkJoin(
      children.map((child) => this.books.books(child.id).pipe(map((rows) => ({ child, rows })))),
    ).pipe(
      map((all) => {
        for (const { child, rows } of all) {
          const row = rows.find((r) => matches(r, link));
          if (row) {
            if (link.screen === 'P4') {
              return `/parent/books?child=${encodeURIComponent(child.id)}`;
            }
            const chapter = link.family_chapter_id
              ? `&chapter=${encodeURIComponent(link.family_chapter_id)}`
              : '';
            return `/parent/books/${row.subject}/${page}?child=${encodeURIComponent(child.id)}${chapter}`;
          }
        }
        return '/parent/books';
      }),
    );
  }
}

function matches(row: SubjectBookRow, link: MessageLink): boolean {
  const book = row.book;
  if (!book) {
    return false;
  }
  return (
    book.id === link.family_book_id ||
    (!!link.family_chapter_id && book.chapters.some((c) => c.id === link.family_chapter_id))
  );
}
