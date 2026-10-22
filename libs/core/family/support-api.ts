import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ReportReason } from './message-api';

export interface SupportMessage {
  readonly id: string;
  readonly author: 'parent' | 'staff';
  readonly body: string;
  readonly created_at: string;
}

export interface SupportTicket {
  readonly id: string;
  readonly subject: string;
  readonly status: 'open' | 'answered' | 'closed';
  readonly created_at: string;
  readonly updated_at: string;
  readonly messages: readonly SupportMessage[];
}

/** P16 Contact us and P18 Report a problem (Schema §11; Plan 7.3). Replies arrive in P19. */
@Injectable({ providedIn: 'root' })
export class SupportApi {
  private readonly api = inject(ApiClient);

  report(contentItemId: string, reason: ReportReason, note?: string): Observable<unknown> {
    return this.api.post('/family/parent/problem-reports', {
      content_item_id: contentItemId,
      reason,
      ...(note ? { note } : {}),
    });
  }

  tickets(): Observable<readonly SupportTicket[]> {
    return this.api.get<readonly SupportTicket[]>('/family/parent/support-tickets');
  }

  open(subject: string, body: string): Observable<SupportTicket> {
    return this.api.post<SupportTicket>('/family/parent/support-tickets', { subject, body });
  }

  reply(ticketId: string, body: string): Observable<SupportTicket> {
    return this.api.post<SupportTicket>(
      `/family/parent/support-tickets/${encodeURIComponent(ticketId)}/messages`,
      { body },
    );
  }
}
