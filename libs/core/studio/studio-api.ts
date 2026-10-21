import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiClient } from '../api/api-client';

export type StaffRole = 'content_admin' | 'super_admin';

/** GET /studio/me (Schema §11). */
export interface StaffProfile {
  readonly id: string;
  readonly display_name: string;
  readonly role: StaffRole;
}

/** GET /studio/dashboard (Schema §11, S2). */
export interface DashboardCounts {
  readonly uploads_waiting: number;
  readonly drafts: number;
  /** Published in the last 7 days. */
  readonly recently_published: number;
  readonly open_reports: number;
  readonly open_tickets: number;
}

/** A row of GET /studio/staff (super admin, S13). */
export interface StaffMember {
  readonly id: string;
  readonly display_name: string;
  readonly role: StaffRole;
  readonly active: boolean;
  readonly created_at: string;
}

export interface NewStaffMember {
  readonly email: string;
  readonly display_name: string;
  readonly role: StaffRole;
}

/** PATCH /studio/staff/{id}: absent fields stay unchanged. */
export interface StaffChanges {
  readonly display_name?: string;
  readonly role?: StaffRole;
  readonly active?: boolean;
}

@Injectable({ providedIn: 'root' })
export class StudioApi {
  private readonly api = inject(ApiClient);
  private readonly current = signal<StaffProfile | null>(null);

  readonly me = this.current.asReadonly();

  loadMe(): Observable<StaffProfile> {
    return this.api.get<StaffProfile>('/studio/me').pipe(tap((me) => this.current.set(me)));
  }

  dashboard(): Observable<DashboardCounts> {
    return this.api.get<DashboardCounts>('/studio/dashboard');
  }

  staff(): Observable<readonly StaffMember[]> {
    return this.api.get<readonly StaffMember[]>('/studio/staff');
  }

  addStaff(member: NewStaffMember): Observable<StaffMember> {
    return this.api.post<StaffMember>('/studio/staff', member);
  }

  updateStaff(id: string, changes: StaffChanges): Observable<StaffMember> {
    return this.api.patch<StaffMember>(`/studio/staff/${encodeURIComponent(id)}`, changes).pipe(
      tap((member) => {
        const me = this.current();
        if (me && me.id === member.id) {
          this.current.set({ ...me, display_name: member.display_name });
        }
      }),
    );
  }
}
