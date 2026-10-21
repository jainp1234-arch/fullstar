import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Button, EN, SectionHeader, TextField } from '@fullstar/ui';

/**
 * P16 Help (App Flow §6): FAQs and the Contact us form. Plan 3.2 builds the form only; sending
 * (support tickets, replies in messages) arrives with the support step.
 */
@Component({
  selector: 'app-help-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ReactiveFormsModule, SectionHeader, TextField],
  template: `
    <app-section-header [title]="text.faqTitle" />
    <div class="faqs">
      @for (faq of text.faqs; track faq.q) {
        <details class="faq">
          <summary>{{ faq.q }}</summary>
          <p>{{ faq.a }}</p>
        </details>
      }
    </div>

    <app-section-header [title]="text.contactTitle" />
    <form class="contact" [formGroup]="form">
      <app-text-field formControlName="subject" [label]="text.subject" [maxLength]="120" />
      <label class="message">
        <span class="message__label">{{ text.message }}</span>
        <textarea formControlName="message" rows="5" maxlength="2000"></textarea>
      </label>
      <p class="note">{{ text.contactSoon }}</p>
      <app-button type="submit" [label]="text.send" [fullWidth]="true" [disabled]="true" />
    </form>
  `,
  styles: `
    :host {
      display: block;
    }
    .faqs {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .faq {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }
    .faq summary {
      min-height: 48px;
      padding: var(--space-3) var(--space-4);
      box-sizing: border-box;
      font: var(--type-label);
      color: var(--color-text);
      cursor: pointer;
    }
    .faq summary:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
      border-radius: var(--radius-lg);
    }
    .faq p {
      margin: 0;
      padding: 0 var(--space-4) var(--space-4);
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .contact {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .message {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .message__label {
      font: var(--type-small);
      color: var(--color-text);
    }
    .message textarea {
      min-height: 132px;
      padding: var(--space-3) var(--space-4);
      box-sizing: border-box;
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      font: var(--type-body);
      color: var(--color-text);
      resize: vertical;
    }
    .message textarea:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
      border: 2px solid var(--color-primary-600);
    }
    .note {
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
  `,
})
export class HelpPage {
  protected readonly text = EN.help;
  protected readonly form = new FormGroup({
    subject: new FormControl('', { nonNullable: true }),
    message: new FormControl('', { nonNullable: true }),
  });
}
