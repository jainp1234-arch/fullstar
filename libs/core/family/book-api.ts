import { Injectable, inject } from '@angular/core';
import { Observable, concat, concatMap, defer, from, map, switchMap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';

/** Schema §4.3 family_books.status (P4 rows). */
export type FamilyBookStatus =
  | 'getting_ready'
  | 'needs_attention'
  | 'readalong_ready'
  | 'lessons_being_prepared'
  | 'lessons_ready';

export type ChapterStatus = FamilyBookStatus | 'suggested' | 'processing';
export type UploadMode = 'whole' | 'chapterwise';
export type UploadSource = 'pdf' | 'photos';
export type UploadStatus =
  'awaiting_files' | 'scanning' | 'rejected' | 'processing' | 'processed' | 'failed';
export type RejectReason =
  'infected' | 'wrong_type' | 'too_large' | 'too_many_pages' | 'unreadable';

export interface BookChapter {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly status: ChapterStatus;
  readonly page_count: number;
  /** Pages to retake in P8. */
  readonly unclear_pages: number;
}

/** One chapter of a confirmed split (P6); start_page counts over the whole book, from 1. */
export interface SplitChapter {
  readonly number: number;
  readonly title: string;
  readonly start_page: number;
}

export type PageQuality = 'ok' | 'unclear' | 'retaken';

/** A page for P8 with a short-lived signed image link. */
export interface BookPage {
  readonly id: string;
  readonly page_no: number;
  readonly quality: PageQuality;
  readonly confidence: number;
  readonly image_url: string;
}

export interface LatestUpload {
  readonly id: string;
  readonly source: UploadSource;
  readonly status: UploadStatus;
  readonly reject_reason: RejectReason | null;
  readonly file_count: number;
}

export interface FamilyBook {
  readonly id: string;
  readonly subject_id: number;
  readonly upload_mode: UploadMode;
  readonly status: FamilyBookStatus;
  readonly class_level: number;
  /** Children who use this book (shared with a sibling in the same class). */
  readonly child_ids: readonly string[];
  readonly chapters: readonly BookChapter[];
  readonly latest_upload: LatestUpload | null;
}

/** GET /family/parent/books?child_id= (P4): one row per subject of the child's class. */
export interface SubjectBookRow {
  readonly subject_id: number;
  readonly subject: string;
  readonly subject_name: string;
  readonly book: FamilyBook | null;
}

export interface UploadRequest {
  readonly source: UploadSource;
  /** Chapterwise books: new files for an existing chapter... */
  readonly family_chapter_id?: string;
  /** ...or a new chapter (P7, B3 "Add first chapter"). */
  readonly chapter?: { readonly number: number; readonly title: string };
}

export interface SignedFile {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expires_at: string;
}

export interface BookUpload {
  readonly id: string;
  readonly family_book_id: string;
  readonly family_chapter_id: string | null;
  readonly source: UploadSource;
  readonly status: UploadStatus;
  readonly reject_reason: RejectReason | null;
  readonly file_count: number;
  readonly files: readonly SignedFile[];
}

/** Progress of BookApi.upload: files sent so far, then the completed upload. */
export type UploadProgress =
  | { readonly kind: 'sending'; readonly sent: number; readonly total: number }
  | { readonly kind: 'done'; readonly upload: BookUpload };

/** Books, chapters and uploads (Schema §11, §8.4; App Flow B3, P4–P7; Plan 5.1). */
@Injectable({ providedIn: 'root' })
export class BookApi {
  private readonly api = inject(ApiClient);

  books(childId: string): Observable<readonly SubjectBookRow[]> {
    return this.api.get<readonly SubjectBookRow[]>('/family/parent/books', { child_id: childId });
  }

  createBook(childId: string, subjectId: number, uploadMode: UploadMode): Observable<FamilyBook> {
    return this.api.post<FamilyBook>('/family/parent/books', {
      child_id: childId,
      subject_id: subjectId,
      upload_mode: uploadMode,
    });
  }

  share(bookId: string, childId: string): Observable<FamilyBook> {
    return this.api.post<FamilyBook>(`/family/parent/books/${encodeURIComponent(bookId)}/share`, {
      child_id: childId,
    });
  }

  chapters(bookId: string): Observable<readonly BookChapter[]> {
    return this.api.get<readonly BookChapter[]>(
      `/family/parent/books/${encodeURIComponent(bookId)}/chapters`,
    );
  }

  updateChapter(
    chapterId: string,
    changes: { title?: string; number?: number },
  ): Observable<BookChapter> {
    return this.api.patch<BookChapter>(
      `/family/parent/chapters/${encodeURIComponent(chapterId)}`,
      changes,
    );
  }

  deleteChapter(chapterId: string): Observable<{ readonly id: string }> {
    return this.api.delete<{ readonly id: string }>(
      `/family/parent/chapters/${encodeURIComponent(chapterId)}`,
    );
  }

  /** P6: the full ordered list of chapters with their first pages; answers the chapters. */
  confirmSplit(
    bookId: string,
    chapters: readonly SplitChapter[],
  ): Observable<readonly BookChapter[]> {
    return this.api.put<readonly BookChapter[]>(
      `/family/parent/books/${encodeURIComponent(bookId)}/chapters`,
      { chapters },
    );
  }

  /** P8: a chapter's pages, or only those of one quality. */
  pages(chapterId: string, quality?: PageQuality): Observable<readonly BookPage[]> {
    return this.api.get<readonly BookPage[]>(
      `/family/parent/chapters/${encodeURIComponent(chapterId)}/pages`,
      quality ? { quality } : {},
    );
  }

  /**
   * The whole upload: ask for signed URLs, send each file straight to storage, then complete. The
   * last value is the completed upload (scanning, or rejected with a reason).
   */
  upload(
    bookId: string,
    request: UploadRequest,
    files: readonly File[],
  ): Observable<UploadProgress> {
    return this.send(
      this.api.post<BookUpload>(`/family/parent/books/${encodeURIComponent(bookId)}/uploads`, {
        ...request,
        files: files.map(spec),
      }),
      files,
    );
  }

  /** P8: one new photo for a page; then that page alone is read again. */
  retake(pageId: string, photo: File): Observable<UploadProgress> {
    return this.send(
      this.api.post<BookUpload>(
        `/family/parent/pages/${encodeURIComponent(pageId)}/retake`,
        spec(photo),
      ),
      [photo],
    );
  }

  private send(
    created: Observable<BookUpload>,
    files: readonly File[],
  ): Observable<UploadProgress> {
    return created.pipe(
      switchMap((upload) =>
        concat(
          from(upload.files.map((signed, i) => ({ signed, i }))).pipe(
            concatMap(({ signed, i }) =>
              from(putFile(signed, files[i])).pipe(
                map((): UploadProgress => ({
                  kind: 'sending',
                  sent: i + 1,
                  total: files.length,
                })),
              ),
            ),
          ),
          defer(() =>
            this.api.post<BookUpload>(
              `/family/parent/uploads/${encodeURIComponent(upload.id)}/complete`,
              {},
            ),
          ).pipe(map((done): UploadProgress => ({ kind: 'done', upload: done }))),
        ),
      ),
    );
  }
}

function spec(file: File): { name: string; type: string; size: number } {
  return { name: file.name || 'page', type: file.type, size: file.size };
}

/** PUT to the signed storage URL: no API headers, only the signed Content-Type. */
async function putFile(signed: SignedFile, file: File): Promise<void> {
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: file,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach file storage');
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'UPLOAD_LIMIT', 'File storage refused the file');
  }
}
