import { ChapterStatus, FamilyBookStatus } from '@fullstar/core';
import { BookStatus } from '@fullstar/ui';

/** Schema §4.3 statuses as the P4 status chip (Guidelines §11 app-status-chip). */
export function chipFor(status: FamilyBookStatus | ChapterStatus | null): BookStatus {
  switch (status) {
    case null:
      return 'no-book';
    case 'needs_attention':
      return 'needs-attention';
    case 'readalong_ready':
      return 'read-along-ready';
    case 'lessons_being_prepared':
      return 'lessons-preparing';
    case 'lessons_ready':
      return 'lessons-ready';
    default:
      // getting_ready, processing, suggested
      return 'getting-ready';
  }
}
