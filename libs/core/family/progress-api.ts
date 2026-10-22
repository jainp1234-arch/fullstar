import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';

export interface SubjectProgress {
  readonly subject_id: number;
  readonly code: 'english' | 'hindi' | 'maths' | 'evs';
  readonly name: string;
  readonly chapters_done: number;
  readonly chapters_total: number;
  /** Lessons finished in the week shown. */
  readonly lessons_done: number;
}

export interface AreaToWorkOn {
  readonly topic_id: string;
  readonly name: string;
  readonly subject: SubjectProgress['code'];
  readonly score: number;
}

/** P1 This week (Schema §7 child_week_summary; Plan 6.4). Weeks start on Monday, India time. */
export interface WeekSummary {
  readonly start: string;
  readonly minutes: number;
  readonly active_days: number;
  readonly chapters_done: number;
  readonly worksheets_done: number;
  readonly areas: readonly AreaToWorkOn[];
  readonly subjects: readonly SubjectProgress[];
  /** False for a child who has not started yet: P1 shows the first-steps checklist. */
  readonly any_activity: boolean;
}

/** P2 Subject detail. */
export interface SubjectDetail {
  readonly subject_id: number;
  readonly code: SubjectProgress['code'];
  readonly name: string;
  readonly chapters: readonly { id: string; number: number; title: string; done: boolean }[];
  readonly accuracy: readonly {
    topic_id: string;
    name: string;
    correct: number;
    answered: number;
  }[];
  readonly weak_spots: readonly { topic_id: string; name: string; ticks: number }[];
}

/** Parent progress (Schema §11 /family/parent/children/{id}/week, /subjects/{id}; Plan 6.4). */
@Injectable({ providedIn: 'root' })
export class ProgressApi {
  private readonly api = inject(ApiClient);

  week(childId: string, start?: string): Observable<WeekSummary> {
    return this.api.get<WeekSummary>(
      `/family/parent/children/${encodeURIComponent(childId)}/week`,
      start ? { start } : {},
    );
  }

  subject(childId: string, subjectId: number): Observable<SubjectDetail> {
    return this.api.get<SubjectDetail>(
      `/family/parent/children/${encodeURIComponent(childId)}/subjects/${subjectId}`,
    );
  }
}
