import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';

export type SubjectMode = 'book' | 'practice';

export interface KidSubjectTile {
  readonly subject_id: number;
  readonly code: 'english' | 'hindi' | 'maths' | 'evs';
  readonly name: string;
  /** book: a ready chapter of the child's book; practice: grade-level topics. */
  readonly mode: SubjectMode;
}

export interface ContinueCard {
  readonly attempt_id: string;
  readonly kind: 'lesson' | 'readalong';
  readonly subject_id: number;
  readonly subject: KidSubjectTile['code'];
  readonly content_item_id: string | null;
  readonly title: string | null;
  readonly family_chapter_id: string | null;
  readonly topic_id: string | null;
  readonly resume_state: unknown;
}

export interface KidHome {
  readonly child: {
    readonly id: string;
    readonly first_name: string;
    readonly class_level: number;
    readonly avatar_key: string;
  };
  readonly stars: number;
  readonly minutes_today: number;
  readonly daily_limit_minutes: number;
  readonly subjects: readonly KidSubjectTile[];
  readonly continue_card: ContinueCard | null;
}

/** A K2 row: a chapter of the book (number set) or a grade-level topic. */
export interface KidEntry {
  readonly id: string;
  readonly number: number | null;
  readonly title: string;
  readonly done: boolean;
}

export interface KidSubject {
  readonly subject_id: number;
  readonly code: KidSubjectTile['code'];
  readonly name: string;
  readonly mode: SubjectMode;
  readonly entries: readonly KidEntry[];
}

export interface KidLessonCard {
  readonly content_item_id: string;
  readonly title: string;
  readonly duration_seconds: number | null;
  readonly done: boolean;
}

/** K3: no lessons means the Watch lesson card is "Coming soon". */
export interface KidActivity {
  readonly kind: 'chapter' | 'topic';
  readonly id: string;
  readonly title: string;
  readonly number: number | null;
  readonly subject_id: number;
  readonly subject: KidSubjectTile['code'];
  readonly lessons: readonly KidLessonCard[];
  readonly read_along: boolean;
  readonly worksheet: boolean;
  /** The newest worksheet a parent made for this child and chapter or topic (K6, Plan 7.2). */
  readonly worksheet_id: string | null;
}

/** Kid mode Learn (Schema §11 /family/kid/**; Plan 6.1). X-Child-Id is added by the interceptor. */
@Injectable({ providedIn: 'root' })
export class KidApi {
  private readonly api = inject(ApiClient);

  home(): Observable<KidHome> {
    return this.api.get<KidHome>('/family/kid/home');
  }

  subject(subjectId: number): Observable<KidSubject> {
    return this.api.get<KidSubject>(`/family/kid/subjects/${subjectId}`);
  }

  chapter(familyChapterId: string): Observable<KidActivity> {
    return this.api.get<KidActivity>(`/family/kid/chapters/${encodeURIComponent(familyChapterId)}`);
  }

  topic(topicId: string): Observable<KidActivity> {
    return this.api.get<KidActivity>(`/family/kid/topics/${encodeURIComponent(topicId)}`);
  }

  lesson(contentItemId: string): Observable<KidLesson> {
    return this.api.get<KidLesson>(`/family/kid/lessons/${encodeURIComponent(contentItemId)}`);
  }

  /** childId: for parent mode (P11 picks a practice topic for that child). */
  practice(childId?: string): Observable<PracticeHome> {
    return this.api.get<PracticeHome>(
      '/family/kid/practice',
      {},
      childId ? { childId } : undefined,
    );
  }

  /** A new shuffle each time; nothing is stored, so no Idempotency-Key. */
  practiceSet(subjectId: number, topicId?: string): Observable<PracticeSet> {
    return this.api.post<PracticeSet>(
      '/family/kid/practice-sets',
      { subject_id: subjectId, kind: 'practice', ...(topicId ? { topic_id: topicId } : {}) },
      { idempotent: false },
    );
  }

  mistakes(): Observable<PracticeSet> {
    return this.api.get<PracticeSet>('/family/kid/mistakes');
  }

  readAlong(familyChapterId: string): Observable<ReadAlongChapter> {
    return this.api.get<ReadAlongChapter>(
      `/family/kid/chapters/${encodeURIComponent(familyChapterId)}/pages`,
    );
  }
}

/** A quiz question of a lesson, with its solution so the player can check answers offline. */
export interface KidQuizQuestion {
  readonly id: string;
  readonly version_id: string;
  readonly question_type: 'mcq' | 'true_false' | 'fill_blank' | 'match';
  readonly topic_id: string | null;
  readonly body: unknown;
  readonly solution: unknown;
}

/** K4 (Plan 6.2): the published version, its quiz questions and where the child left off. */
export interface KidLesson {
  readonly id: string;
  readonly version_id: string;
  readonly title: string;
  readonly lang: 'en' | 'hi';
  readonly duration_seconds: number | null;
  readonly subject_id: number;
  readonly topic_id: string | null;
  readonly catalog_chapter_id: string | null;
  /** Schema §5 lesson body; @fullstar/ui content-body.ts has the types. */
  readonly body: unknown;
  readonly questions: readonly KidQuizQuestion[];
  readonly resume: { readonly attempt_id: string; readonly resume_state: unknown } | null;
  /** Plan 8.2: the lesson's narration, null until voice-maker has made it. */
  readonly narration: LessonNarration | null;
}

/** One MP3 (signed for 10 minutes) and where each narration scene is in it. */
export interface LessonNarration {
  readonly audio_url: string;
  readonly scenes: readonly {
    readonly id: string;
    readonly start_ms: number;
    readonly end_ms: number;
  }[];
}

/** Schema §4.3 pages.word_timings. */
export interface WordTiming {
  readonly w: string;
  readonly start_ms: number;
  readonly end_ms: number;
}

export interface ReadAlongPage {
  readonly id: string;
  readonly page_no: number;
  readonly text: string;
  readonly image_url: string;
  /** null until the chapter's narration is made. */
  readonly audio_url: string | null;
  readonly word_timings: readonly WordTiming[];
}

/** K5 (Plan 6.3): signed links are valid for 10 minutes; ReadAlongCache keeps copies. */
export interface ReadAlongChapter {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly subject_id: number;
  readonly lang: 'en' | 'hi';
  readonly pages: readonly ReadAlongPage[];
  readonly resume: { readonly attempt_id: string; readonly resume_state: unknown } | null;
}

/** K8 (Plan 7.1): subjects with their question counts and topics, and open mistakes. */
export interface PracticeHome {
  readonly subjects: readonly {
    readonly subject_id: number;
    readonly code: KidSubjectTile['code'];
    readonly name: string;
    readonly questions: number;
    readonly topics: readonly {
      readonly id: string;
      readonly name: string;
      readonly questions: number;
    }[];
  }[];
  readonly mistakes: number;
}

/** K9/K11: up to 10 shuffled questions (or open mistakes) with solutions for offline checking. */
export interface PracticeSet {
  readonly kind: 'practice' | 'mistakes';
  readonly subject_id: number;
  readonly topic_id: string | null;
  readonly questions: readonly KidQuizQuestion[];
}
