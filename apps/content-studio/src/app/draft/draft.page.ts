import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApiError,
  CLASS_LEVELS,
  ContentApi,
  ContentLang,
  Draft,
  DraftApi,
  DraftItem,
  DraftRequest,
  DraftType,
  SUBJECT_CODES,
  StudioApi,
  SubjectCode,
  Topic,
} from '@fullstar/core';
import {
  Button,
  ContentPreview,
  ContentValue,
  EN,
  SectionHeader,
  SelectField,
  SelectOption,
  TextField,
  ToastService,
  bodyAndSolution,
  contentValue,
  errorMessage,
  fieldMessage,
} from '@fullstar/ui';
import { concatMap, from, toArray } from 'rxjs';
import { DraftHandoff } from '../editor/draft-handoff';

const DRAFT_TYPES: readonly DraftType[] = ['lesson', 'question_bank', 'passage'];
const COUNTS = [5, 10, 15, 20, 30];
const PASTE_MAX = 100_000;

interface DraftRow {
  readonly item: DraftItem;
  readonly value: ContentValue | null;
  readonly problems: readonly string[];
}

/**
 * S4 Draft with AI (App Flow §7, Schema §11, §12a; Plan 4.3): choose class, subject, topic and
 * content type; Claude drafts (FEATURE_AI_DRAFTS) or, in trial, the admin copies our prompt into a
 * Claude chat and pastes the reply. Drafts are checked against Schema §5 and open in S5; nothing is
 * saved until the admin saves.
 */
