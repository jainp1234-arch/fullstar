import { fieldMessage } from '@fullstar/ui';

/** API field errors by path, e.g. { "body.scenes[2].text": "REQUIRED" } (Schema §10). */
export type FieldErrors = Readonly<Record<string, string>>;

/** The message for an error at exactly this path. */
export function fieldError(errors: FieldErrors, path: string): string | null {
  const code = errors[path];
  return code ? fieldMessage(code) : null;
}

/** Layout shared by the S5 editors. */
export const EDITOR_STYLES = `
  :host {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .editor__heading {
    margin: 0;
    font: var(--type-card-title);
    color: var(--color-ink-heading);
  }
  .editor__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .editor__legend {
    padding: 0 var(--space-2);
    font: var(--type-label);
    color: var(--color-text);
  }
  .editor__row-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .editor__pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-3);
  }
  .editor__line {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: var(--space-2);
  }
  .editor__error {
    margin: 0;
    font: var(--type-small);
    color: var(--color-error-700);
  }
  .editor__note {
    margin: 0;
    font: var(--type-small);
    color: var(--color-text-2);
  }
`;
