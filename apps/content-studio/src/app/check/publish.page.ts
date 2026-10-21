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
import { ApiError, CheckApi, ContentApi, ContentDetail } from '@fullstar/core';
import {
  Button,
  DialogService,
  EN,
  EmptyState,
  Skeleton,
  ToastService,
  errorMessage,
} from '@fullstar/ui';
import { Observable, filter } from 'rxjs';

/**
 * S6 Publish (App Flow §7, Schema §11; Plan 4.4): publish the current version once its check has
 * passed with no open flags (the database refuses otherwise: 409 CHECK_NOT_PASSED), or unpublish.
 */
@Component({
  selector: 'app-publish-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, Skeleton],
  template: `
    @if (loadFailed(); as message) {
      <app-empty-state [title]="message" />
    } @else if (detail(); as d) {
      <p class="intro">{{ text.intro }}</p>
      <dl class="facts">
        <dt>{{ d.item.title }}</dt>
        <dd>{{ statusLabel() }}</dd>
        <dd>{{ text.current(d.current_version?.version_no ?? 0) }}</dd>
        <dd>{{ text.published(publishedNo()) }}</dd>
        <dd>
          {{ text.checkLine }}:
          {{ d.latest_check ? check.statuses[d.latest_check.status] : check.noCheck }}
          · {{ d.latest_check?.publishable ? check.publishable : check.notPublishable }}
        </dd>
      </dl>
      @if (failure(); as message) {
        <p class="failure" role="alert">{{ message }}</p>
      }
      <div class="row">
        <app-button
          [label]="text.publish"
          [loading]="busy()"
          [disabled]="busy()"
          (pressed)="publish(d)"
        />
        @if (d.item.status !== 'archived') {
          <app-button
            variant="danger"
            [label]="text.unpublish"
            [disabled]="busy()"
            (pressed)="unpublish(d)"
          />
        }
        <app-button
          variant="secondary"
          [label]="text.openCheck"
          [attr.data-screen-link]="link('/content-check')"
          (pressed)="openCheck(d)"
        />
      </div>
    } @else {
      <app-skeleton shape="text" [count]="4" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .intro {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .facts {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      margin: 0;
      font: var(--type-body);
      color: var(--color-text);
    }
    .facts dt {
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .facts dd {
      margin: 0;
    }
    .failure {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
  `,
})
export class PublishPage {
  protected readonly text = EN.studio.publish;
  protected readonly check = EN.studio.check;
  protected readonly detail = signal<ContentDetail | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly loadFailed = signal<string | null>(null);
  protected readonly statusLabel = computed(() => {
    const status = this.detail()?.item.status;
    return status ? EN.studio.statuses[status] : '';
  });
  protected readonly publishedNo = computed(() => {
    const detail = this.detail();
    const id = detail?.item.published_version_id;
    return id ? (detail?.versions.find((v) => v.id === id)?.version_no ?? null) : null;
  });

  private readonly content = inject(ContentApi);
  private readonly checks = inject(CheckApi);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.content
        .item(params.get('contentId') ?? '')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (detail) => this.detail.set(detail),
          error: (error: unknown) =>
            this.loadFailed.set(
              errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio'),
            ),
        });
    });
  }

  protected link(path: string): string {
    return this.location.prepareExternalUrl(path);
  }

  protected openCheck(detail: ContentDetail): void {
    void this.router.navigate(['/content-check'], { queryParams: { item: detail.item.id } });
  }

  protected publish(detail: ContentDetail): void {
    this.run(this.checks.publish(detail.item.id), this.text.done);
  }

  protected unpublish(detail: ContentDetail): void {
    this.dialogs
      .confirm({
        title: this.text.unpublishTitle,
        body: this.text.unpublishBody,
        confirmLabel: this.text.unpublish,
        cancelLabel: this.text.keep,
        danger: true,
      })
      .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.run(this.checks.unpublish(detail.item.id), this.text.undone));
  }

  private run(request: Observable<ContentDetail>, done: string): void {
    this.busy.set(true);
    this.failure.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (detail) => {
        this.busy.set(false);
        this.detail.set(detail);
        this.toasts.show(done);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.failure.set(
          errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio'),
        );
      },
    });
  }
}
