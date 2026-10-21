/** Layout shared by the focus-shell pages of setup and parent PIN (App Flow §4, P0, A4). */
export const PAGE_STYLES = `
  :host {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 480px;
  }
  .page__title {
    margin: 0;
    font: var(--type-h1);
    color: var(--color-ink-heading);
  }
  .page__title:focus {
    outline: none;
  }
  .page__intro {
    margin: 0;
    font: var(--type-body);
    color: var(--color-text-2);
  }
  .page__error {
    margin: 0;
    font: var(--type-small);
    color: var(--color-error-700);
  }
  .page__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
`;

/** Native radios as chips, for small fixed choices (class, daily minutes). */
export const CHOICE_STYLES = `
  .choice {
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .choice legend {
    margin-bottom: var(--space-2);
    padding: 0;
    font: var(--type-small);
    color: var(--color-text);
  }
  .choice label {
    position: relative;
  }
  .choice input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .choice span {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 var(--space-4);
    border: 1.5px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    font: var(--type-label);
    color: var(--color-text);
    transition: background var(--dur-fast), border-color var(--dur-fast);
  }
  .choice input:checked + span {
    border: 2px solid var(--color-primary-600);
    background: var(--color-primary-100);
    color: var(--color-primary-600);
  }
  .choice input:focus-visible + span {
    outline: 3px solid var(--color-cyan);
    outline-offset: 2px;
  }
`;
