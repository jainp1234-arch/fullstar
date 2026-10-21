import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiError, FamilyApi } from '@fullstar/core';
import { Button, EN, errorMessage } from '@fullstar/ui';
import { CHOICE_STYLES, PAGE_STYLES } from './page-styles';

/** Schema §4.1 families.daily_limit_minutes, used until /public/config answers. */
const FALLBACK_MINUTES = [20, 30, 45, 60] as const;

/** B4 Daily time limit (App Flow §4): 20, 30, 45 or 60 minutes; a reminder, never a lock. */
@Component({
  selector: 'app-setup-time-limit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ReactiveFormsModule],
  template: `
    <h1 class="page__title" tabindex="-1">{{ title }}</h1>
    <form class="form" [formGroup]="form" (ngSubmit)="save()">
      <fieldset class="choice">
        <legend>{{ text.timeIntro }}</legend>
        @for (option of options(); track option) {
          <label>
            <input type="radio" formControlName="minutes" [value]="option" />
            <span>{{ text.minutes(option) }}</span>
          </label>
        }
      </fieldset>
      <p class="page__intro">{{ text.timeNote }}</p>
      @if (failure(); as message) {
        <p class="page__error" role="alert">{{ message }}</p>
      }
      <app-button type="submit" [label]="text.continue" [fullWidth]="true" [loading]="busy()" />
    </form>
  `,
  styles: [
    PAGE_STYLES,
    CHOICE_STYLES,
    `
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
    `,
  ],
})
export class SetupTimeLimitPage {
  protected readonly title = EN.screens.B4;
  protected readonly text = EN.setup;
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  private readonly family = inject(FamilyApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly config = toSignal(this.family.publicConfig(), { initialValue: null });

  protected readonly minutes = new FormControl<number>(
    this.family.me()?.family.daily_limit_minutes ?? 30,
    { nonNullable: true, validators: [Validators.required] },
  );
  protected readonly form = new FormGroup({ minutes: this.minutes });
  protected readonly options = computed<readonly number[]>(
    () => this.config()?.time_limits.options_minutes ?? FALLBACK_MINUTES,
  );

  protected save(): void {
    this.busy.set(true);
    this.failure.set(null);
    this.family
      .updateSettings({ daily_limit_minutes: this.minutes.value })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => void this.router.navigateByUrl('/setup/done'),
        error: (error: unknown) => {
          this.busy.set(false);
          const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
          this.failure.set(errorMessage(code, 'parent'));
          if (code === 'PIN_REQUIRED') {
            void this.router.navigateByUrl('/parent/pin?next=%2Fsetup%2Ftime-limit');
          }
        },
      });
  }
}
