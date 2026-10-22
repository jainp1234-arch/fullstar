import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { EN } from '../strings/en';

/** app-page-thumb (Guidelines §11): one uploaded page; an unclear page offers "Retake". */
@Component({
  selector: 'app-page-thumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="thumb">
      <img
        loading="lazy"
        decoding="async"
        class="thumb__img"
        [class.thumb__img--unclear]="unclear()"
        [src]="src()"
        [alt]="alt()"
        width="96"
        height="128"
        loading="lazy"
      />
      @if (unclear()) {
        <figcaption>
          <button
            type="button"
            class="thumb__retake"
            [attr.aria-label]="retakeLabel()"
            (click)="retake.emit(page())"
          >
            {{ text.retake }}
          </button>
        </figcaption>
      }
    </figure>
  `,
  styles: `
    :host {
      display: inline-block;
    }
    .thumb {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
    }
    .thumb__img {
      display: block;
      width: 96px;
      height: 128px;
      box-sizing: border-box;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      object-fit: cover;
    }
    .thumb__img--unclear {
      border: 2px solid var(--color-error-700);
    }
    .thumb__retake {
      height: 28px;
      padding: 0 var(--space-3);
      border: 0;
      border-radius: var(--radius-pill);
      background: var(--color-error-100);
      color: var(--color-error-700);
      font: var(--type-small);
      cursor: pointer;
    }
    .thumb__retake:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
  `,
})
export class PageThumb {
  /** An object URL or a presigned URL for the page image. */
  readonly src = input.required<string>();
  readonly page = input.required<number>();
  readonly unclear = input(false);
  /** Emits the page number. */
  readonly retake = output<number>();

  protected readonly text = EN.upload;
  protected readonly alt = computed(() =>
    this.unclear() ? EN.upload.unclearPage(this.page()) : EN.upload.page(this.page()),
  );
  protected readonly retakeLabel = computed(() => EN.upload.retakePage(this.page()));
}
