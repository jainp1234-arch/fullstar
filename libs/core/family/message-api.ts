import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiClient } from '../api/api-client';

export type MessageKind =
  | 'readalong_ready'
  | 'pages_unclear'
  | 'lessons_ready'
  | 'upload_problem'
  | 'report_fixed'
  | 'support_reply'
  | 'system';

/** Where a message leads: an App Flow screen and the ids it needs. */
export interface MessageLink {
  readonly screen: string;
  readonly family_book_id?: string;
  readonly family_chapter_id?: string;
}

export interface FamilyMessage {
  readonly id: string;
  readonly kind: MessageKind;
  readonly title: string;
  readonly body: string;
  readonly link: MessageLink | null;
  readonly read_at: string | null;
  readonly created_at: string;
}

export interface MessagePage {
  readonly items: readonly FamilyMessage[];
  readonly next_cursor: string | null;
  readonly unread: number;
}

export type PreviewResult = 'looks_good' | 'reported';
export type ReportReason = 'wrong_answer' | 'spelling' | 'not_suitable' | 'audio_problem' | 'other';

export interface LessonCard {
  readonly content_item_id: string;
  readonly title: string;
  readonly duration_seconds: number | null;
  /** null: not previewed yet ("New · preview recommended"). */
  readonly preview_result: PreviewResult | null;
}

export interface PreviewQuestion {
  readonly id: string;
  readonly title: string;
  readonly question_type: 'mcq' | 'true_false' | 'fill_blank' | 'match';
  readonly difficulty: number;
  /** Schema §5 formats; @fullstar/ui content-body.ts has the types. */
  readonly body: unknown;
  readonly solution: unknown;
}

export interface LessonPreview {
  readonly lesson: {
    readonly id: string;
    readonly title: string;
    readonly lang: 'en' | 'hi';
    readonly duration_seconds: number | null;
    readonly body: unknown;
  };
  readonly questions: readonly PreviewQuestion[];
  readonly preview_result: PreviewResult | null;
}

/** P19 messages and P8a previews (Schema §11; Plan 5.5). unread drives the bell. */
@Injectable({ providedIn: 'root' })
export class MessageApi {
  private readonly api = inject(ApiClient);
  readonly unread = signal(0);

  messages(cursor?: string): Observable<MessagePage> {
    return this.api
      .get<MessagePage>('/family/parent/messages', cursor ? { cursor } : {})
      .pipe(tap((page) => this.unread.set(page.unread)));
  }

  markRead(id: string): Observable<FamilyMessage> {
    return this.api
      .post<FamilyMessage>(`/family/parent/messages/${encodeURIComponent(id)}/read`, {})
      .pipe(tap(() => this.unread.update((n) => Math.max(0, n - 1))));
  }

  chapterLessons(familyChapterId: string): Observable<readonly LessonCard[]> {
    return this.api.get<readonly LessonCard[]>(
      `/family/parent/chapters/${encodeURIComponent(familyChapterId)}/lessons`,
    );
  }

  preview(contentItemId: string): Observable<LessonPreview> {
    return this.api.get<LessonPreview>(
      `/family/parent/lessons/${encodeURIComponent(contentItemId)}/preview`,
    );
  }

  previewResult(
    contentItemId: string,
    result: PreviewResult,
    reason?: ReportReason,
    note?: string,
  ): Observable<LessonPreview> {
    return this.api.post<LessonPreview>(
      `/family/parent/lessons/${encodeURIComponent(contentItemId)}/preview-result`,
      { result, ...(reason ? { reason } : {}), ...(note ? { note } : {}) },
    );
  }
}
