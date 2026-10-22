import { Injectable, inject } from '@angular/core';
import { Observable, defer, from, switchMap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';

export type ReadingLang = 'en' | 'hi';
export type ReadingStatus =
  'awaiting_audio' | 'processing' | 'scored' | 'not_understood' | 'failed';

export interface ReadingPassage {
  readonly id: string;
  readonly version_id: string;
  readonly title: string;
  readonly lang: ReadingLang;
  readonly text: string;
  readonly word_count: number;
  readonly level: number;
}

export interface ReadingResult {
  readonly id: string;
  readonly test_date: string;
  readonly accuracy_pct: number;
  readonly words_per_minute: number;
  readonly words_to_practise: readonly string[];
  readonly stars: number;
}

/** K12 (Schema §11 GET /family/kid/reading; Plan 8.3). */
export interface ReadingHome {
  readonly passage: ReadingPassage | null;
  /** 1 to 3: the tree on K12. */
  readonly level: number;
  readonly tests_left_today: number;
  readonly any_tests: boolean;
  readonly last_result: ReadingResult | null;
}

export interface ReadingTest {
  readonly id: string;
  readonly status: ReadingStatus;
  readonly test_date: string;
  readonly passage_item_id: string;
  readonly title: string;
  readonly lang: ReadingLang;
  readonly accuracy_pct: number | null;
  readonly words_per_minute: number | null;
  readonly words_read: number | null;
  readonly word_count: number | null;
  readonly words_to_practise: readonly string[];
  readonly stars: number;
  readonly tests_left_today: number;
  readonly level: number;
  readonly upload: {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly expires_at: string;
  } | null;
}

/** P3 (GET /family/parent/children/{id}/reading-tests). */
export interface ReadingHistoryEntry {
  readonly id: string;
  readonly test_date: string;
  readonly title: string;
  readonly lang: ReadingLang;
  readonly status: ReadingStatus;
  readonly accuracy_pct: number | null;
  readonly words_per_minute: number | null;
  readonly words_to_practise: readonly string[];
  readonly stars: number;
  /** Signed link while the recording is kept (7 days). */
  readonly recording_url: string | null;
  readonly recording_expires_at: string | null;
}

/** The recording types the API accepts (MediaRecorder's codec, without parameters). */
export function recordingType(mime: string): 'audio/webm' | 'audio/ogg' | 'audio/mp4' | null {
  const base = mime.split(';')[0].trim();
  return base === 'audio/webm' || base === 'audio/ogg' || base === 'audio/mp4' ? base : null;
}

/** K12–K14 reading test and P3 history (Schema §11; Plan 8.3). */
@Injectable({ providedIn: 'root' })
export class ReadingApi {
  private readonly api = inject(ApiClient);

  home(): Observable<ReadingHome> {
    return this.api.get<ReadingHome>('/family/kid/reading');
  }

  /** Starts the test (the ids come from the device), uploads the recording, then queues scoring. */
  send(passageItemId: string, recording: Blob, contentType: string): Observable<ReadingTest> {
    const id = crypto.randomUUID();
    return this.api
      .post<ReadingTest>('/family/kid/reading-tests', {
        id,
        attempt_id: crypto.randomUUID(),
        passage_item_id: passageItemId,
        content_type: contentType,
        size: recording.size,
      })
      .pipe(
        switchMap((test) => from(put(test, recording))),
        switchMap(() =>
          defer(() =>
            this.api.post<ReadingTest>(
              `/family/kid/reading-tests/${encodeURIComponent(id)}/submit`,
              {},
            ),
          ),
        ),
      );
  }

  test(id: string): Observable<ReadingTest> {
    return this.api.get<ReadingTest>(`/family/kid/reading-tests/${encodeURIComponent(id)}`);
  }

  history(childId: string): Observable<readonly ReadingHistoryEntry[]> {
    return this.api.get<readonly ReadingHistoryEntry[]>(
      `/family/parent/children/${encodeURIComponent(childId)}/reading-tests`,
    );
  }
}

/** PUT to the signed storage URL: no API headers, only the signed Content-Type. */
async function put(test: ReadingTest, recording: Blob): Promise<void> {
  if (!test.upload) {
    return;
  }
  let response: Response;
  try {
    response = await fetch(test.upload.url, {
      method: test.upload.method,
      headers: test.upload.headers,
      body: recording,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach file storage');
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'UPLOAD_LIMIT', 'File storage refused the recording');
  }
}
