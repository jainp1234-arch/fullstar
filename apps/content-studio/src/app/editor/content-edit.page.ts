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
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApiError,
  ContentApi,
  ContentDetail,
  ContentKind,
  ContentLang,
  ContentVersion,
  QuestionType,
  SUBJECT_CODES,
  SubjectCode,
} from '@fullstar/core';
import {
  Button,
  ContentPreview,
  ContentValue,
  EN,
  EmptyState,
  LessonBody,
  PassageBody,
  QuestionContent,
  SelectField,
  SelectOption,
  Skeleton,
  TextField,
  ToastService,
  bodyAndSolution,
  contentValue,
  errorMessage,
  fieldMessage,
} from '@fullstar/ui';
import { DraftHandoff } from './draft-handoff';
import { FieldErrors } from './editor-shared';
import { LessonEditor } from './lesson-editor';
import { PassageEditor } from './passage-editor';
import { QuestionEditor } from './question-editor';

/** Schema §4.2 content_versions.title varchar(200). */
const TITLE_MAX = 200;
const QUESTION_TYPES: readonly QuestionType[] = ['mcq', 'true_false', 'fill_blank', 'match'];

/** Where a new item goes, from the S3 query string. */
interface NewItemPlace {
  readonly kind: ContentKind;
  readonly classLevel: number;
  readonly subject: SubjectCode;
  readonly topicId: string;
}

/** Empty but well-formed content to start a new item from. */
function starter(kind: ContentKind, type: QuestionType): ContentValue {
  switch (kind) {
    case 'lesson':
      return { kind, body: { scenes: [{ id: 's1', duration_ms: 5000, text: '', visual: null }] } };
    case 'passage':
      return { kind, body: { text: '', word_count: 0, level: 1 } };
    case 'question':
      return { kind, ...starterQuestion(type) };
  }
}

function starterQuestion(type: QuestionType): QuestionContent {
  switch (type) {
    case 'mcq':
      return {
        type,
        body: {
          prompt: '',
          image_key: null,
          options: [
            { id: 'a', text: '' },
            { id: 'b', text: '' },
          ],
        },
        solution: { correct: ['a'], explanation: '' },
      };
    case 'true_false':
      return { type, body: { prompt: '' }, solution: { correct: true, explanation: '' } };
    case 'fill_blank':
      return {
        type,
        body: { prompt: '', choices: ['', ''] },
        solution: { correct: '', explanation: '' },
      };
    case 'match':
      return {
        type,
        body: {
          prompt: '',
          left: [
            { id: 'l1', text: '' },
            { id: 'l2', text: '' },
          ],
          right: [
            { id: 'r1', text: '' },
            { id: 'r2', text: '' },
          ],
        },
        solution: {
          pairs: [
            ['l1', 'r1'],
            ['l2', 'r2'],
          ],
          explanation: '',
        },
      };
  }
}

/**
 * S5 Edit and preview (App Flow §7, Schema §5, §11): edit a lesson, question or passage beside a
 * kid-mode preview. Every save is a new version; earlier versions open read-only.
 */
