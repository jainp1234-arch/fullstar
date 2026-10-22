import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';

export type WorksheetSource = 'chapter' | 'topic';
export type WorksheetStatus = 'rendering' | 'ready' | 'failed';

export interface WorksheetSummary {
  readonly id: string;
  readonly child_id: string;
  readonly subject_id: number;
  readonly subject: 'english' | 'hindi' | 'maths' | 'evs';
  readonly subject_name: string;
  readonly source: WorksheetSource;
  readonly family_chapter_id: string | null;
  readonly topic_id: string | null;
  readonly source_title: string;
  readonly chapter_number: number | null;
  readonly question_count: number;
  readonly status: WorksheetStatus;
  /** Set on the first print (P12) or on-screen start (K6); then Shuffle again is closed. */
  readonly printed_at: string | null;
  readonly created_at: string;
}

export interface WorksheetQuestion {
  readonly position: number;
  readonly id: string;
  readonly version_id: string;
  readonly question_type: 'mcq' | 'true_false' | 'fill_blank' | 'match';
  readonly topic_id: string | null;
  readonly topic_name: string | null;
  readonly body: unknown;
  /** Only in solutions (P13) and on screen (K6). */
  readonly solution: unknown;
}

export interface WorksheetDetail {
  readonly worksheet: WorksheetSummary;
  readonly questions: readonly WorksheetQuestion[];
  readonly weak_spots: readonly string[];
}

export interface NewWorksheet {
  readonly child_id: string;
  readonly subject_id: number;
  readonly source: WorksheetSource;
  readonly family_chapter_id?: string;
  readonly topic_id?: string;
  readonly question_count: number;
}

/** ready: url is a 10-minute signed link; rendering: ask again shortly. */
export interface WorksheetPdf {
  readonly status: 'ready' | 'rendering';
  readonly url: string | null;
  readonly expires_at: string | null;
}

/** P10–P13 and K6 (Schema §11 /family/parent/worksheets; Plan 7.2). */
@Injectable({ providedIn: 'root' })
export class WorksheetApi {
  private readonly api = inject(ApiClient);

  list(childId?: string): Observable<readonly WorksheetSummary[]> {
    return this.api.get<readonly WorksheetSummary[]>(
      '/family/parent/worksheets',
      childId ? { child_id: childId } : {},
    );
  }

  create(worksheet: NewWorksheet): Observable<WorksheetDetail> {
    return this.api.post<WorksheetDetail>('/family/parent/worksheets', worksheet);
  }

  reshuffle(id: string): Observable<WorksheetDetail> {
    return this.api.post<WorksheetDetail>(
      `/family/parent/worksheets/${encodeURIComponent(id)}/reshuffle`,
      {},
    );
  }

  /** 200 ready or 202 rendering; both answer the same shape. */
  pdf(id: string): Observable<WorksheetPdf> {
    return this.api.get<WorksheetPdf>(`/family/parent/worksheets/${encodeURIComponent(id)}/pdf`);
  }

  solutions(id: string): Observable<WorksheetDetail> {
    return this.api.get<WorksheetDetail>(
      `/family/parent/worksheets/${encodeURIComponent(id)}/solutions`,
    );
  }

  weakSpots(id: string, topicIds: readonly string[]): Observable<WorksheetDetail> {
    return this.api.put<WorksheetDetail>(
      `/family/parent/worksheets/${encodeURIComponent(id)}/weak-spots`,
      { topic_ids: topicIds },
    );
  }

  onScreen(id: string): Observable<WorksheetDetail> {
    return this.api.post<WorksheetDetail>(
      `/family/kid/worksheets/${encodeURIComponent(id)}/onscreen`,
      {},
    );
  }
}
