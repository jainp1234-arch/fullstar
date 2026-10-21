import { Injectable, computed, signal } from '@angular/core';

/** Schema §8.2: a parent grant lasts 15 minutes and slides on each successful parent call. */
const GRANT_MS = 15 * 60 * 1000;

/**
 * Who is using the device right now: the child in kid mode (X-Child-Id) and the parent grant
 * after the PIN (X-Parent-Grant). Memory only; a reload goes back to Who is learning?.
 */
@Injectable({ providedIn: 'root' })
export class FamilySession {
  private readonly child = signal<string | null>(null);
  private readonly grant = signal<{ token: string; expiresAt: number } | null>(null);

  readonly activeChildId = this.child.asReadonly();
  readonly parentUnlocked = computed(() => this.grant() !== null);

  selectChild(childId: string | null): void {
    this.child.set(childId);
  }

  /** Stores a grant from POST /family/pin/verify or a refreshed one from a response header. */
  setParentGrant(token: string, expiresInS = GRANT_MS / 1000): void {
    this.grant.set({ token, expiresAt: Date.now() + expiresInS * 1000 });
  }

  /** The grant to send, or null when there is none or it has expired. */
  parentGrant(): string | null {
    const grant = this.grant();
    if (!grant || grant.expiresAt <= Date.now()) {
      return null;
    }
    return grant.token;
  }

  /** "Back to kids", PIN_REQUIRED, or sign-out. */
  lockParent(): void {
    this.grant.set(null);
  }

  clear(): void {
    this.child.set(null);
    this.grant.set(null);
  }
}
