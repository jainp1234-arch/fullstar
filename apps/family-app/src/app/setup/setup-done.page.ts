import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FamilySession } from '@fullstar/core';
import { Button, EN, illustrationUrl } from '@fullstar/ui';

/** B5 All set (App Flow §4): hand the tablet to the child; Start goes to C1 in kid mode. */
@Component({
  selector: 'app-setup-done-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <div class="done">
      <img [src]="picture" alt="" width="160" height="160" />
      <h1 class="done__title" tabindex="-1">{{ text.doneTitle }}</h1>
      <p class="done__body">{{ text.doneBody }}</p>
      <app-button [label]="text.start" [fullWidth]="true" (pressed)="start()" />
    </div>
  `,
  styles: `
    .done {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-4);
      max-width: 400px;
      margin: 0 auto;
      text-align: center;
    }
    .done img {
      display: block;
    }
    .done__title {
      margin: 0;
      font: var(--type-display);
      color: var(--color-ink-heading);
    }
    .done__title:focus {
      outline: none;
    }
    .done__body {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
  `,
})
export class SetupDonePage {
  protected readonly text = EN.setup;
  protected readonly picture = illustrationUrl('celebrate');

  private readonly session = inject(FamilySession);
  private readonly router = inject(Router);

  /** Setup ends parent mode: the child must never land in it (App Flow §3). */
  protected start(): void {
    this.session.lockParent();
    void this.router.navigateByUrl('/who');
  }
}