@Component({
  selector: 'app-content-edit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    ContentPreview,
    EmptyState,
    LessonEditor,
    PassageEditor,
    QuestionEditor,
    ReactiveFormsModule,
    SelectField,
    Skeleton,
    TextField,
  ],
  template: `
    @if (loadFailed(); as message) {
      <app-empty-state [title]="message" />
    } @else if (source(); as current) {
      <div class="layout">
        <section class="edit" [attr.aria-label]="text.details">
          @if (viewing(); as old) {
            <div class="notice" role="status">
              <span>{{ text.viewing(old.version_no) }}</span>
              <app-button variant="ghost" [label]="text.backToCurrent" (pressed)="showCurrent()" />
            </div>
          }
          <p class="summary">{{ summary() }}</p>
          <form class="meta" [formGroup]="meta" (ngSubmit)="save()" novalidate>
            <app-text-field
              formControlName="title"
              [label]="text.title"
              [maxLength]="titleMax"
              [lang]="lang()"
              [required]="true"
              [error]="metaError('title')"
            />
            @if (isNew()) {
              <div class="pair">
                @if (current.kind === 'question') {
                  <app-select-field
                    formControlName="questionType"
                    [label]="text.questionType"
                    [options]="typeOptions"
                  />
                }
                <app-select-field
                  formControlName="difficulty"
                  [label]="text.difficulty"
                  [options]="difficultyOptions"
                />
                <app-select-field
                  formControlName="lang"
                  [label]="text.language"
                  [options]="langOptions"
                />
              </div>
            }
          </form>

          @switch (current.kind) {
            @case ('lesson') {
              <app-lesson-editor
                [value]="lessonBody(current)"
                [readOnly]="readOnly()"
                [errors]="errors()"
                [lang]="lang()"
                (changed)="edit({ kind: 'lesson', body: $event })"
              />
            }
            @case ('passage') {
              <app-passage-editor
                [value]="passageBody(current)"
                [readOnly]="readOnly()"
                [errors]="errors()"
                [lang]="lang()"
                (changed)="edit({ kind: 'passage', body: $event })"
              />
            }
            @case ('question') {
              <app-question-editor
                [value]="question(current)"
                [readOnly]="readOnly()"
                [errors]="errors()"
                [lang]="lang()"
                (changed)="edit({ kind: 'question', ...$event })"
              />
            }
          }

          @if (failure(); as message) {
            <p class="failure" role="alert">{{ message }}</p>
          }
          <div class="actions">
            <app-button
              [label]="isNew() ? text.create : text.save"
              [loading]="busy()"
              [disabled]="busy() || readOnly()"
              (pressed)="save()"
            />
            @if (detail()) {
              <app-button
                variant="secondary"
                [label]="text.sendToCheck"
                [attr.data-screen-link]="link('/content-check')"
                (pressed)="openCheck()"
              />
              <app-button
                variant="secondary"
                [label]="text.publish"
                [attr.data-screen-link]="link(publishPath())"
                (pressed)="go(publishPath())"
              />
            }
          </div>

          @if (detail(); as d) {
            <h2 class="heading">{{ text.versions }}</h2>
            <ul class="versions">
              @for (version of d.versions; track version.id) {
                <li>
                  <app-button
                    variant="ghost"
                    [label]="
                      versionLabel(version.version_no, version.created_by_name, version.created_at)
                    "
                    (pressed)="open(version.id, version.current)"
                  />
                  @if (version.current) {
                    <span class="tag">{{ text.currentTag }}</span>
                  }
                  @if (version.published) {
                    <span class="tag tag--published">{{ text.publishedTag }}</span>
                  }
                </li>
              }
            </ul>
          }
        </section>

        <section class="preview" [attr.aria-label]="text.preview">
          <h2 class="heading">{{ text.preview }}</h2>
          <app-content-preview [value]="value() ?? current" [lang]="lang()" />
        </section>
      </div>
    } @else {
      <app-skeleton shape="text" [count]="6" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .layout {
      display: grid;
      gap: var(--space-6);
    }
    @media (min-width: 1024px) {
      .layout {
        grid-template-columns: minmax(0, 3fr) minmax(320px, 2fr);
        align-items: start;
      }
      .preview {
        position: sticky;
        top: var(--space-4);
      }
    }
    .edit,
    .preview,
    .meta {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .pair {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: var(--space-3);
    }
    .summary {
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .notice {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-primary-100);
      font: var(--type-body);
      color: var(--color-text);
    }
    .failure {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .heading {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .versions {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .versions li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .tag {
      padding: 2px var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--color-primary-100);
      font: var(--type-caption);
      color: var(--color-text);
    }
    .tag--published {
      background: var(--color-success-100, var(--color-primary-100));
    }
  `,
})
export class ContentEditPage {
  protected readonly text = EN.studio.editor;
  protected readonly titleMax = TITLE_MAX;
  protected readonly typeOptions: readonly SelectOption[] = QUESTION_TYPES.map((type) => ({
    value: type,
    label: EN.studio.questionTypes[type],
  }));
  protected readonly difficultyOptions: readonly SelectOption[] = [1, 2, 3].map((level) => ({
    value: String(level),
    label: EN.studio.difficulties[level],
  }));
  protected readonly langOptions: readonly SelectOption[] = (['en', 'hi'] as const).map((lang) => ({
    value: lang,
    label: EN.studio.languages[lang],
  }));

