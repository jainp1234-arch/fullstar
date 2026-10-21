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
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApiError,
  CHECKLIST_ITEMS,
  CheckApi,
  CheckFlag,
  ChecklistItem,
  ContentApi,
  ContentCheck,
  ContentDetail,
  ContentSummary,
  FLAG_CATEGORIES,
  FlagCategory,
  FlagSeverity,
  StudioApi,
} from '@fullstar/core';
import {
  Button,
  DataColumn,
  DataRowAction,
  DataTable,
  DialogService,
  EN,
  EmptyState,
  FlagItem,
  IconButton,
  SectionHeader,
  SelectField,
  SelectOption,
  Skeleton,
  TextField,
  ToastService,
  errorMessage,
  fieldMessage,
} from '@fullstar/ui';
import { Subscription, filter, switchMap, takeWhile, timer } from 'rxjs';
import { AcceptDialog } from './accept-dialog';

const POLL_MS = 2000;

interface FlagForm {
  severity: FormControl<FlagSeverity>;
  category: FormControl<FlagCategory>;
  location: FormControl<string>;
  reason: FormControl<string>;
}

/**
 * S11 Content check report (App Flow §7, Schema §11, §12a; Plan 4.4). Without ?item= it lists the
 * content waiting for a check. With an item: the current version's latest check and its flags
 * (warnings can be accepted with a note), then the agent check (FEATURE_AI_CHECK) or the manual
 * checklist, and the way on to S6.
 */
