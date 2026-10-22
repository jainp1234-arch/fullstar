import { Signal, effect, inject, signal } from '@angular/core';
import { DeviceCopy, FamilySession, ReadAlongCache } from '@fullstar/core';
import { Connectivity } from '@fullstar/ui';

/** A card and where its content comes from: an API call kept on the device, or a read-along chapter. */
export interface OfflineItem {
  readonly id: string;
  readonly call?: { readonly method: 'GET' | 'POST'; readonly path: string };
  readonly readAlong?: string;
}

/**
 * App Flow §10 "No internet" (Guidelines §12; Plan 7.5): while offline, the ids of the cards whose
 * content is not on the device, shown dimmed with the cloud. Online, nothing is missing. Call in an
 * injection context (a page's field).
 */
export function offlineMissing(items: () => readonly OfflineItem[]): Signal<ReadonlySet<string>> {
  const online = inject(Connectivity).online;
  const copy = inject(DeviceCopy);
  const readAlong = inject(ReadAlongCache);
  const childId = inject(FamilySession).activeChildId;
  const missing = signal<ReadonlySet<string>>(new Set());
  let run = 0;
  effect(() => {
    const list = items();
    const child = childId();
    const current = ++run;
    if (online()) {
      missing.set(new Set());
      return;
    }
    void Promise.all(
      list.map(async (item) => {
        const kept = item.readAlong
          ? await readAlong.has(item.readAlong)
          : item.call
            ? await copy.has(item.call.method, item.call.path, child)
            : true;
        return kept ? null : item.id;
      }),
    ).then((ids) => {
      if (current === run) {
        missing.set(new Set(ids.filter((id): id is string => id !== null)));
      }
    });
  });
  return missing.asReadonly();
}