  protected readonly detail = signal<ContentDetail | null>(null);
  /** An older version being looked at (read-only). */
  protected readonly viewing = signal<ContentVersion | null>(null);
  /** What the editors load: changes only when a version, a new item or a question type opens. */
  protected readonly source = signal<ContentValue | null>(null);
  /** The edited content, for the preview and Save. */
  protected readonly value = signal<ContentValue | null>(null);
  protected readonly errors = signal<FieldErrors>({});
  protected readonly failure = signal<string | null>(null);
  protected readonly loadFailed = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly place = signal<NewItemPlace | null>(null);

  protected readonly meta = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(TITLE_MAX)],
    }),
    questionType: new FormControl<QuestionType>('mcq', { nonNullable: true }),
    difficulty: new FormControl('2', { nonNullable: true }),
    lang: new FormControl<ContentLang>('en', { nonNullable: true }),
  });
  private readonly metaValue = signal(this.meta.getRawValue());

  protected readonly isNew = computed(() => !this.detail());
  protected readonly readOnly = computed(() => !!this.viewing());
  protected readonly lang = computed(() => {
    const lang = this.detail()?.item.lang ?? this.metaValue().lang;
    return lang === 'hi' ? 'hi' : null;
  });
  protected readonly summary = computed(() => {
    const item = this.detail()?.item;
    const place = this.place();
    const kind = item?.kind ?? place?.kind;
    if (!kind) {
      return '';
    }
    const parts = [
      EN.studio.kinds[kind],
      item?.question_type ? EN.studio.questionTypes[item.question_type] : null,
      EN.classLevel(item?.class_level ?? place?.classLevel ?? 1),
      EN.subjects[item?.subject ?? place?.subject ?? 'english'],
      item ? EN.studio.statuses[item.status] : null,
    ];
    return parts.filter(Boolean).join(' · ');
  });
  protected readonly publishPath = computed(
    () => `/library/${this.detail()?.item.id ?? 'sample'}/publish`,
  );

  private readonly content = inject(ContentApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toasts = inject(ToastService);
  private readonly handoff = inject(DraftHandoff);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.meta.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const before = this.metaValue().questionType;
      this.metaValue.set(this.meta.getRawValue());
      const value = this.value();
      // A new question of another type starts from that type's empty form
      if (
        this.isNew() &&
        value?.kind === 'question' &&
        before !== this.meta.controls.questionType.value
      ) {
        this.openContent(starter('question', this.meta.controls.questionType.value));
        this.errors.set({});
      }
    });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('contentId') ?? '';
      if (id === 'new') {
        this.startNew();
      } else {
        this.load(id);
      }
    });
  }

  protected lessonBody(value: ContentValue): LessonBody {
    return value.kind === 'lesson' ? value.body : { scenes: [] };
  }

  protected passageBody(value: ContentValue): PassageBody {
    return value.kind === 'passage' ? value.body : { text: '', word_count: 0, level: 1 };
  }

  protected question(value: ContentValue): QuestionContent {
    return value.kind === 'question' ? value : starterQuestion('mcq');
  }

  protected edit(value: ContentValue): void {
    this.value.set(value);
  }

  protected metaError(name: 'title'): string | null {
    const server = this.errors()[name];
    if (server) {
      return fieldMessage(server);
    }
    const control = this.meta.controls[name];
    return control.touched && control.invalid ? fieldMessage('REQUIRED') : null;
  }

  protected versionLabel(no: number, by: string | null, at: string): string {
    return this.text.versionLabel(no, by, new Date(at).toLocaleDateString('en-IN'));
  }

  protected link(path: string): string {
    return this.location.prepareExternalUrl(path);
  }

  /** S11 for this item. */
  protected openCheck(): void {
    const id = this.detail()?.item.id;
    void this.router.navigate(['/content-check'], { queryParams: id ? { item: id } : {} });
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  protected open(versionId: string, current: boolean): void {
    if (current) {
      this.showCurrent();
      return;
    }
    this.content
      .version(versionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (version) => {
          const item = this.detail()?.item;
          if (!item) {
            return;
          }
          this.viewing.set(version);
          this.errors.set({});
          this.meta.controls.title.setValue(version.title, { emitEvent: false });
          this.meta.controls.title.disable({ emitEvent: false });
          this.openContent(
            contentValue(item.kind, item.question_type, version.body, version.solution),
          );
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected showCurrent(): void {
    const detail = this.detail();
    if (detail) {
      this.show(detail);
    }
  }

  protected save(): void {
    const value = this.value();
    if (!value || this.readOnly()) {
      return;
    }
    this.meta.markAllAsTouched();
    this.failure.set(null);
    this.errors.set({});
    if (this.meta.invalid) {
      return;
    }
    const meta = this.meta.getRawValue();
    const detail = this.detail();
    const title = meta.title.trim();
    const request = detail
      ? this.content.saveVersion(detail.item.id, detail.current_version?.id ?? '', {
          title,
          ...bodyAndSolution(value),
        })
      : this.createRequest(title, value);
    if (!request) {
      return;
    }
    this.busy.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.busy.set(false);
        const version = saved.current_version?.version_no ?? 1;
        this.toasts.show(detail ? this.text.saved(version) : this.text.created);
        if (!detail) {
          void this.router.navigate(['/library', saved.item.id, 'edit'], { replaceUrl: true });
        }
        this.show(saved);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  private createRequest(title: string, value: ContentValue) {
    const place = this.place();
    if (!place) {
      return null;
    }
    const meta = this.meta.getRawValue();
    return this.content.create({
      class_level: place.classLevel,
      subject: place.subject,
      topic_id: place.topicId,
      difficulty: Number(meta.difficulty),
      lang: meta.lang,
      title,
      kind: value.kind,
      ...(value.kind === 'question' ? { question_type: value.type } : {}),
      ...bodyAndSolution(value),
    });
  }

  private startNew(): void {
    const query = this.route.snapshot.queryParamMap;
    const kind = query.get('kind');
    const subject = query.get('subject');
    const classLevel = Number(query.get('class'));
    const topicId = query.get('topic');
    if (
      (kind !== 'lesson' && kind !== 'question' && kind !== 'passage') ||
      !SUBJECT_CODES.includes(subject as SubjectCode) ||
      !(classLevel >= 1 && classLevel <= 5) ||
      !topicId
    ) {
      this.loadFailed.set(EN.studio.library.pickTopic);
      return;
    }
    this.detail.set(null);
    this.viewing.set(null);
    this.place.set({ kind, classLevel, subject: subject as SubjectCode, topicId });
    // A draft from S4 for this topic opens instead of the empty form
    const draft = this.handoff.take(topicId, kind);
    const value = draft?.value ?? starter(kind, 'mcq');
    this.meta.reset(
      {
        title: draft?.title ?? '',
        questionType: value.kind === 'question' ? value.type : 'mcq',
        difficulty: String(draft?.difficulty ?? 2),
        lang: draft?.lang ?? (subject === 'hindi' ? 'hi' : 'en'),
      },
      { emitEvent: false },
    );
    this.metaValue.set(this.meta.getRawValue());
    this.meta.enable({ emitEvent: false });
    this.openContent(value);
  }

  private load(id: string): void {
    this.content
      .item(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => this.show(detail),
        error: (error: unknown) =>
          this.loadFailed.set(
            `${this.text.loadFailed} ${errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio')}`,
          ),
      });
  }

  private show(detail: ContentDetail): void {
    this.detail.set(detail);
    this.viewing.set(null);
    this.errors.set({});
    const version = detail.current_version;
    this.meta.controls.title.enable({ emitEvent: false });
    this.meta.controls.title.setValue(version?.title ?? '', { emitEvent: false });
    if (version) {
      this.openContent(
        contentValue(detail.item.kind, detail.item.question_type, version.body, version.solution),
      );
    }
  }

  /** Opens content in the editors and the preview. */
  private openContent(value: ContentValue): void {
    this.source.set(value);
    this.value.set(value);
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    if (!(error instanceof ApiError)) {
      this.failure.set(errorMessage('INTERNAL_ERROR', 'studio'));
      return;
    }
    if (error.code === 'VALIDATION_FAILED') {
      this.errors.set(error.fields);
      this.failure.set(this.text.invalid);
      return;
    }
    this.failure.set(
      error.code === 'CONFLICT' ? this.text.staleVersion : errorMessage(error.code, 'studio'),
    );
  }
}
