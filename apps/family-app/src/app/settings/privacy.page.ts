import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ApiError, FamilyApi } from '@fullstar/core';
import {
  Button,
  DialogService,
  EN,
  NoticeCard,
  SectionHeader,
  ToastService,
  errorMessage,
} from '@fullstar/ui';
import { filter, switchMap } from 'rxjs';

const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * P17 Privacy (App Flow §6): what we keep (Schema §13 facts only), a link to the full notice when
 * published, and Request data deletion, which a family can send once.
 */
@Component({
  selector: 'app-privacy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, NoticeCard, SectionHeader],
  template: `
    <app-section-header [title]="text.keepTitle" />
    <p class="body">{{ text.keep }}</p>
    <p class="body">{{ text.recordings }}</p>
    @if (noticeUrl(); as url) {
      <a class="link" [href]="url" target="_blank" rel="noopener noreferrer">{{
        text.fullNotice
      }}</a>
    }

    <app-section-header [title]="text.deletionTitle" />
    @if (requestedOn(); as date) {
      <app-notice-card
        illustration="state-wait"
        [title]="text.deletionTitle"
        [body]="text.requested(date)"
      />
    } @else {
      <p class="body">{{ text.deletion }}</p>
      <app-button
        [label]="text.request"
        variant="danger"
        [fullWidth]="true"
        [loading]="busy()"
        (pressed)="request()"
      />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .body {
      margin: 0 0 var(--space-3);
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .link {
      font: var(--type-label);
      color: var(--color-primary-600);
    }
    .link:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
  `,
})
export class PrivacyPage {
  protected readonly text = EN.privacy;
  protected readonly busy = signal(false);

  private readonly family = inject(FamilyApi);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly config = toSignal(this.family.publicConfig(), { initialValue: null });

  /** Only an https URL is linked (the API checks it too). */
  protected readonly noticeUrl = computed(() => {
    const url = this.config()?.privacy_notice_url;
    return url && url.startsWith('https://') ? url : null;
  });
  protected readonly requestedOn = computed(() => {
    const at = this.family.me()?.family.deletion_requested_at;
    return at ? DATE.format(new Date(at)) : null;
  });

  protected request(): void {
    this.dialogs
      .confirm({
        title: this.text.confirmTitle,
        body: this.text.confirmBody,
        confirmLabel: this.text.confirm,
        cancelLabel: this.text.cancel,
        danger: true,
      })
      .pipe(
        filter(Boolean),
        switchMap(() => {
          this.busy.set(true);
          return this.family.requestDeletion();
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.busy.set(false),
        error: (error: unknown) => {
          this.busy.set(false);
          this.toasts.show(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
            { kind: 'error' },
          );
        },
      });
  }
}
