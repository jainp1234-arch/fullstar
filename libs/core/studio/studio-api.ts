import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiClient } from '../api/api-client';

/** GET /studio/me (Schema §11). */
export interface StaffProfile {
  readonly id: string;
  readonly display_name: string;
  readonly role: 'content_admin' | 'super_admin';
}

@Injectable({ providedIn: 'root' })
export class StudioApi {
  private readonly api = inject(ApiClient);
  private readonly current = signal<StaffProfile | null>(null);

  readonly me = this.current.asReadonly();

  loadMe(): Observable<StaffProfile> {
    return this.api.get<StaffProfile>('/studio/me').pipe(tap((me) => this.current.set(me)));
  }
}
