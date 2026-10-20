import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppBottomSheet, SheetService } from '../components/bottom-sheet';
import { Button } from '../components/button';
import { CodeInput } from '../components/code-input';
import { DataColumn, DataTable } from '../components/data-table';
import { DialogService } from '../components/dialog';
import { EmptyState } from '../components/empty-state';
import { ListCard } from '../components/list-card';
import { MessageItem } from '../components/message-item';
import { PageThumb } from '../components/page-thumb';
import { PinPad } from '../components/pin-pad';
import { SectionHeader } from '../components/section-header';
import { Skeleton } from '../components/skeleton';
import { BookStatus, StatusChip } from '../components/status-chip';
import { TextField } from '../components/text-field';
import { ToastService } from '../components/toast';
import { UploadZone } from '../components/upload-zone';
import { illustrationUrl } from '../illustrations/illustrations';
import { EN } from '../strings/en';

const t = EN.dev.gallery;

interface ChildRow {
  readonly id: string;
  readonly name: string;
  readonly classLevel: number;
  readonly chapters: number;
}

/** Sample sheet content for the gallery. */
@Component({
  selector: 'app-gallery-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBottomSheet, ListCard],
  template: `
    <app-bottom-sheet [title]="t.sheetTitle">
      <div class="ui-stack">
        <app-list-card illustration="subject-english" [title]="EN.subjects.english" />
        <app-list-card illustration="subject-maths" [title]="EN.subjects.maths" />
      </div>
    </app-bottom-sheet>
  `,
})
export class GallerySheet {
  protected readonly EN = EN;
  protected readonly t = t;
}

