import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiError, ReportReason, SupportApi } from '@fullstar/core';
import { Button, EN, SelectField, SelectOption, TextField, errorMessage } from '@fullstar/ui';

const REASONS: readonly ReportReason[] = [
  'wrong_answer',
  'spelling',
  'not_suitable',
  'audio_problem',
  'other',
];

/**
 * P18 Report a problem (App Flow §6; Schema §11; Plan 7.3): from a lesson or worksheet question in
 * parent mode (?item=, ?back=): a reason and an optional note. Our team fixes it in S7 and the
 * parent gets a "fixed" message (P19).
 */
@Component({
  selector: 'app-report-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ReactiveFormsModule, SelectField, TextField],
  template: `
    @if (sent()) {
      <p class="note" role="status">{{ text.sent }}</p>
      <app-button [label]="text.back" (pressed)="back()" />
    } @else if (item) {
      <p class="note">{{ text.intro }}</p>
      <form class="form" [formGroup]="form" novalidate (submit)="send($event)">
        <app-select-field formControlName="reason" [label]="text.reason" [options]="reasons" />
        <app-text-field formControlName="note" [label]="text.note" [rows]="3" [maxLength]="500" />
        @if (failure(); as message) {
          <p class="warning" role="alert">{{ message }}</p>
        }
        <app-button type="submit" [label]="text.send" [loading]="busy()" />
      </form>
    } @else {
      <p class="note">{{ text.noItem }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .note {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .warning {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
  `,
})
export class ReportPage {
  protected readonly text = EN.report;
  protected readonly reasons: readonly SelectOption[] = REASONS.map((value) => ({
    value,
    label: EN.lessonPreview.reasons[value],
  }));
  protected readonly form = new FormGroup({
    reason: new FormControl<ReportReason>('wrong_answer', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });
  protected readonly sent = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(SupportApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly item = this.route.snapshot.queryParamMap.get('item');

  protected send(event: Event): void {
    event.preventDefault();
    if (!this.item || this.form.invalid) {
      return;
    }
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.failure.set(null);
    this.api
      .report(this.item, v.reason, v.note.trim() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.sent.set(true);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.failure.set(
            errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
          );
        },
      });
  }

  protected back(): void {
    const back = this.route.snapshot.queryParamMap.get('back');
    void this.router.navigateByUrl(
      back && back.startsWith('/parent/') && !back.startsWith('//') ? back : '/parent/worksheets',
    );
  }
}