@Component({
  selector: 'app-draft-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ContentPreview, ReactiveFormsModule, SectionHeader, SelectField, TextField],
  template: `
    <p class="intro">{{ text.intro }}</p>
    @if (chapter()) {
      <p class="intro" role="status">{{ text.forChapter }}</p>
    }
    <form class="form" [formGroup]="form" novalidate (submit)="$event.preventDefault()">
      <div class="grid">
        <app-select-field
          formControlName="classLevel"
          [label]="library.classLabel"
          [options]="classOptions"
        />
        <app-select-field
          formControlName="subject"
          [label]="library.subjectLabel"
          [options]="subjectOptions"
        />
        <app-select-field
          formControlName="topicId"
          [label]="text.topic"
          [options]="topicOptions()"
          [error]="fieldErrors()['topic_id'] ? noTopicMessage() : null"
        />
        <app-select-field formControlName="type" [label]="text.type" [options]="typeOptions" />
        @if (form.controls.type.value === 'question_bank') {
          <app-select-field formControlName="count" [label]="text.count" [options]="countOptions" />
        }
        <app-select-field formControlName="lang" [label]="text.language" [options]="langOptions" />
      </div>
      @if (!topicOptions().length && topicsLoaded()) {
        <p class="note">{{ text.noTopics }}</p>
      }

      <div class="row">
        @if (aiDrafts()) {
          <app-button
            icon="add"
            [label]="text.withAi"
            [loading]="busy() === 'claude'"
            [disabled]="!!busy() || !form.controls.topicId.value"
            (pressed)="draftWithClaude()"
          />
        }
        <app-button
          variant="secondary"
          [label]="text.copyPrompt"
          [loading]="busy() === 'prompt'"
          [disabled]="!!busy() || !form.controls.topicId.value"
          (pressed)="copyPrompt()"
        />
      </div>
      @if (!aiDrafts()) {
        <p class="note">{{ text.aiOff }}</p>
      }
      @if (prompt()) {
        <app-text-field [label]="promptLabel" [rows]="8" [formControl]="promptControl" />
      }

      <app-text-field
        formControlName="pasted"
        [label]="text.paste"
        [rows]="8"
        [maxLength]="pasteMax"
        [error]="pasteError()"
      />
      <div class="row">
        <app-button
          variant="secondary"
          [label]="text.checkPaste"
          [loading]="busy() === 'paste'"
          [disabled]="
            !!busy() || !form.controls.pasted.value.trim() || !form.controls.topicId.value
          "
          (pressed)="checkPaste()"
        />
      </div>
      @if (failure(); as message) {
        <p class="failure" role="alert">{{ message }}</p>
      }
    </form>

    @if (rows(); as list) {
      <section class="result" [attr.aria-label]="text.result">
        <app-section-header [title]="text.result" />
        @if (draftType() === 'question_bank') {
          <app-button
            [label]="text.saveAll(readyCount())"
            [loading]="busy() === 'save'"
            [disabled]="!!busy() || !readyCount()"
            (pressed)="saveAll()"
          />
        }
        @for (row of list; track $index) {
          <article class="card">
            <h3 class="card__title">{{ row.item.title || text.untitled }}</h3>
            <p class="card__meta">{{ describe(row.item) }}</p>
            @if (row.problems.length) {
              <p class="card__status card__status--bad">{{ text.problems(row.problems.length) }}</p>
              <ul class="card__problems">
                @for (problem of row.problems; track problem) {
                  <li>{{ problem }}</li>
                }
              </ul>
            } @else {
              <p class="card__status">{{ text.ready }}</p>
            }
            @if (row.value; as value) {
              <app-content-preview [value]="value" [lang]="previewLang()" />
            }
            @if (row.value) {
              <app-button
                variant="secondary"
                [label]="text.openInEditor(row.item.title)"
                (pressed)="openInEditor(row)"
              />
            }
          </article>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .intro,
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .form,
    .result {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--space-4);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .failure {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .card__title {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .card__meta,
    .card__status {
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .card__status--bad {
      color: var(--color-error-700);
    }
    .card__problems {
      margin: 0;
      padding-left: var(--space-5);
      font: var(--type-small);
      color: var(--color-error-700);
    }
  `,
})
export class DraftPage {
  protected readonly text = EN.studio.draft;
  protected readonly library = EN.studio.library;
  protected readonly promptLabel = EN.studio.draft.promptLabel;
  protected readonly pasteMax = PASTE_MAX;
  protected readonly classOptions: readonly SelectOption[] = CLASS_LEVELS.map((level) => ({
    value: String(level),
    label: EN.classLevel(level),
  }));
  protected readonly subjectOptions: readonly SelectOption[] = SUBJECT_CODES.map((code) => ({
    value: code,
    label: EN.subjects[code],
  }));
  protected readonly typeOptions: readonly SelectOption[] = DRAFT_TYPES.map((type) => ({
    value: type,
    label: this.text.types[type],
  }));
  protected readonly countOptions: readonly SelectOption[] = COUNTS.map((count) => ({
    value: String(count),
    label: String(count),
  }));
  protected readonly langOptions: readonly SelectOption[] = (['en', 'hi'] as const).map((lang) => ({
    value: lang,
    label: EN.studio.languages[lang],
  }));

  protected readonly form = new FormGroup({
    classLevel: new FormControl('3', { nonNullable: true }),
    subject: new FormControl<string>('english', { nonNullable: true }),
    topicId: new FormControl('', { nonNullable: true }),
    type: new FormControl<DraftType>('lesson', { nonNullable: true }),
    count: new FormControl('10', { nonNullable: true }),
    lang: new FormControl<ContentLang>('en', { nonNullable: true }),
    pasted: new FormControl('', { nonNullable: true }),
  });
  protected readonly promptControl = new FormControl('', { nonNullable: true });

  protected readonly topics = signal<readonly Topic[]>([]);
  protected readonly topicsLoaded = signal(false);
  protected readonly prompt = signal<string | null>(null);
  /** Drafting for an uploaded chapter from S9 (Plan 5.5): Claude gets its text, saves go to its catalog chapter. */
  protected readonly chapter = signal<{
    readonly familyChapter: string;
    readonly catalogChapter: string;
    readonly task: string | null;
  } | null>(null);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly draftType = computed(() => this.draft()?.type ?? null);
  protected readonly busy = signal<'claude' | 'prompt' | 'paste' | 'save' | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly fieldErrors = signal<Readonly<Record<string, string>>>({});
  /** The place the shown draft was made for (the form may have changed since). */
  private readonly draftPlace = signal<DraftRequest | null>(null);

