import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';

export type ReportStatus = 'open' | 'fixed' | 'dismissed';
export type TicketStatus = 'open' | 'answered' | 'closed';

export interface ProblemReport {
  readonly id: string;
  readonly status: ReportStatus;
  readonly reason: string;
  readonly note: string | null;
  readonly created_at: string;
  readonly content_item_id: string;
  readonly kind: 'lesson' | 'question' | 'passage';
  /** The title of the version the family saw. */
  readonly title: string;
  readonly version_no: number;
  readonly family_ref: string;
  readonly handled_at: string | null;
}

export interface TicketSummary {
  readonly id: string;
  readonly subject: string;
  readonly status: TicketStatus;
  readonly family_ref: string;
  readonly updated_at: string;
  readonly last_message: string | null;
  readonly last_author: 'parent' | 'staff' | null;
}

export interface StudioTicket {
  readonly ticket: TicketSummary;
  readonly messages: readonly {
    readonly id: string;
    readonly author: 'parent' | 'staff';
    readonly body: string;
    readonly created_at: string;
  }[];
}

/** S7 problem reports and S12 support inbox (Schema §11; Plan 7.3). */
@Injectable({ providedIn: 'root' })
export class StudioSupportApi {
  private readonly api = inject(ApiClient);

  reports(status: ReportStatus): Observable<readonly ProblemReport[]> {
    return this.api.get<readonly ProblemReport[]>('/studio/problem-reports', { status });
  }

  handle(id: string, status: 'fixed' | 'dismissed'): Observable<ProblemReport> {
    return this.api.patch<ProblemReport>(`/studio/problem-reports/${encodeURIComponent(id)}`, {
      status,
    });
  }

  tickets(statuses: readonly TicketStatus[]): Observable<readonly TicketSummary[]> {
    return this.api.get<readonly TicketSummary[]>('/studio/support-tickets', {
      status: statuses.join(','),
    });
  }

  ticket(id: string): Observable<StudioTicket> {
    return this.api.get<StudioTicket>(`/studio/support-tickets/${encodeURIComponent(id)}`);
  }

  reply(id: string, body: string): Observable<StudioTicket> {
    return this.api.post<StudioTicket>(
      `/studio/support-tickets/${encodeURIComponent(id)}/messages`,
      { body },
    );
  }
}