/** Gallery section for Plan 2.2b: forms and feedback. */
@Component({
  selector: 'app-gallery-forms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    CodeInput,
    DataTable,
    EmptyState,
    MessageItem,
    PageThumb,
    PinPad,
    ReactiveFormsModule,
    SectionHeader,
    Skeleton,
    StatusChip,
    TextField,
    UploadZone,
  ],
  template: `
    <section class="sheet" data-section="forms">
      <app-section-header [title]="t.sections.fields" />
      <div class="ui-stack">
        <app-text-field
          [label]="t.emailLabel"
          type="email"
          autocomplete="email"
          [helper]="t.emailHelper"
          [formControl]="email"
        />
        <app-text-field
          [label]="t.emailLabel"
          type="email"
          [error]="t.emailError"
          [formControl]="badEmail"
        />
        <app-text-field [label]="t.nameLabel" [formControl]="name" />
      </div>

      <app-section-header [title]="t.sections.code" />
      <app-code-input [formControl]="code" (completed)="note.set(t.codeComplete($event))" />
      <app-code-input [error]="EN.parent.somethingFailed" />

      <app-section-header [title]="t.sections.pin" />
      <p class="hint">{{ t.pinHint }}</p>
      <app-pin-pad (completed)="checkPin($event)" />

      <app-section-header [title]="t.sections.upload" />
      <app-upload-zone (filesSelected)="note.set(t.filesChosen($event.length))" />
      <app-upload-zone [disabled]="true" />

      <app-section-header [title]="t.sections.pages" />
      <div class="row">
        <app-page-thumb [src]="pageArt" [page]="1" />
        <app-page-thumb
          [src]="pageArt"
          [page]="2"
          [unclear]="true"
          (retake)="note.set(EN.upload.retakePage($event))"
        />
      </div>

      <app-section-header [title]="t.sections.status" />
      <div class="row">
        @for (status of statuses; track status) {
          <app-status-chip [status]="status" />
        }
      </div>

      <app-section-header [title]="t.sections.overlays" />
      <div class="ui-stack">
        <app-button [label]="t.showToast" variant="secondary" (pressed)="showToast()" />
        <app-button [label]="t.showErrorToast" variant="secondary" (pressed)="showErrorToast()" />
        <app-button [label]="t.openDialog" variant="secondary" (pressed)="openDialog()" />
        <app-button [label]="t.openSheet" variant="secondary" (pressed)="openSheet()" />
      </div>
      @if (note(); as text) {
        <p class="note" role="status">{{ text }}</p>
      }

      <app-section-header [title]="t.sections.empty" />
      <app-empty-state
        [title]="t.emptyTitle"
        [body]="t.emptyBody"
        [actionLabel]="EN.parent.uploadBook"
      />

      <app-section-header [title]="t.sections.skeleton" />
      <div class="ui-stack">
        <app-skeleton shape="text" />
        <app-skeleton shape="list-card" [count]="2" />
        <div class="ui-tile-grid">
          <app-skeleton shape="tile" />
          <app-skeleton shape="tile" />
          <app-skeleton shape="tile" />
        </div>
      </div>

      <app-section-header [title]="t.sections.messages" [count]="1" />
      <div class="ui-stack">
        <app-message-item
          icon="check_circle"
          [title]="t.messageReadyTitle"
          [body]="EN.parent.lessonsReady(EN.subjects.hindi, 4)"
          [time]="t.messageTimeToday"
          [unread]="true"
        />
        <app-message-item
          icon="error"
          [title]="t.messageUploadTitle"
          [body]="EN.parent.uploadProblem(3, EN.subjects.evs)"
          [time]="t.messageTimeEarlier"
        />
      </div>

      <app-section-header [title]="t.sections.table" />
      <app-data-table
        [caption]="t.tableCaption"
        [columns]="columns"
        [rows]="children"
        [rowKey]="childId"
      />
    </section>
  `,
  styles: `
    .sheet {
      padding: var(--space-6) var(--space-4) var(--space-10);
      background: var(--color-page);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: var(--space-3);
    }
    app-code-input + app-code-input,
    app-upload-zone + app-upload-zone {
      margin-top: var(--space-4);
    }
    .hint,
    .note {
      margin: 0 0 var(--space-4);
      font: var(--type-small);
      font-weight: 400;
      color: var(--color-text-2);
    }
    .note {
      margin: var(--space-4) 0 0;
    }
  `,
})
export class GalleryForms {
  protected readonly EN = EN;
  protected readonly t = t;
  protected readonly email = new FormControl('', { nonNullable: true });
  protected readonly badEmail = new FormControl('asha@', { nonNullable: true });
  protected readonly name = new FormControl(
    { value: 'Asha', disabled: true },
    { nonNullable: true },
  );
  protected readonly code = new FormControl('', {
    nonNullable: true,
    validators: [Validators.pattern(/^\d{6}$/)],
  });
  protected readonly note = signal<string | null>(null);
  protected readonly pageArt = illustrationUrl('act-worksheet');
  protected readonly statuses: readonly BookStatus[] = [
    'no-book',
    'getting-ready',
    'needs-attention',
    'read-along-ready',
    'lessons-preparing',
    'lessons-ready',
  ];
  protected readonly columns: readonly DataColumn<ChildRow>[] = [
    { key: 'name', header: t.tableName, cell: (row) => row.name },
    { key: 'class', header: t.tableClass, cell: (row) => EN.classLevel(row.classLevel) },
    { key: 'chapters', header: t.tableChapters, cell: (row) => String(row.chapters), align: 'end' },
  ];
  protected readonly children: readonly ChildRow[] = [
    { id: 'c1', name: 'Asha', classLevel: 3, chapters: 3 },
    { id: 'c2', name: 'Ravi', classLevel: 3, chapters: 1 },
  ];
  protected readonly childId = (row: ChildRow): string => row.id;

  private readonly pinPad = viewChild.required(PinPad);
  private readonly toasts = inject(ToastService);
  private readonly dialogs = inject(DialogService);
  private readonly sheets = inject(SheetService);

  protected checkPin(pin: string): void {
    if (pin === '1234') {
      this.note.set(t.pinAccepted);
      this.pinPad().clear();
    } else {
      this.pinPad().reject();
    }
  }

  protected showToast(): void {
    this.toasts
      .show(t.toastMessage, { action: t.toastAction })
      .action$.subscribe(() => this.note.set(t.toastAction));
  }

  protected showErrorToast(): void {
    this.toasts.show(EN.parent.somethingFailed, { kind: 'error' });
  }

  protected openDialog(): void {
    this.dialogs
      .confirm({
        title: EN.parent.eraseProgressTitle(3),
        body: t.eraseBody,
        confirmLabel: EN.parent.eraseProgress,
        cancelLabel: EN.parent.keepProgress,
        danger: true,
      })
      .subscribe((erase) =>
        this.note.set(erase ? EN.parent.eraseProgress : EN.parent.keepProgress),
      );
  }

  protected openSheet(): void {
    this.sheets.open(GallerySheet, null, t.sheetTitle).subscribe();
  }
}
