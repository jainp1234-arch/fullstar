import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';
import { Button } from './button';

/** File types App Flow B3 allows; the API checks type and size again. */
const PHOTO_TYPES = 'image/jpeg,image/png';
const FILE_TYPES = 'application/pdf,image/jpeg,image/png';

/**
 * app-upload-zone (Guidelines §11): "Take photos" opens the camera, "Choose file" the picker,
 * and files can be dropped on the zone. Emits the chosen files; the screen validates them.
 */
@Component({
  selector: 'app-upload-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <div
      class="zone"
      [class.zone--over]="dragOver()"
      [class.zone--disabled]="disabled()"
      (dragover)="onDragOver($event)"
      (dragleave)="dragOver.set(false)"
      (drop)="onDrop($event)"
    >
      <img [src]="art" alt="" width="64" height="64" />
      <p class="zone__title">{{ title() }}</p>
      <div class="zone__buttons">
        <app-button
          [label]="text.takePhotos"
          icon="photo_camera"
          [disabled]="disabled()"
          (pressed)="camera.click()"
        />
        <app-button
          [label]="text.chooseFile"
          icon="upload_file"
          variant="secondary"
          [disabled]="disabled()"
          (pressed)="picker.click()"
        />
      </div>
      <p class="zone__limits">{{ limits() }}</p>
      <input
        #camera
        type="file"
        hidden
        tabindex="-1"
        aria-hidden="true"
        [accept]="photoTypes"
        capture="environment"
        multiple
        (change)="onPicked($event)"
      />
      <input
        #picker
        type="file"
        hidden
        tabindex="-1"
        aria-hidden="true"
        [accept]="fileTypes"
        multiple
        (change)="onPicked($event)"
      />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .zone {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-6);
      border: 2px dashed var(--color-primary-400);
      border-radius: var(--radius-xl);
      background: var(--color-primary-100);
      text-align: center;
      transition: border-color var(--dur-fast) var(--ease-standard);
    }
    .zone--over {
      border-style: solid;
      border-color: var(--color-primary-600);
    }
    /* The buttons dim themselves; text keeps full contrast (WCAG 1.4.3). */
    .zone--disabled img {
      opacity: 0.4;
    }
    .zone img {
      display: block;
    }
    .zone__title {
      margin: 0;
      font: var(--type-card-title);
      color: var(--color-ink-heading);
    }
    .zone__buttons {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--space-3);
    }
    .zone__limits {
      margin: 0;
      font: var(--type-small);
      font-weight: 400;
      color: var(--color-text-2);
    }
  `,
})
export class UploadZone {
  readonly title = input<string>(EN.upload.title);
  readonly limits = input<string>(EN.upload.limits);
  readonly disabled = input(false);
  readonly filesSelected = output<File[]>();

  protected readonly text = EN.upload;
  protected readonly art = illustrationUrl('empty-books');
  protected readonly photoTypes = PHOTO_TYPES;
  protected readonly fileTypes = FILE_TYPES;
  protected readonly dragOver = signal(false);

  protected onPicked(event: Event): void {
    const field = event.target as HTMLInputElement;
    const files = [...(field.files ?? [])];
    // Reset so choosing the same file again still fires change
    field.value = '';
    if (files.length) {
      this.filesSelected.emit(files);
    }
  }

  protected onDragOver(event: DragEvent): void {
    if (this.disabled()) {
      return;
    }
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!this.disabled() && files.length) {
      this.filesSelected.emit(files);
    }
  }
}
