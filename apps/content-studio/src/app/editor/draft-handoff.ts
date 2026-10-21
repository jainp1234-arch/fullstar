import { Injectable } from '@angular/core';
import { ContentLang } from '@fullstar/core';
import { ContentValue } from '@fullstar/ui';

/** A draft from S4 waiting to open in S5 for the same topic (kept in memory only). */
export interface DraftForEditor {
  readonly topicId: string;
  readonly title: string;
  readonly difficulty: number;
  readonly lang: ContentLang;
  readonly value: ContentValue;
}

/** Hands one draft from S4 Draft with AI to S5 Edit and preview; taking it clears it. */
@Injectable({ providedIn: 'root' })
export class DraftHandoff {
  private waiting: DraftForEditor | null = null;

  put(draft: DraftForEditor): void {
    this.waiting = draft;
  }

  take(topicId: string, kind: ContentValue['kind']): DraftForEditor | null {
    const draft = this.waiting;
    this.waiting = null;
    return draft && draft.topicId === topicId && draft.value.kind === kind ? draft : null;
  }
}