@Component({
  selector: 'app-content-check-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    DataTable,
    EmptyState,
    FlagItem,
    IconButton,
    ReactiveFormsModule,
    SectionHeader,
    SelectField,
    Skeleton,
    TextField,
  ],
  template: `
    @if (!itemId()) {
      <app-section-header [title]="text.waiting" />
      @if (waiting(); as list) {
        @if (list.length) {
          <app-data-table
            [caption]="text.waiting"
            [columns]="columns"
            [rows]="list"
            [rowKey]="rowKey"
            [action]="openAction"
            (rowAction)="openItem($event)"
          />
        } @else {
          <app-empty-state [title]="text.noneWaiting" />
        }
      } @else {
        <app-skeleton shape="text" [count]="3" />
      }
    } @else if (loadFailed(); as message) {
      <app-empty-state [title]="message" />
    } @else if (detail(); as d) {
      <p class="summary">
        {{ d.item.title }} · {{ text.versionLine(d.current_version?.version_no ?? 0) }}
      </p>

      <section class="block" [attr.aria-label]="text.flagsTitle">
        @if (check(); as c) {
          <p
            class="status"
            [class.status--bad]="c.status === 'failed' || c.status === 'error'"
            role="status"
          >
            {{ text.statuses[c.status] }} · {{ text.counts(c.critical_count, c.warning_count) }} ·
            {{ c.model === 'manual' ? text.byManual : text.byAgent(c.model) }}
          </p>
          <p class="status">{{ c.publishable ? text.publishable : text.notPublishable }}</p>
          @for (flag of c.flags; track flag.id) {
            @if (flag.resolution === 'accepted') {
              <p class="accepted">
                {{ categoryLabel(flag.category) }} · {{ flag.location }}: {{ flag.reason }} ·
                {{ text.accepted(flag.resolution_note ?? '') }}
              </p>
            } @else {
              <app-flag-item
                [severity]="flag.severity"
                [category]="categoryLabel(flag.category)"
                [location]="flag.location"
                [reason]="flag.reason"
                (goTo)="goToItem()"
                (accept)="accept(flag)"
              />
            }
          }
        } @else {
          <p class="status">{{ text.noCheck }}</p>
        }
      </section>

      <div class="row">
        @if (aiCheck()) {
          <app-button
            [label]="text.runAgent"
            [loading]="busy() === 'agent' || check()?.status === 'running'"
            [disabled]="!!busy() || check()?.status === 'running'"
            (pressed)="runAgent(d)"
          />
        }
        <app-button
          variant="secondary"
          [label]="text.goToPublish"
          [attr.data-screen-link]="link('/library/' + d.item.id + '/publish')"
          (pressed)="go('/library/' + d.item.id + '/publish')"
        />
      </div>

      @if (!aiCheck()) {
        <section class="block" [attr.aria-label]="text.manualTitle">
          <app-section-header [title]="text.manualTitle" />
          <p class="note">{{ text.agentOff }} {{ text.manualIntro }}</p>
          <fieldset class="checklist" [formGroup]="checklist">
            <legend class="ui-visually-hidden">{{ text.manualTitle }}</legend>
            @for (item of checklistItems; track item) {
              <label class="tick">
                <input type="checkbox" [formControlName]="item" />
                <span>{{ text.checklist[item] }}</span>
              </label>
            }
          </fieldset>

          <h3 class="heading">{{ text.flagsTitle }}</h3>
          @for (flag of flags.controls; track flag; let i = $index) {
            <fieldset class="flag-form" [formGroup]="flag">
              <legend class="legend">{{ text.flag(i + 1) }}</legend>
              <div class="pair">
                <app-select-field
                  formControlName="severity"
                  [label]="text.severity"
                  [options]="severityOptions"
                />
                <app-select-field
                  formControlName="category"
                  [label]="text.category"
                  [options]="categoryOptions"
                />
              </div>
              <app-text-field
                formControlName="location"
                [label]="text.location"
                [maxLength]="200"
                [error]="serverError('flags[' + i + '].location')"
              />
              <app-text-field
                formControlName="reason"
                [label]="text.reason"
                [rows]="2"
                [maxLength]="500"
                [error]="serverError('flags[' + i + '].reason')"
              />
              <div class="row-end">
                <app-icon-button
                  icon="close"
                  [label]="text.removeFlag(i + 1)"
                  (pressed)="flags.removeAt(i)"
                />
              </div>
            </fieldset>
          }
          <div class="row">
            <app-button
              variant="secondary"
              icon="add"
              [label]="text.addFlag"
              (pressed)="addFlag()"
            />
            <app-button
              [label]="text.saveManual"
              [loading]="busy() === 'manual'"
              [disabled]="!!busy()"
              (pressed)="saveManual(d)"
            />
          </div>
        </section>
      }
      @if (failure(); as message) {
        <p class="failure" role="alert">{{ message }}</p>
      }
    } @else {
      <app-skeleton shape="text" [count]="4" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .block {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .summary,
    .note,
    .status,
    .accepted {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .status--bad,
    .failure {
      color: var(--color-error-700);
    }
    .failure {
      margin: 0;
      font: var(--type-small);
    }
    .accepted {
      font: var(--type-small);
    }
    .row,
    .row-end {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .row-end {
      justify-content: flex-end;
    }
    .checklist,
    .flag-form {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .legend {
      padding: 0 var(--space-2);
      font: var(--type-label);
    }
    .tick {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-height: 48px;
      font: var(--type-body);
      color: var(--color-text);
      cursor: pointer;
    }
    .tick input {
      flex: none;
      width: 24px;
      height: 24px;
      margin: 0;
      accent-color: var(--color-primary-600);
    }
    .tick input:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .heading {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .pair {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: var(--space-3);
    }
  `,
})
export class ContentCheckPage {
  protected readonly text = EN.studio.check;
  protected readonly checklistItems = CHECKLIST_ITEMS;
  protected readonly severityOptions: readonly SelectOption[] = (
    ['critical', 'warning'] as const
  ).map((severity) => ({ value: severity, label: this.text.severities[severity] }));
  protected readonly categoryOptions: readonly SelectOption[] = FLAG_CATEGORIES.map((category) => ({
    value: category,
    label: this.text.categories[category],
  }));
  protected readonly columns: readonly DataColumn<ContentSummary>[] = [
    { key: 'title', header: EN.studio.library.columns.title, cell: (row) => row.title },
    {
      key: 'kind',
      header: EN.studio.library.columns.kind,
      cell: (row) =>
        row.question_type ? EN.studio.questionTypes[row.question_type] : EN.studio.kinds[row.kind],
    },
    {
      key: 'version',
      header: EN.studio.library.columns.version,
      cell: (row) => String(row.version_no),
      align: 'end',
    },
  ];
  protected readonly openAction: DataRowAction<ContentSummary> = {
    header: EN.studio.library.columns.action,
    label: (row) => this.text.open(row.title),
  };
  protected readonly rowKey = (row: ContentSummary): string => row.id;

  protected readonly checklist = new FormGroup(
    Object.fromEntries(
      CHECKLIST_ITEMS.map((item) => [item, new FormControl(false, { nonNullable: true })]),
    ) as Record<ChecklistItem, FormControl<boolean>>,
  );
  protected readonly flags = new FormArray<FormGroup<FlagForm>>([]);

  protected readonly itemId = signal<string | null>(null);
  protected readonly waiting = signal<readonly ContentSummary[] | null>(null);
  protected readonly detail = signal<ContentDetail | null>(null);
  protected readonly check = signal<ContentCheck | null>(null);
  protected readonly busy = signal<'agent' | 'manual' | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly loadFailed = signal<string | null>(null);
  private readonly serverErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly aiCheck = computed(() => !!this.studio.me()?.features?.ai_check);

