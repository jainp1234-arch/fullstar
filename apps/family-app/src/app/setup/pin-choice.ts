import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { EN, PinPad } from '@fullstar/ui';

/** Choose a PIN, then enter it again (App Flow B1, A4). Emits the PIN once both match. */
@Component({
  selector: 'app-pin-choice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PinPad],
  template: `
    <p class="choice__prompt" aria-live="polite">
      {{ confirming() ? text.pinConfirm : prompt() }}
    </p>
    @if (mismatch()) {
      <p class="choice__error" role="alert">{{ text.pinMismatch }}</p>
    }
    <app-pin-pad [disabled]="disabled()" (completed)="entered($event)" />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .choice__prompt {
      margin: 0;
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .choice__error {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
  `,
})
export class PinChoice {
  readonly prompt = input.required<string>();
  readonly disabled = input(false);
  readonly chosen = output<string>();

  protected readonly text = EN.setup;
  protected readonly confirming = signal(false);
  protected readonly mismatch = signal(false);

  private readonly pad = viewChild.required(PinPad);
  private first = '';

  /** After a failed save: start again from the first entry. */
  restart(): void {
    this.first = '';
    this.confirming.set(false);
    this.pad().clear();
  }

  protected entered(pin: string): void {
    if (!this.confirming()) {
      this.first = pin;
      this.mismatch.set(false);
      this.confirming.set(true);
      this.pad().clear();
      return;
    }
    if (pin === this.first) {
      this.chosen.emit(pin);
      return;
    }
    this.first = '';
    this.confirming.set(false);
    this.mismatch.set(true);
    this.pad().reject();
  }
}
