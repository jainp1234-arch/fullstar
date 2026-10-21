import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiError, AuthService, FamilyApi, FamilySettings } from '@fullstar/core';
import {
  AVATAR_KEYS,
  ActionCard,
  AvatarKey,
  Button,
  EN,
  ListCard,
  SectionHeader,
  ToastService,
  errorMessage,
} from '@fullstar/ui';
import { CHOICE_STYLES } from '../setup/page-styles';

const AVATARS = new Set<string>(AVATAR_KEYS);
const MAX_CHILDREN = 2;
/** Schema §4.1 families.daily_limit_minutes, used until /public/config answers. */
const FALLBACK_MINUTES = [20, 30, 45, 60] as const;

/**
 * P14 Settings (App Flow §6): children, daily time limit, sound and celebrations, parent PIN,
 * help, privacy and sign out. Each change saves at once.
 */
@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActionCard, Button, ListCard, ReactiveFormsModule, SectionHeader],
  template: `
    <app-section-header [title]="text.children" />
    <div class="stack">
      @for (child of children(); track child.id) {
        <app-list-card
          [illustration]="child.illustration"
          [title]="child.name"
          [subtitle]="child.summary"
          [chevron]="true"
          (pressed)="openChild(child.id)"
        />
      }
      @if (children().length < maxChildren) {
        <app-button
          [label]="text.addChild"
          variant="secondary"
          icon="add"
          [fullWidth]="true"
          (pressed)="addChild()"
        />
      }
    </div>

    <app-section-header [title]="text.timeLimit" />
    <fieldset class="choice" [formGroup]="form">
      <legend class="ui-visually-hidden">{{ text.timeLimit }}</legend>
      @for (option of options(); track option) {
        <label>
          <input type="radio" formControlName="daily_limit_minutes" [value]="option" />
          <span>{{ setupText.minutes(option) }}</span>
        </label>
      }
    </fieldset>

    <app-section-header [title]="text.soundAndCelebrations" />
    <div class="stack" [formGroup]="form">
      <label class="toggle">
        <input type="checkbox" formControlName="sound_enabled" />
        <span>{{ text.sound }}</span>
      </label>
      <label class="toggle">
        <input type="checkbox" formControlName="celebrations_enabled" />
        <span>{{ text.celebrations }}</span>
      </label>
    </div>

    <app-section-header [title]="text.parentPin" />
    <div class="actions">
      <app-action-card icon="lock" [label]="text.changePin" (pressed)="go('/parent/forgot-pin')" />
      <app-action-card icon="quiz" [label]="text.help" (pressed)="go('/parent/settings/help')" />
      <app-action-card
        icon="fact_check"
        [label]="text.privacy"
        (pressed)="go('/parent/settings/privacy')"
      />
    </div>

    <div class="sign-out">
      <app-button
        [label]="authText.signOut"
        variant="ghost"
        [fullWidth]="true"
        (pressed)="signOut()"
      />
    </div>
  `,
  styles: [
    CHOICE_STYLES,
    `
      :host {
        display: block;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-4);
      }
      .toggle {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-height: 48px;
        font: var(--type-body);
        color: var(--color-text);
        cursor: pointer;
      }
      .toggle input {
        flex: none;
        width: 24px;
        height: 24px;
        margin: 0;
        accent-color: var(--color-primary-600);
      }
      .toggle input:focus-visible {
        outline: 3px solid var(--color-cyan);
        outline-offset: 2px;
      }
      .sign-out {
        margin-top: var(--space-7);
      }
    `,
  ],
})
export class SettingsPage {
  protected readonly text = EN.settings;
  protected readonly setupText = EN.setup;
  protected readonly authText = EN.auth;
  protected readonly maxChildren = MAX_CHILDREN;

  private readonly family$ = inject(FamilyApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly config = toSignal(this.family$.publicConfig(), { initialValue: null });

  private readonly family = this.family$.me()?.family;
  /** Each control saves on change; a failed save puts the old value back. */
  protected readonly form = new FormGroup({
    daily_limit_minutes: new FormControl(this.family?.daily_limit_minutes ?? 30, {
      nonNullable: true,
    }),
    sound_enabled: new FormControl(this.family?.sound_enabled ?? true, { nonNullable: true }),
    celebrations_enabled: new FormControl(this.family?.celebrations_enabled ?? true, {
      nonNullable: true,
    }),
  });
  protected readonly children = computed(() =>
    (this.family$.me()?.children ?? []).map((child) => ({
      id: child.id,
      name: child.first_name,
      summary: this.text.childSummary(child.class_level, child.age),
      illustration:
        `avatar-${AVATARS.has(child.avatar_key) ? (child.avatar_key as AvatarKey) : 'cat'}` as const,
    })),
  );
  protected readonly options = computed<readonly number[]>(
    () => this.config()?.time_limits.options_minutes ?? FALLBACK_MINUTES,
  );

  constructor() {
    for (const key of ['daily_limit_minutes', 'sound_enabled', 'celebrations_enabled'] as const) {
      const control: FormControl<number | boolean> = this.form.controls[key];
      let saved = control.value;
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) =>
        this.save(
          { [key]: value },
          () => control.setValue(saved, { emitEvent: false }),
          () => {
            saved = value;
          },
        ),
      );
    }
  }

  protected openChild(id: string): void {
    void this.router.navigate(['/parent/settings/children', id]);
  }

  protected addChild(): void {
    void this.router.navigate(['/setup/child'], { queryParams: { next: '/parent/settings' } });
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  private save(changes: Partial<FamilySettings>, revert: () => void, done: () => void): void {
    this.family$
      .updateSettings(changes)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          done();
          this.toasts.show(this.text.saved);
        },
        error: (error: unknown) => {
          revert();
          this.toasts.show(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
            { kind: 'error' },
          );
        },
      });
  }

  protected signOut(): void {
    void this.auth.signOut();
  }
}