  private readonly studio = inject(StudioApi);
  private readonly content = inject(ContentApi);
  private readonly checks = inject(CheckApi);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private polling: Subscription | null = null;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      const id = query.get('item');
      this.itemId.set(id);
      this.reset();
      if (id) {
        this.loadItem(id);
      } else {
        this.loadWaiting();
      }
    });
    this.destroyRef.onDestroy(() => this.polling?.unsubscribe());
  }

  protected categoryLabel(category: FlagCategory): string {
    return this.text.categories[category];
  }

  protected serverError(path: string): string | null {
    const code = this.serverErrors()[path];
    return code ? fieldMessage(code) : null;
  }

  protected link(path: string): string {
    return this.location.prepareExternalUrl(path);
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  protected openItem(item: ContentSummary): void {
    void this.router.navigate(['/content-check'], { queryParams: { item: item.id } });
  }

  protected goToItem(): void {
    const id = this.itemId();
    if (id) {
      void this.router.navigate(['/library', id, 'edit']);
    }
  }

  protected addFlag(): void {
    this.flags.push(
      new FormGroup<FlagForm>({
        severity: new FormControl<FlagSeverity>('warning', { nonNullable: true }),
        category: new FormControl<FlagCategory>('other', { nonNullable: true }),
        location: new FormControl('', { nonNullable: true }),
        reason: new FormControl('', { nonNullable: true }),
      }),
    );
  }

  protected saveManual(detail: ContentDetail): void {
    const versionId = detail.current_version?.id;
    if (!versionId) {
      return;
    }
    this.busy.set('manual');
    this.failure.set(null);
    this.serverErrors.set({});
    const flags = this.flags.getRawValue().map((flag) => ({
      ...flag,
      location: flag.location.trim(),
      reason: flag.reason.trim(),
    }));
    this.checks
      .manualCheck(versionId, this.checklist.getRawValue(), flags)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (check) => {
          this.busy.set(null);
          this.check.set(check);
          this.flags.clear();
          this.checklist.reset();
          this.toasts.show(this.text.saved);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected runAgent(detail: ContentDetail): void {
    const versionId = detail.current_version?.id;
    if (!versionId) {
      return;
    }
    this.busy.set('agent');
    this.failure.set(null);
    this.checks
      .runAgent(versionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (check) => {
          this.busy.set(null);
          this.check.set(check);
          this.poll(check.id);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected accept(flag: CheckFlag): void {
    this.dialogs
      .open<AcceptDialog, null, string>(AcceptDialog, null)
      .pipe(
        filter((note): note is string => !!note),
        switchMap((note) => this.checks.acceptFlag(flag.id, note)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (check) => this.check.set(check),
        error: (error: unknown) => this.fail(error),
      });
  }

  /** The agent runs as a job; its result arrives a little later. */
  private poll(checkId: string): void {
    this.polling?.unsubscribe();
    this.polling = timer(POLL_MS, POLL_MS)
      .pipe(
        switchMap(() => this.checks.check(checkId)),
        takeWhile((check) => check.status === 'running', true),
      )
      .subscribe({
        next: (check) => this.check.set(check),
        error: (error: unknown) => this.fail(error),
      });
  }

  private reset(): void {
    this.polling?.unsubscribe();
    this.detail.set(null);
    this.check.set(null);
    this.waiting.set(null);
    this.failure.set(null);
    this.loadFailed.set(null);
    this.flags.clear();
    this.checklist.reset();
  }

  private loadWaiting(): void {
    this.content
      .items({ status: 'in_check', limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => this.waiting.set(page.items),
        error: () => this.waiting.set([]),
      });
  }

  private loadItem(id: string): void {
    this.content
      .item(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          const latest = detail.latest_check;
          if (latest) {
            this.checks
              .check(latest.id)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe((check) => {
                this.check.set(check);
                if (check.status === 'running') {
                  this.poll(check.id);
                }
              });
          }
        },
        error: (error: unknown) =>
          this.loadFailed.set(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio'),
          ),
      });
  }

  private fail(error: unknown): void {
    this.busy.set(null);
    if (!(error instanceof ApiError)) {
      this.failure.set(errorMessage('INTERNAL_ERROR', 'studio'));
      return;
    }
    if (error.code === 'VALIDATION_FAILED') {
      this.serverErrors.set(error.fields);
    }
    this.failure.set(
      error.code === 'CONFLICT' ? this.text.notCurrent : errorMessage(error.code, 'studio'),
    );
  }
}
