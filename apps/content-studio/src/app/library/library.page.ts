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
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApiError,
  CLASS_LEVELS,
  ContentApi,
  ContentKind,
  ContentSummary,
  SUBJECT_CODES,
  SubjectCode,
  Topic,
} from '@fullstar/core';
import {
  Button,
  DataColumn,
  DataRowAction,
  DataTable,
  EN,
  EmptyState,
  SectionHeader,
  SelectField,
  SelectOption,
  Skeleton,
  TextField,
  ToastService,
  errorMessage,
  fieldMessage,
} from '@fullstar/ui';
import { Observable } from 'rxjs';

/** Schema §4.2 topics.name varchar(120). */
const NAME_MAX = 120;

interface TreeRow {
  readonly topic: Topic;
  readonly depth: number;
}

interface TopicForm {
  readonly mode: 'add' | 'addChild' | 'rename';
  readonly topic: Topic | null;
}

/** Depth-first order with each topic's depth, children after their parent. */
function flatten(topics: readonly Topic[]): readonly TreeRow[] {
  const children = new Map<string | null, Topic[]>();
  for (const topic of topics) {
    const key = topic.parent_id;
    children.set(key, [...(children.get(key) ?? []), topic]);
  }
  const rows: TreeRow[] = [];
  const visit = (parent: string | null, depth: number): void => {
    for (const topic of children.get(parent) ?? []) {
      rows.push({ topic, depth });
      visit(topic.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

/**
 * S3 Library (App Flow §7, Schema §11): class → subject → topic tree, topic add / rename /
 * archive, and the selected topic's lessons, questions and passages.
 */
@Component({
  selector: 'app-library-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    DataTable,
    EmptyState,
    ReactiveFormsModule,
    SectionHeader,
    SelectField,
    Skeleton,
    TextField,
  ],
  template: `
    <div class="filters">
      <app-select-field
        [formControl]="classControl"
        [label]="text.classLabel"
        [options]="classOptions"
      />
      <app-select-field
        [formControl]="subjectControl"
        [label]="text.subjectLabel"
        [options]="subjectOptions"
      />
      <app-button
        variant="secondary"
        [label]="text.draftWithAi"
        [attr.data-screen-link]="link('/library/draft')"
        (pressed)="go('/library/draft')"
      />
    </div>

    <div class="layout">
      <section class="tree" [attr.aria-label]="text.topics">
        <app-section-header [title]="text.topics" />
        @if (topics(); as list) {
          @if (rows().length) {
            <ul class="tree__list">
              @for (row of rows(); track row.topic.id) {
                <li [style.padding-left.px]="row.depth * 20">
                  <button
                    type="button"
                    class="tree__topic"
                    [class.tree__topic--selected]="row.topic.id === selectedId()"
                    [class.tree__topic--archived]="row.topic.archived"
                    [attr.aria-current]="row.topic.id === selectedId() ? 'true' : null"
                    (click)="select(row.topic.id)"
                  >
                    <span>{{ row.topic.name }}</span>
                    <span class="tree__count">
                      {{
                        row.topic.archived ? text.archived : text.itemCount(row.topic.item_count)
                      }}
                    </span>
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="note">{{ text.noTopics }}</p>
          }
        } @else if (failure(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        } @else {
          <app-skeleton shape="text" [count]="4" />
        }

        @if (form(); as current) {
          <form class="topic-form" (submit)="submitTopic($event, current)" novalidate>
            <app-text-field
              [formControl]="nameControl"
              [label]="formLabel(current)"
              [maxLength]="nameMax"
              [required]="true"
              [error]="nameError()"
            />
            <div class="row">
              <app-button
                type="submit"
                [label]="text.save"
                [loading]="busy()"
                [disabled]="busy()"
              />
              <app-button variant="ghost" [label]="text.cancel" (pressed)="form.set(null)" />
            </div>
          </form>
        } @else {
          <div class="row">
            <app-button
              variant="secondary"
              icon="add"
              [label]="text.addTopic"
              (pressed)="openForm('add', null)"
            />
            @if (selected(); as topic) {
              @if (!topic.archived) {
                <app-button
                  variant="ghost"
                  [label]="text.addSubtopic(topic.name)"
                  (pressed)="openForm('addChild', topic)"
                />
              }
              <app-button
                variant="ghost"
                [label]="text.rename(topic.name)"
                (pressed)="openForm('rename', topic)"
              />
              <app-button
                variant="ghost"
                [label]="topic.archived ? text.restore(topic.name) : text.archive(topic.name)"
                (pressed)="toggleArchived(topic)"
              />
            }
          </div>
        }
      </section>

      <section class="content" [attr.aria-label]="selected()?.name ?? text.pickTopic">
        @if (selected(); as topic) {
          <app-section-header [title]="topic.name" />
          @if (!topic.archived) {
            <div class="row">
              <app-button icon="add" [label]="text.newLesson" (pressed)="create('lesson', topic)" />
              <app-button
                variant="secondary"
                [label]="text.newQuestion"
                (pressed)="create('question', topic)"
              />
              <app-button
                variant="secondary"
                [label]="text.newPassage"
                (pressed)="create('passage', topic)"
              />
            </div>
          }
          @if (items(); as list) {
            @if (list.length) {
              <app-data-table
                [caption]="topic.name"
                [columns]="columns"
                [rows]="list"
                [rowKey]="rowKey"
                [action]="openAction"
                (rowAction)="openItem($event)"
              />
            } @else {
              <app-empty-state [title]="text.noContent" />
            }
          } @else {
            <app-skeleton shape="text" [count]="3" />
          }
        } @else {
          <p class="note">{{ text.pickTopic }}</p>
        }
      </section>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      align-items: end;
      gap: var(--space-4);
    }
    .layout {
      display: grid;
      gap: var(--space-6);
    }
    @media (min-width: 1024px) {
      .layout {
        grid-template-columns: minmax(260px, 1fr) minmax(0, 2fr);
        align-items: start;
      }
    }
    .tree,
    .content,
    .topic-form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .tree__list {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tree__topic {
      display: flex;
      justify-content: space-between;
      gap: var(--space-3);
      width: 100%;
      min-height: 48px;
      padding: 0 var(--space-3);
      border: 0;
      border-radius: var(--radius-md);
      background: transparent;
      font: var(--type-body);
      color: var(--color-text);
      text-align: left;
      align-items: center;
      cursor: pointer;
    }
    @media (hover: hover) {
      .tree__topic:hover {
        background: var(--color-primary-100);
      }
    }
    .tree__topic--selected {
      background: var(--color-primary-100);
      font-weight: 600;
    }
    .tree__topic--archived {
      color: var(--color-text-2);
    }
    .tree__topic:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
    .tree__count {
      flex: none;
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .error {
      margin: 0;
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-error-100);
      color: var(--color-error-700);
      font: var(--type-body);
    }
  `,
})
export class LibraryPage {
  protected readonly text = EN.studio.library;
  protected readonly nameMax = NAME_MAX;
  protected readonly classOptions: readonly SelectOption[] = CLASS_LEVELS.map((level) => ({
    value: String(level),
    label: EN.classLevel(level),
  }));
  protected readonly subjectOptions: readonly SelectOption[] = SUBJECT_CODES.map((code) => ({
    value: code,
    label: EN.subjects[code],
  }));
  protected readonly columns: readonly DataColumn<ContentSummary>[] = [
    { key: 'title', header: this.text.columns.title, cell: (row) => row.title },
    {
      key: 'kind',
      header: this.text.columns.kind,
      cell: (row) =>
        row.question_type ? EN.studio.questionTypes[row.question_type] : EN.studio.kinds[row.kind],
    },
    {
      key: 'status',
      header: this.text.columns.status,
      cell: (row) => EN.studio.statuses[row.status],
    },
    {
      key: 'version',
      header: this.text.columns.version,
      cell: (row) => String(row.version_no),
      align: 'end',
    },
  ];
  protected readonly openAction: DataRowAction<ContentSummary> = {
    header: this.text.columns.action,
    label: (row) => this.text.open(row.title),
  };
  protected readonly rowKey = (row: ContentSummary): string => row.id;

  protected readonly classControl = new FormControl('3', { nonNullable: true });
  protected readonly subjectControl = new FormControl<string>('english', { nonNullable: true });
  protected readonly nameControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(NAME_MAX)],
  });

  protected readonly topics = signal<readonly Topic[] | null>(null);
  protected readonly items = signal<readonly ContentSummary[] | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly form = signal<TopicForm | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly busy = signal(false);
  private readonly nameServerError = signal<string | null>(null);

  protected readonly rows = computed(() => flatten(this.topics() ?? []));
  protected readonly selected = computed(
    () => this.topics()?.find((topic) => topic.id === this.selectedId()) ?? null,
  );

  private readonly content = inject(ContentApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    const classLevel = query.get('class');
    const subject = query.get('subject');
    if (classLevel && CLASS_LEVELS.includes(Number(classLevel))) {
      this.classControl.setValue(classLevel);
    }
    if (subject && SUBJECT_CODES.includes(subject as SubjectCode)) {
      this.subjectControl.setValue(subject);
    }
    this.selectedId.set(query.get('topic'));
    this.classControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.changeFilter());
    this.subjectControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.changeFilter());
    this.loadTopics();
  }

  protected link(path: string): string {
    return this.location.prepareExternalUrl(path);
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  protected select(id: string): void {
    this.selectedId.set(id);
    this.form.set(null);
    this.remember();
    this.loadItems();
  }

  protected formLabel(form: TopicForm): string {
    if (form.mode === 'addChild' && form.topic) {
      return this.text.addSubtopic(form.topic.name);
    }
    return form.mode === 'rename' && form.topic
      ? this.text.rename(form.topic.name)
      : this.text.topicName;
  }

  protected nameError(): string | null {
    const server = this.nameServerError();
    if (server) {
      return server;
    }
    return this.nameControl.touched && this.nameControl.invalid
      ? fieldMessage(this.nameControl.errors?.['maxlength'] ? 'INVALID_LENGTH' : 'REQUIRED')
      : null;
  }

  protected openForm(mode: TopicForm['mode'], topic: Topic | null): void {
    this.nameServerError.set(null);
    this.nameControl.reset(mode === 'rename' && topic ? topic.name : '');
    this.form.set({ mode, topic });
  }

  protected submitTopic(event: Event, form: TopicForm): void {
    event.preventDefault();
    this.saveTopic(form);
  }

  private saveTopic(form: TopicForm): void {
    this.nameControl.markAsTouched();
    const name = this.nameControl.value.trim();
    if (!name || this.nameControl.invalid) {
      return;
    }
    const request: Observable<Topic> =
      form.mode === 'rename' && form.topic
        ? this.content.updateTopic(form.topic.id, { name })
        : this.content.addTopic({
            class_level: Number(this.classControl.value),
            subject: this.subjectControl.value as SubjectCode,
            parent_id: form.mode === 'addChild' ? (form.topic?.id ?? null) : null,
            name,
          });
    this.runTopic(request, () => this.form.set(null));
  }

  protected toggleArchived(topic: Topic): void {
    this.runTopic(
      this.content.updateTopic(topic.id, { archived: !topic.archived }),
      () => undefined,
    );
  }

  protected create(kind: ContentKind, topic: Topic): void {
    void this.router.navigate(['/library', 'new', 'edit'], {
      queryParams: { kind, class: topic.class_level, subject: topic.subject, topic: topic.id },
    });
  }

  protected openItem(item: ContentSummary): void {
    void this.router.navigate(['/library', item.id, 'edit']);
  }

  private runTopic(request: Observable<Topic>, done: () => void): void {
    this.busy.set(true);
    this.nameServerError.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.busy.set(false);
        const list = this.topics() ?? [];
        this.topics.set(
          list.some((topic) => topic.id === saved.id)
            ? list.map((topic) => (topic.id === saved.id ? saved : topic))
            : [...list, saved],
        );
        this.toasts.show(this.text.topicSaved);
        this.select(saved.id);
        done();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
        const field = error instanceof ApiError ? error.fields['name'] : undefined;
        this.nameServerError.set(
          code === 'CONFLICT'
            ? this.text.topicExists
            : field
              ? fieldMessage(field)
              : errorMessage(code, 'studio'),
        );
        if (!this.form()) {
          this.toasts.show(errorMessage(code, 'studio'), { kind: 'error' });
        }
      },
    });
  }

  private changeFilter(): void {
    this.selectedId.set(null);
    this.form.set(null);
    this.remember();
    this.loadTopics();
  }

  /** Keeps the place in the address, so Back from S5 returns here. */
  private remember(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        class: this.classControl.value,
        subject: this.subjectControl.value,
        topic: this.selectedId() ?? undefined,
      },
    });
  }

  private loadTopics(): void {
    this.topics.set(null);
    this.items.set(null);
    this.failure.set(null);
    this.content
      .topics(Number(this.classControl.value), this.subjectControl.value as SubjectCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (topics) => {
          this.topics.set(topics);
          if (this.selectedId() && !topics.some((topic) => topic.id === this.selectedId())) {
            this.selectedId.set(null);
          }
          this.loadItems();
        },
        error: (error: unknown) =>
          this.failure.set(
            `${this.text.loadFailed} ${errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio')}`,
          ),
      });
  }

  private loadItems(): void {
    const topicId = this.selectedId();
    this.items.set(null);
    if (!topicId) {
      return;
    }
    this.content
      .items({ topic_id: topicId, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => this.items.set(page.items),
        error: () => this.items.set([]),
      });
  }
}
