import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';

/** Schema §4.2 content_items.kind and question_type. */
export type ContentKind = 'lesson' | 'question' | 'passage';
export type QuestionType = 'mcq' | 'true_false' | 'fill_blank' | 'match';

export type SubjectCode = 'english' | 'hindi' | 'maths' | 'evs';
export type ContentStatus = 'draft' | 'in_check' | 'published' | 'archived';
export type ContentLang = 'en' | 'hi';

export const SUBJECT_CODES: readonly SubjectCode[] = ['english', 'hindi', 'maths', 'evs'];
export const CLASS_LEVELS: readonly number[] = [1, 2, 3, 4, 5];

/** GET /studio/topics (Schema §11, S3): flat; the tree is built from parent_id. */
export interface Topic {
  readonly id: string;
  readonly class_level: number;
  readonly subject: SubjectCode;
  readonly parent_id: string | null;
  readonly name: string;
  readonly sort_order: number;
  readonly archived: boolean;
  readonly item_count: number;
}

export interface NewTopic {
  readonly class_level: number;
  readonly subject: SubjectCode;
  readonly parent_id?: string | null;
  readonly name: string;
  readonly sort_order?: number;
}

export interface TopicChanges {
  readonly name?: string;
  readonly sort_order?: number;
  readonly archived?: boolean;
}

export interface ContentSummary {
  readonly id: string;
  readonly kind: ContentKind;
  readonly question_type: QuestionType | null;
  readonly class_level: number;
  readonly subject: SubjectCode;
  readonly topic_id: string | null;
  readonly difficulty: number;
  readonly lang: ContentLang;
  readonly status: ContentStatus;
  readonly current_version_id: string | null;
  readonly published_version_id: string | null;
  readonly title: string;
  readonly version_no: number;
  readonly updated_at: string;
}

/** A saved version. Only the current one can be edited (as a new version); others are read-only. */
export interface ContentVersion {
  readonly id: string;
  readonly item_id: string;
  readonly version_no: number;
  readonly title: string;
  /** Checked by the API against Schema §5; @fullstar/ui contentValue() reads it. */
  readonly body: unknown;
  readonly solution: unknown;
  readonly duration_seconds: number | null;
  readonly created_at: string;
  readonly created_by_name: string | null;
  readonly current: boolean;
  readonly published: boolean;
  readonly read_only: boolean;
}

export interface ContentVersionInfo {
  readonly id: string;
  readonly version_no: number;
  readonly title: string;
  readonly created_at: string;
  readonly created_by_name: string | null;
  readonly current: boolean;
  readonly published: boolean;
}

export interface ContentDetail {
  readonly item: ContentSummary;
  readonly current_version: ContentVersion | null;
  readonly versions: readonly ContentVersionInfo[];
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
}

export interface ContentFilter {
  readonly kind?: ContentKind;
  readonly topic_id?: string;
  readonly status?: ContentStatus;
  readonly q?: string;
  readonly class?: number;
  readonly subject?: SubjectCode;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface NewContentItem {
  readonly class_level: number;
  readonly subject: SubjectCode;
  readonly topic_id: string;
  readonly difficulty: number;
  readonly lang: ContentLang;
  readonly title: string;
  readonly kind: ContentKind;
  readonly question_type?: QuestionType;
  /** Schema §5 formats; @fullstar/ui content-body.ts has the types. */
  readonly body: unknown;
  readonly solution?: unknown;
}

/** A new version: title, body and (questions) solution. */
export interface ContentRevision {
  readonly title: string;
  readonly body: unknown;
  readonly solution?: unknown;
}

/** Topics, content items and versions (Schema §11; S3, S5). */
@Injectable({ providedIn: 'root' })
export class ContentApi {
  private readonly api = inject(ApiClient);

  topics(classLevel: number, subject: SubjectCode): Observable<readonly Topic[]> {
    return this.api.get<readonly Topic[]>('/studio/topics', { class: classLevel, subject });
  }

  addTopic(topic: NewTopic): Observable<Topic> {
    return this.api.post<Topic>('/studio/topics', topic);
  }

  updateTopic(id: string, changes: TopicChanges): Observable<Topic> {
    return this.api.patch<Topic>(`/studio/topics/${encodeURIComponent(id)}`, changes);
  }

  items(filter: ContentFilter): Observable<Page<ContentSummary>> {
    return this.api.get<Page<ContentSummary>>('/studio/content-items', { ...filter });
  }

  item(id: string): Observable<ContentDetail> {
    return this.api.get<ContentDetail>(`/studio/content-items/${encodeURIComponent(id)}`);
  }

  version(id: string): Observable<ContentVersion> {
    return this.api.get<ContentVersion>(`/studio/content-versions/${encodeURIComponent(id)}`);
  }

  create(item: NewContentItem): Observable<ContentDetail> {
    return this.api.post<ContentDetail>('/studio/content-items', item);
  }

  /** Saves a new version on top of the current one (409 CONFLICT if someone saved in between). */
  saveVersion(
    itemId: string,
    baseVersionId: string,
    revision: ContentRevision,
  ): Observable<ContentDetail> {
    return this.api.post<ContentDetail>(
      `/studio/content-items/${encodeURIComponent(itemId)}/versions`,
      { base_version_id: baseVersionId, ...revision },
    );
  }
}

export type DraftType = 'lesson' | 'question_bank' | 'passage';

/** POST /studio/ai/drafts and /studio/ai/draft-prompt (Schema §11, S4; Plan 4.3). */
export interface DraftRequest {
  readonly type: DraftType;
  readonly class_level: number;
  readonly subject: SubjectCode;
  readonly topic_id: string;
  /** Questions in a question bank, 1–30. */
  readonly count?: number;
  readonly lang?: ContentLang;
  /** A draft pasted from a Claude chat; without it the API asks Claude (FEATURE_AI_DRAFTS). */
  readonly pasted?: string;
}

/** One drafted item; errors are Schema §5 problems by field path (empty = ready to save). */
export interface DraftItem {
  readonly kind: ContentKind;
  readonly question_type: QuestionType | null;
  readonly title: string;
  readonly difficulty: number;
  readonly body: unknown;
  readonly solution: unknown;
  readonly errors: Readonly<Record<string, string>>;
}

export interface Draft {
  readonly type: DraftType;
  readonly source: 'claude' | 'pasted';
  readonly items: readonly DraftItem[];
}

export interface DraftPrompt {
  readonly system: string;
  readonly user: string;
}

/** Content drafts: never saved until the admin saves them (S4 → S5). */
@Injectable({ providedIn: 'root' })
export class DraftApi {
  private readonly api = inject(ApiClient);

  draft(request: DraftRequest): Observable<Draft> {
    return this.api.post<Draft>('/studio/ai/drafts', request, { idempotent: false });
  }

  prompt(request: DraftRequest): Observable<DraftPrompt> {
    return this.api.post<DraftPrompt>('/studio/ai/draft-prompt', request, { idempotent: false });
  }
}
