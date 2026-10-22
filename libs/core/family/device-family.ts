import { Injectable } from '@angular/core';
import type { FamilyMe } from './family-api';

const KEY = 'fullstar.device-family';

/**
 * The family as this device last saw it (App Flow §10 "Signed out", Plan 7.5): kept from each
 * /family/me until an explicit sign-out, so a session that ends on its own returns to Who is
 * learning? (C1) and kid mode keeps working with what the device has. Storage failures are ignored.
 */
@Injectable({ providedIn: 'root' })
export class DeviceFamily {
  read(): FamilyMe | null {
    try {
      const raw = localStorage.getItem(KEY);
      const value: unknown = raw ? JSON.parse(raw) : null;
      return isFamilyMe(value) ? value : null;
    } catch {
      return null;
    }
  }

  save(me: FamilyMe): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(me));
    } catch {
      // Private window or storage full: C1 needs a sign-in after the session ends
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing stored
    }
  }
}

function isFamilyMe(value: unknown): value is FamilyMe {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record['family'] === 'object' && Array.isArray(record['children']);
}
