import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import { FamilySession } from './family-session';

/** GET /family/me (Schema §11), wire format: snake_case. */
export interface FamilyMe {
  readonly family: {
    readonly id: string;
    readonly consent_version: string;
    readonly daily_limit_minutes: number;
    readonly sound_enabled: boolean;
    readonly celebrations_enabled: boolean;
    readonly pin_set: boolean;
    /** Set once the parent asked for data deletion (App Flow P17). */
    readonly deletion_requested_at?: string | null;
  };
  readonly children: readonly FamilyChild[];
}

export interface FamilyChild {
  readonly id: string;
  readonly first_name: string;
  readonly age: number;
  readonly class_level: number;
  readonly avatar_key: string;
  readonly stars_total: number;
}

/** GET /public/config (Schema §11). */
export interface PublicConfig {
  readonly avatars: readonly string[];
  readonly classes: readonly {
    readonly class_level: number;
    readonly subjects: readonly {
      readonly id: number;
      readonly code: string;
      readonly name: string;
    }[];
  }[];
  readonly upload_limits: {
    readonly pdf_max_bytes: number;
    readonly pdf_max_pages: number;
    readonly photo_max_bytes: number;
    readonly photos_per_upload: number;
  };
  readonly time_limits: {
    readonly options_minutes: readonly number[];
    readonly default_minutes: number;
  };
  readonly consent_version: string;
  /** The full privacy notice (P17); null until it is published. */
  readonly privacy_notice_url?: string | null;
}

/** POST /family/parent/children (App Flow B2). */
export interface NewChild {
  readonly first_name: string;
  readonly age: number;
  readonly class_level: number;
  readonly avatar_key: string;
}

/** PATCH /family/parent/children/{id} (App Flow P15); the class changes only by moving up. */
export type ChildChanges = Partial<Pick<NewChild, 'first_name' | 'age' | 'avatar_key'>>;

/** POST /family/parent/deletion-request (App Flow P17). */
export interface DeletionRequest {
  readonly requested_at: string;
  readonly due_by: string;
}

/** GET · PATCH /family/parent/settings (App Flow B4, P14). */
export interface FamilySettings {
  readonly daily_limit_minutes: number;
  readonly sound_enabled: boolean;
  readonly celebrations_enabled: boolean;
}

/** A parent grant from POST /family/pin or /family/pin/verify (Schema §8.2). */
interface GrantResponse {
  readonly parent_grant: string;
  readonly expires_in: number;
}

/** The signed-in family: null before loading, 'new' when no family exists yet (A2 consent). */
export type FamilyState = FamilyMe | 'new' | null;

@Injectable({ providedIn: 'root' })
export class FamilyApi {
  private readonly api = inject(ApiClient);
  private readonly session = inject(FamilySession);
  private readonly current = signal<FamilyState>(null);

  readonly state = this.current.asReadonly();
  /** The loaded family, or null before loading and for a new account. */
  readonly me = computed(() => {
    const state = this.current();
    return state && state !== 'new' ? state : null;
  });

  /** Loads /family/me; FAMILY_NOT_FOUND becomes 'new' (Schema §8.1). */
  loadMe(): Observable<FamilyState> {
    return this.api.get<FamilyMe>('/family/me').pipe(
      catchError((error: unknown) =>
        error instanceof ApiError && error.code === 'FAMILY_NOT_FOUND'
          ? of('new' as const)
          : throwError(() => error),
      ),
      tap((state) => this.current.set(state)),
    );
  }

  /** POST /family/me with the consent the parent accepted (App Flow A2, DPDP). */
  createFamily(consentVersion: string): Observable<FamilyMe> {
    return this.api
      .post<FamilyMe>('/family/me', { consent_version: consentVersion })
      .pipe(tap((me) => this.current.set(me)));
  }

  publicConfig(): Observable<PublicConfig> {
    return this.api.get<PublicConfig>('/public/config');
  }

  /** B1: the first PIN; the answer also unlocks parent mode for setup (B2–B4). */
  setFirstPin(pin: string): Observable<void> {
    return this.api.post<GrantResponse>('/family/pin', { pin }).pipe(
      tap((grant) => {
        this.session.setParentGrant(grant.parent_grant, grant.expires_in);
        this.patchFamily({ pin_set: true });
      }),
      map(() => undefined),
    );
  }

  /** P0: PIN → parent grant. Not retried with a key: each try counts towards the lock. */
  verifyPin(pin: string): Observable<void> {
    return this.api.post<GrantResponse>('/family/pin/verify', { pin }, { idempotent: false }).pipe(
      tap((grant) => this.session.setParentGrant(grant.parent_grant, grant.expires_in)),
      map(() => undefined),
    );
  }

  /** A4: a new PIN after a fresh sign-in (RECENT_LOGIN_REQUIRED otherwise). */
  resetPin(pin: string): Observable<void> {
    return this.api.put<unknown>('/family/pin', { pin }).pipe(
      tap(() => this.patchFamily({ pin_set: true })),
      map(() => undefined),
    );
  }

  /** B2, P15: at most two children (409 MAX_CHILDREN). */
  addChild(child: NewChild): Observable<FamilyChild> {
    return this.api.post<FamilyChild>('/family/parent/children', child).pipe(
      tap((added) => {
        const me = this.me();
        if (me) {
          this.current.set({ ...me, children: [...me.children, added] });
        }
      }),
    );
  }

  /** P15: name, age, picture. */
  updateChild(id: string, changes: ChildChanges): Observable<FamilyChild> {
    return this.api
      .patch<FamilyChild>(`/family/parent/children/${encodeURIComponent(id)}`, changes)
      .pipe(tap((child) => this.replaceChild(child)));
  }

  /** P15: erases the class's progress, class + 1 (409 MAX_CLASS at Class 5). */
  moveToNextClass(id: string): Observable<FamilyChild> {
    return this.api
      .post<FamilyChild>(`/family/parent/children/${encodeURIComponent(id)}/move-to-next-class`, {})
      .pipe(tap((child) => this.replaceChild(child)));
  }

  /** P15: removes the child and their data. */
  removeChild(id: string): Observable<void> {
    return this.api.delete<unknown>(`/family/parent/children/${encodeURIComponent(id)}`).pipe(
      tap(() => {
        const me = this.me();
        if (me) {
          this.current.set({ ...me, children: me.children.filter((child) => child.id !== id) });
        }
      }),
      map(() => undefined),
    );
  }

  /** P17: once per family; a repeat answers with the first request. */
  requestDeletion(): Observable<DeletionRequest> {
    return this.api
      .post<DeletionRequest>('/family/parent/deletion-request', {})
      .pipe(tap((request) => this.patchFamily({ deletion_requested_at: request.requested_at })));
  }

  settings(): Observable<FamilySettings> {
    return this.api.get<FamilySettings>('/family/parent/settings');
  }

  updateSettings(changes: Partial<FamilySettings>): Observable<FamilySettings> {
    return this.api
      .patch<FamilySettings>('/family/parent/settings', changes)
      .pipe(tap((settings) => this.patchFamily(settings)));
  }

  reset(): void {
    this.current.set(null);
  }

  private replaceChild(child: FamilyChild): void {
    const me = this.me();
    if (me) {
      this.current.set({
        ...me,
        children: me.children.map((existing) => (existing.id === child.id ? child : existing)),
      });
    }
  }

  private patchFamily(changes: Partial<FamilyMe['family']>): void {
    const me = this.me();
    if (me) {
      this.current.set({ ...me, family: { ...me.family, ...changes } });
    }
  }
}