  protected readonly aiDrafts = computed(() => !!this.studio.me()?.features?.ai_drafts);
  protected readonly topicOptions = computed<readonly SelectOption[]>(() => {
    const byParent = new Map<string | null, Topic[]>();
    for (const topic of this.topics().filter((t) => !t.archived)) {
      byParent.set(topic.parent_id, [...(byParent.get(topic.parent_id) ?? []), topic]);
    }
    const options: SelectOption[] = [];
    const visit = (parent: string | null, depth: number): void => {
      for (const topic of byParent.get(parent) ?? []) {
        options.push({ value: topic.id, label: `${'— '.repeat(depth)}${topic.name}` });
        visit(topic.id, depth + 1);
      }
    };
    visit(null, 0);
    return options;
  });
  protected readonly rows = computed<readonly DraftRow[] | null>(() => {
    const draft = this.draft();
    return draft ? draft.items.map((item) => this.row(item)) : null;
  });
  protected readonly readyCount = computed(
    () => (this.rows() ?? []).filter((row) => !row.problems.length).length,
  );
  protected readonly previewLang = computed(() => (this.draftPlace()?.lang === 'hi' ? 'hi' : null));

  private readonly studio = inject(StudioApi);
  private readonly content = inject(ContentApi);
  private readonly drafts = inject(DraftApi);
  private readonly handoff = inject(DraftHandoff);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    const familyChapter = query.get('family_chapter');
    const catalogChapter = query.get('catalog_chapter');
    if (familyChapter && catalogChapter) {
      this.chapter.set({ familyChapter, catalogChapter, task: query.get('task') });
    }
    const type = query.get('type');
    if (type === 'lesson' || type === 'question_bank' || type === 'passage') {
      this.form.controls.type.setValue(type);
    }
    const classLevel = query.get('class');
    const subject = query.get('subject');
    if (classLevel && CLASS_LEVELS.includes(Number(classLevel))) {
      this.form.controls.classLevel.setValue(classLevel);
    }
    if (subject && SUBJECT_CODES.includes(subject as SubjectCode)) {
      this.form.controls.subject.setValue(subject);
      this.form.controls.lang.setValue(subject === 'hindi' ? 'hi' : 'en');
    }
    const wantedTopic = query.get('topic');
    this.form.controls.classLevel.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadTopics(null));
    this.form.controls.subject.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((code) => {
        this.form.controls.lang.setValue(code === 'hindi' ? 'hi' : 'en');
        this.loadTopics(null);
      });
    this.loadTopics(wantedTopic);
  }

  protected noTopicMessage(): string {
    return fieldMessage(this.fieldErrors()['topic_id'] ?? 'INVALID');
  }

  protected pasteError(): string | null {
    const code = this.fieldErrors()['pasted'] ?? this.fieldErrors()['questions'];
    return code ? fieldMessage(code) : null;
  }

  protected describe(item: DraftItem): string {
    const kind = item.question_type
      ? EN.studio.questionTypes[item.question_type]
      : EN.studio.kinds[item.kind];
    return `${kind} · ${EN.studio.difficulties[item.difficulty] ?? ''}`;
  }

  protected draftWithClaude(): void {
    this.run('claude', this.request(null));
  }

  protected checkPaste(): void {
    this.run('paste', this.request(this.form.controls.pasted.value));
  }

  protected copyPrompt(): void {
    const request = this.request(null);
    this.busy.set('prompt');
    this.failure.set(null);
    this.drafts
      .prompt(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (prompt) => {
          this.busy.set(null);
          const text = `${prompt.system}\n\n${prompt.user}`;
          this.prompt.set(text);
          this.promptControl.setValue(text);
          navigator.clipboard?.writeText(text).then(
            () => this.toasts.show(this.text.promptCopied),
            () => undefined,
          );
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected openInEditor(row: DraftRow): void {
    const place = this.draftPlace();
    if (!row.value || !place) {
      return;
    }
    this.handoff.put({
      topicId: place.topic_id,
      title: row.item.title,
      difficulty: row.item.difficulty,
      lang: place.lang ?? 'en',
      value: row.value,
    });
    void this.router.navigate(['/library', 'new', 'edit'], {
      queryParams: {
        kind: row.value.kind,
        class: place.class_level,
        subject: place.subject,
        topic: place.topic_id,
        ...(this.chapter() ? { catalog_chapter: this.chapter()?.catalogChapter } : {}),
      },
    });
  }

  protected saveAll(): void {
    const place = this.draftPlace();
    const ready = (this.rows() ?? []).filter((row) => !row.problems.length && row.value);
    if (!place || !ready.length) {
      this.toasts.show(this.text.noQuestionsReady);
      return;
    }
    this.busy.set('save');
    from(ready)
      .pipe(
        concatMap((row) =>
          this.content.create({
            class_level: place.class_level,
            subject: place.subject,
            topic_id: place.topic_id,
            difficulty: row.item.difficulty,
            lang: place.lang ?? 'en',
            title: row.item.title,
            kind: 'question',
            question_type: row.item.question_type ?? 'mcq',
            ...bodyAndSolution(row.value as ContentValue),
            ...(this.chapter() ? { catalog_chapter_id: this.chapter()?.catalogChapter } : {}),
          }),
        ),
        toArray(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (saved) => {
          this.busy.set(null);
          this.toasts.show(this.text.savedAll(saved.length));
          const task = this.chapter()?.task;
          if (task) {
            void this.router.navigate(['/uploads', task, 'prepare']);
            return;
          }
          void this.router.navigate(['/library'], {
            queryParams: {
              class: place.class_level,
              subject: place.subject,
              topic: place.topic_id,
            },
          });
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private row(item: DraftItem): DraftRow {
    const problems = Object.entries(item.errors).map(([path, code]) =>
      this.text.problem(path, fieldMessage(code)),
    );
    // Only a draft that passed every check can be previewed safely
    const value = problems.length
      ? null
      : contentValue(item.kind, item.question_type, item.body, item.solution);
    return { item, value, problems };
  }

  private request(pasted: string | null): DraftRequest {
    const form = this.form.getRawValue();
    return {
      type: form.type,
      class_level: Number(form.classLevel),
      subject: form.subject as SubjectCode,
      topic_id: form.topicId,
      lang: form.lang,
      ...(form.type === 'question_bank' ? { count: Number(form.count) } : {}),
      ...(pasted ? { pasted } : {}),
      ...(this.chapter() ? { family_chapter_id: this.chapter()?.familyChapter } : {}),
    };
  }

  private run(kind: 'claude' | 'paste', request: DraftRequest): void {
    this.busy.set(kind);
    this.failure.set(null);
    this.fieldErrors.set({});
    this.drafts
      .draft(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (draft) => {
          this.busy.set(null);
          this.draftPlace.set(request);
          this.draft.set(draft);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private loadTopics(wanted: string | null): void {
    this.topicsLoaded.set(false);
    const form = this.form.getRawValue();
    this.content
      .topics(Number(form.classLevel), form.subject as SubjectCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (topics) => {
          this.topics.set(topics);
          this.topicsLoaded.set(true);
          const options = this.topicOptions();
          const pick = options.find((option) => option.value === wanted) ?? options[0];
          this.form.controls.topicId.setValue(pick?.value ?? '');
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private fail(error: unknown): void {
    this.busy.set(null);
    const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    if (error instanceof ApiError && code === 'VALIDATION_FAILED') {
      this.fieldErrors.set(error.fields);
    }
    this.failure.set(errorMessage(code, 'studio'));
  }
}
