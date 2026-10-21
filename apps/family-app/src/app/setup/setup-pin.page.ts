import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ApiError, FamilyApi } from '@fullstar/core';
import { EN, errorMessage } from '@fullstar/ui';
import { PAGE_STYLES } from './page-styles';
import { PinChoice } from './pin-choice';

/** B1 Create parent PIN (App Flow §4): choose and confirm 4 digits, then B2. */
@Component({
  selector: 'app-setup-pin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PinChoice],
  template: `
    <h1 class="page__title" tabindex="-1">{{ title }}</h1>
    <app-pin-choice [prompt]="text.pinIntro" [disabled]="busy()" (chosen)="save($event)" />
    @if (failure(); as message) {
      <p class="page__error" role="alert">{{ message }}</p>
    }
  `,
  styles: [PAGE_STYLES],
})
export class SetupPinPage {
  protected readonly title = EN.screens.B1;
  protected readonly text = EN.setup;
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  private readonly family = inject(FamilyApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly choice = viewChild.required(PinChoice);

  protected save(pin: string): void {
    this.busy.set(true);
    this.failure.set(null);
    this.family
      .setFirstPin(pin)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => void this.router.navigateByUrl('/setup/child'),
        error: (error: unknown) => {
          this.busy.set(false);
          const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
          if (code === 'CONFLICT') {
            // Already set (e.g. on another device): unlock with it instead
            void this.router.navigateByUrl('/parent/pin?next=%2Fsetup%2Fchild');
            return;
          }
          this.failure.set(errorMessage(code, 'parent'));
          this.choice().restart();
        },
      });
  }
}
