import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';

/** GET /family/me (Schema §11), wire format: snake_case. */
export interface FamilyMe {
  readonly family: {
    readonly id: string;
    readonly consent_version: string;
    readonly daily_limit_minutes: number;
    readonly sound_enabled: boolean;
    readonly celebrations_enabled: boolean;
    readonly pin_set: boolean;
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
}

/** The signed-in family: null before loading, 'new' when no family exists yet (A2 consent). */
export type FamilyState = FamilyMe | 'new' | null;

@Injectable({ providedIn: 'root' })
export class FamilyApi {
  private readonly api = inject(ApiClient);
  private readonly current = signal<FamilyState>(null);

  readonly state = this.current.asReadonly();

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

  reset(): void {
    this.current.set(null);
  }
}
