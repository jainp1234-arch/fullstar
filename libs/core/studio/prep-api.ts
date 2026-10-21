import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { SubjectCode } from './content-api';

export type PrepTaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type CatalogChapterStatus = 'not_started' | 'in_progress' | 'ready';
export type CatalogBoard = 'CBSE' | 'ICSE' | 'STATE' | 'OTHER';

/** One uploaded chapter in the S8 queue. Staff see a short family reference, never who it is. */
export interface PrepTask {
  readonly id: string;
  readonly status: PrepTaskStatus;
  readonly opened_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  /** Claimed by the signed-in admin. */
  readonly mine: boolean;
  readonly assigned: boolean;
  readonly family_chapter_id: string;
  readonly family_book_id: string;
  readonly family_ref: string;
  readonly class_level: number;
  readonly subject: SubjectCode;
  readonly subject_name: string;
  readonly upload_mode: 'whole' | 'chapterwise';
  readonly chapter_number: number;
  readonly chapter_title: string;
  readonly page_count: number;
  readonly chapter_status: string;
  readonly catalog_chapter_id: string | null;
}

/** The catalog chapter a task is linked to, with what is published in it. */
export interface CatalogLink {
  readonly catalog_book_id: string;
  readonly book_title: string;
  readonly catalog_chapter_id: string;
  readonly number: number;
  readonly title: string;
  readonly status: CatalogChapterStatus;
  readonly published_lessons: number;
  readonly published_questions: number;
  /** Items still in draft or the content check. */
  readonly unpublished: number;
}

export interface PrepTaskDetail {
  readonly task: PrepTask;
  readonly catalog: CatalogLink | null;
}

export interface FamilyPage {
  readonly id: string;
  readonly page_no: number;
  readonly quality: 'ok' | 'unclear' | 'retaken';
  readonly text: string;
  /** Signed, 10 minutes. */
  readonly image_url: string;
}

export interface CatalogChapter {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly status: CatalogChapterStatus;
}

export interface CatalogBook {
  readonly id: string;
  readonly class_level: number;
  readonly subject: SubjectCode;
  readonly title: string;
  readonly board: CatalogBoard;
  readonly publisher: string | null;
  readonly edition: string | null;
  readonly chapters: readonly CatalogChapter[];
}

export interface NewCatalogBook {
  readonly class_level: number;
  readonly subject: SubjectCode;
  readonly title: string;
  readonly board?: CatalogBoard;
  readonly publisher?: string;
  readonly edition?: string;
}

/** Catalog chapters need a published lesson and this many published questions to be ready. */
export const MIN_CHAPTER_QUESTIONS = 20;

/** S8 queue and S9 preparation (Schema §11 /studio/prep-tasks, catalog; Plan 5.5). */
@Injectable({ providedIn: 'root' })
export class PrepApi {
  private readonly api = inject(ApiClient);

  tasks(statuses: readonly PrepTaskStatus[]): Observable<readonly PrepTask[]> {
    return this.api.get<readonly PrepTask[]>('/studio/prep-tasks', { status: statuses.join(',') });
  }

  task(id: string): Observable<PrepTaskDetail> {
    return this.api.get<PrepTaskDetail>(`/studio/prep-tasks/${encodeURIComponent(id)}`);
  }

  claim(id: string): Observable<PrepTask> {
    return this.api.post<PrepTask>(`/studio/prep-tasks/${encodeURIComponent(id)}/claim`, {});
  }

  link(id: string, catalogChapterId: string): Observable<PrepTaskDetail> {
    return this.api.post<PrepTaskDetail>(`/studio/prep-tasks/${encodeURIComponent(id)}/link`, {
      catalog_chapter_id: catalogChapterId,
    });
  }

  pages(familyChapterId: string): Observable<readonly FamilyPage[]> {
    return this.api.get<readonly FamilyPage[]>(
      `/studio/family-chapters/${encodeURIComponent(familyChapterId)}/pages`,
    );
  }

  books(classLevel: number, subject: SubjectCode, q: string): Observable<readonly CatalogBook[]> {
    return this.api.get<readonly CatalogBook[]>('/studio/catalog-books', {
      class: classLevel,
      subject,
      q,
    });
  }

  createBook(book: NewCatalogBook): Observable<CatalogBook> {
    return this.api.post<CatalogBook>('/studio/catalog-books', book);
  }

  createChapter(bookId: string, number: number, title: string): Observable<CatalogBook> {
    return this.api.post<CatalogBook>(
      `/studio/catalog-books/${encodeURIComponent(bookId)}/chapters`,
      { number, title },
    );
  }

  markReady(catalogChapterId: string): Observable<CatalogLink> {
    return this.api.patch<CatalogLink>(
      `/studio/catalog-chapters/${encodeURIComponent(catalogChapterId)}`,
      { status: 'ready' },
    );
  }
}
