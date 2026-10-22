import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { KidApi, ReadAlongChapter, WordTiming } from './kid-api';

/** The word being read at ms, or -1 between words and before the first. Timings are in order. */
export function wordAt(timings: readonly WordTiming[], ms: number): number {
  let low = 0;
  let high = timings.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const word = timings[mid];
    if (ms < word.start_ms) {
      high = mid - 1;
    } else if (ms >= word.end_ms) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return -1;
}

/** A chapter ready to show: page images and audio as local object URLs. */
export interface CachedChapter {
  readonly chapter: ReadAlongChapter;
  readonly images: readonly string[];
  readonly audio: readonly (string | null)[];
  /** True when the API could not be reached and the device copy is shown. */
  readonly offline: boolean;
}

const CACHE = 'fullstar-read-along';

/**
 * Offline copy of the open read-along chapter (Plan 6.3). Opening a chapter online stores its pages,
 * images and audio in Cache Storage under stable keys (signed links expire after 10 minutes), so it
 * opens again without the internet. Object URLs are made per opening; release() frees them.
 */
@Injectable({ providedIn: 'root' })
export class ReadAlongCache {
  private readonly api = inject(KidApi);
  private urls: string[] = [];

  async open(familyChapterId: string): Promise<CachedChapter> {
    this.release();
    let chapter: ReadAlongChapter;
    let offline = false;
    try {
      chapter = await firstValueFrom(this.api.readAlong(familyChapterId));
    } catch (error) {
      const stored = await this.storedChapter(familyChapterId);
      if (!stored) {
        throw error;
      }
      chapter = stored;
      offline = true;
    }
    const cache = await openCache();
    if (!offline && cache) {
      await cache.put(chapterKey(familyChapterId), jsonResponse(chapter)).catch(() => undefined);
    }
    const images: string[] = [];
    const audio: (string | null)[] = [];
    for (const page of chapter.pages) {
      images.push(
        await this.file(
          cache,
          fileKey(familyChapterId, page.id, 'image'),
          offline ? null : page.image_url,
        ),
      );
      audio.push(
        page.audio_url || offline
          ? await this.file(
              cache,
              fileKey(familyChapterId, page.id, 'audio'),
              offline ? null : page.audio_url,
            )
          : null,
      );
    }
    return { chapter, images, audio: audio.map((url) => url || null), offline };
  }

  release(): void {
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls = [];
  }

  /** The stored copy when there is one; otherwise the network address as it is. */
  private async file(cache: Cache | null, key: string, url: string | null): Promise<string> {
    try {
      let response = cache ? await cache.match(key) : undefined;
      if (url) {
        const fresh = await fetch(url);
        if (fresh.ok) {
          response = fresh.clone();
          await cache?.put(key, fresh).catch(() => undefined);
        }
      }
      if (!response) {
        return url ?? '';
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      this.urls.push(objectUrl);
      return objectUrl;
    } catch {
      return url ?? '';
    }
  }

  /** Whether the chapter was opened online before, so it reads offline (K3 offline cards). */
  async has(familyChapterId: string): Promise<boolean> {
    return (await this.storedChapter(familyChapterId)) !== null;
  }

  private async storedChapter(familyChapterId: string): Promise<ReadAlongChapter | null> {
    try {
      const response = await (await openCache())?.match(chapterKey(familyChapterId));
      return response ? ((await response.json()) as ReadAlongChapter) : null;
    } catch {
      return null;
    }
  }
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE);
  } catch {
    return null;
  }
}

function chapterKey(id: string): string {
  return `/read-along/${encodeURIComponent(id)}/chapter.json`;
}

function fileKey(chapterId: string, pageId: string, kind: 'image' | 'audio'): string {
  return `/read-along/${encodeURIComponent(chapterId)}/${encodeURIComponent(pageId)}/${kind}`;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}
