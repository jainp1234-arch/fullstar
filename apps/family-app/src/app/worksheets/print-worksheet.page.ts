import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { WorksheetApi } from '@fullstar/core';
import { Button, EN, OwlLoader } from '@fullstar/ui';
import { firstValueFrom } from 'rxjs';

const CACHE = 'fullstar-worksheets';
const POLL_MS = 2_000;
const MAX_POLLS = 30;

/**
 * P12 Print / share (App Flow §6; Schema §11; Plan 7.2): waits while the PDF is made (202), then
 * offers Download and Share (the device's share sheet, e.g. WhatsApp). The PDF is kept on the
 * device (Cache Storage) so it prints later without the internet. Opening it is the first print.
 */
@Component({
  selector: 'app-print-worksheet-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, OwlLoader],
  template: `
    @if (fileUrl(); as url) {
      <p class="note" role="status">{{ offline() ? text.fromDevice : text.savedOffline }}</p>
      <div class="actions">
        <a class="download" [href]="url" [attr.download]="fileName">{{ text.download }}</a>
        @if (canShare()) {
          <app-button variant="secondary" icon="share" [label]="text.share" (pressed)="share()" />
        }
      </div>
    } @else if (failed()) {
      <p class="warning" role="alert">{{ text.failed }}</p>
      <app-button [label]="text.tryAgain" (pressed)="load()" />
    } @else {
      <app-owl-loader />
      <p class="note" role="status">{{ text.making }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
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
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .download {
      display: inline-flex;
      align-items: center;
      min-height: 48px;
      padding: 0 var(--space-5);
      border-radius: var(--radius-pill);
      background: var(--color-primary-600);
      color: var(--color-text-on-primary, #fff);
      font: var(--type-label);
      text-decoration: none;
    }
    .download:focus-visible {
      outline: 3px solid var(--color-cyan);
      outline-offset: 2px;
    }
  `,
})
export class PrintWorksheetPage {
  protected readonly text = EN.worksheets;
  protected readonly fileUrl = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly offline = signal(false);
  protected readonly canShare = signal(false);
  protected readonly fileName: string;

  private readonly api = inject(WorksheetApi);
  private readonly id: string;
  private blob: Blob | null = null;
  private stopped = false;

  constructor() {
    this.id = inject(ActivatedRoute).snapshot.paramMap.get('worksheetId') ?? '';
    this.fileName = `worksheet-${this.id.slice(0, 8)}.pdf`;
    inject(DestroyRef).onDestroy(() => {
      this.stopped = true;
      const url = this.fileUrl();
      if (url) {
        URL.revokeObjectURL(url);
      }
    });
    void this.load();
  }

  protected async load(): Promise<void> {
    this.failed.set(false);
    try {
      for (let poll = 0; poll < MAX_POLLS && !this.stopped; poll++) {
        const pdf = await firstValueFrom(this.api.pdf(this.id));
        if (pdf.status === 'ready' && pdf.url) {
          const response = await fetch(pdf.url);
          if (!response.ok) {
            throw new Error('download failed');
          }
          await this.keep(response.clone());
          this.show(await response.blob(), false);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      this.failed.set(!this.stopped);
    } catch {
      // Offline: the copy kept on this device, if there is one
      const kept = await this.kept();
      if (kept) {
        this.show(kept, true);
      } else {
        this.failed.set(true);
      }
    }
  }

  protected async share(): Promise<void> {
    if (!this.blob) {
      return;
    }
    const file = new File([this.blob], this.fileName, { type: 'application/pdf' });
    try {
      await navigator.share({ files: [file], title: this.fileName });
    } catch {
      // The parent closed the share sheet
    }
  }

  private show(blob: Blob, offline: boolean): void {
    this.blob = blob;
    this.offline.set(offline);
    const file = new File([blob], this.fileName, { type: 'application/pdf' });
    this.canShare.set(
      typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }),
    );
    this.fileUrl.set(URL.createObjectURL(blob));
  }

  private async keep(response: Response): Promise<void> {
    try {
      await (
        await caches.open(CACHE)
      ).put(`/worksheets/${encodeURIComponent(this.id)}.pdf`, response);
    } catch {
      // Storage unavailable: the PDF still downloads now
    }
  }

  private async kept(): Promise<Blob | null> {
    try {
      const response = await (
        await caches.open(CACHE)
      ).match(`/worksheets/${encodeURIComponent(this.id)}.pdf`);
      return response ? await response.blob() : null;
    } catch {
      return null;
    }
  }
}
