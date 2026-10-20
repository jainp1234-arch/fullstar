import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { DisplayModeService } from '../mode/display-mode';
import { AppBottomSheet, SheetService } from './bottom-sheet';
import { DataColumn, DataTable } from './data-table';
import { DialogService } from './dialog';
import { EmptyState } from './empty-state';
import { MessageItem } from './message-item';
import { Skeleton } from './skeleton';
import { all, el, render } from './testing';
import { ToastService } from './toast';

const overlay = (): HTMLElement =>
  document.querySelector<HTMLElement>('.cdk-overlay-container') ?? document.body;

describe('app-empty-state', () => {
  it('shows the given illustration, title, body and button', async () => {
    TestBed.inject(DisplayModeService).set('parent');
    const fixture = await render(EmptyState, {
      title: 'No books yet',
      body: 'Upload your school books.',
      actionLabel: 'Upload book',
    });
    expect(el(fixture, 'img').getAttribute('src')).toBe('ui/illustrations/empty-books.webp');
    expect(el(fixture, 'h2').textContent).toBe('No books yet');
    let pressed = 0;
    fixture.componentInstance.action.subscribe(() => pressed++);
    el(fixture, 'button').click();
    expect(pressed).toBe(1);
  });

  it('uses the owl in kid mode', async () => {
    TestBed.inject(DisplayModeService).set('kid');
    const fixture = await render(EmptyState, { title: 'Nothing here' });
    expect(el(fixture, 'img').getAttribute('src')).toBe('ui/illustrations/mascot-owl.webp');
    expect(all(fixture, 'button')).toHaveLength(0);
  });
});

describe('app-skeleton', () => {
  it('draws hidden blocks of the real size with one loading status', async () => {
    const fixture = await render(Skeleton, { shape: 'tile', count: 3 });
    const blocks = all(fixture, '.block');
    expect(blocks).toHaveLength(3);
    expect(blocks[0].className).toContain('block--tile');
    expect(blocks.every((block) => block.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(all(fixture, '[role="status"]')).toHaveLength(1);
  });
});

describe('app-message-item', () => {
  it('is a button; unread shows the dot and tells screen readers', async () => {
    const fixture = await render(MessageItem, {
      icon: 'check_circle',
      title: 'Lessons ready',
      body: 'Body',
      time: '4:30 pm',
      unread: true,
    });
    expect(el(fixture, 'button').className).toContain('item--unread');
    expect(all(fixture, '.item__dot')).toHaveLength(1);
    expect(el(fixture, '.item__title').textContent).toContain('Unread:');
    expect(el(fixture, '.item__time').textContent).toBe('4:30 pm');
  });

  it('has no dot when read', async () => {
    const fixture = await render(MessageItem, {
      icon: 'error',
      title: 'Upload needs attention',
      body: 'Body',
      time: '19 Oct',
    });
    expect(all(fixture, '.item__dot')).toHaveLength(0);
  });
});

interface Row {
  readonly id: string;
  readonly name: string;
  readonly chapters: number;
}

describe('app-data-table', () => {
  it('renders a captioned table with typed columns', async () => {
    const columns: readonly DataColumn<Row>[] = [
      { key: 'name', header: 'Name', cell: (row) => row.name },
      {
        key: 'chapters',
        header: 'Chapters done',
        cell: (row) => String(row.chapters),
        align: 'end',
      },
    ];
    const fixture = await render(DataTable<Row>, {
      caption: 'Children',
      columns,
      rows: [
        { id: '1', name: 'Asha', chapters: 3 },
        { id: '2', name: 'Ravi', chapters: 1 },
      ],
    });
    expect(el(fixture, 'caption').textContent?.trim()).toBe('Children');
    expect(all(fixture, 'th').map((th) => th.textContent?.trim())).toEqual([
      'Name',
      'Chapters done',
    ]);
    expect(all(fixture, 'th')[0].getAttribute('scope')).toBe('col');
    expect(all(fixture, 'tbody tr')).toHaveLength(2);
    expect(all(fixture, 'td')[1].className).toContain('end');
  });
});

describe('DialogService.confirm', () => {
  it('resolves true only for the confirm button and uses danger when asked', async () => {
    const result = firstValueFrom(
      TestBed.inject(DialogService).confirm({
        title: 'Erase Class 3 progress?',
        body: 'Stars and scores are erased.',
        confirmLabel: 'Erase progress',
        cancelLabel: 'Keep progress',
        danger: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve));
    const dialog = overlay().querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Erase Class 3 progress?');
    const buttons = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Erase progress', 'Keep progress']);
    expect(buttons[0].className).toContain('btn--danger');
    buttons[0].click();
    expect(await result).toBe(true);
  });

  it('resolves false when kept', async () => {
    const result = firstValueFrom(
      TestBed.inject(DialogService).confirm({
        title: 'Remove Asha?',
        body: 'Body',
        confirmLabel: 'Remove child',
        cancelLabel: 'Keep child',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve));
    const buttons = overlay().querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
    expect(buttons[0].className).toContain('btn--primary');
    buttons[1].click();
    expect(await result).toBe(false);
  });
});

@Component({
  imports: [AppBottomSheet],
  template: `<app-bottom-sheet title="Choose a subject"><p>Body</p></app-bottom-sheet>`,
})
class SampleSheet {}

describe('SheetService', () => {
  it('opens a named sheet with the handle and title', async () => {
    TestBed.inject(SheetService).open(SampleSheet, null, 'Choose a subject');
    await new Promise((resolve) => setTimeout(resolve));
    const sheet = overlay().querySelector<HTMLElement>('[role="dialog"]');
    expect(sheet?.getAttribute('aria-label')).toBe('Choose a subject');
    expect(sheet?.querySelector('.sheet__handle')).toBeTruthy();
    expect(sheet?.querySelector('h2')?.textContent).toBe('Choose a subject');
  });
});

describe('ToastService', () => {
  it('shows the message and reports the action', async () => {
    const handle = TestBed.inject(ToastService).show('Worksheet saved.', { action: 'Open' });
    const action = firstValueFrom(handle.action$);
    await new Promise((resolve) => setTimeout(resolve));
    expect(overlay().querySelector('.toast__message')?.textContent).toBe('Worksheet saved.');
    overlay().querySelector<HTMLButtonElement>('.toast__action')?.click();
    await expect(action).resolves.toBeUndefined();
  });

  it('error toasts have a dismiss button', async () => {
    TestBed.inject(ToastService).show('Something went wrong.', { kind: 'error' });
    await new Promise((resolve) => setTimeout(resolve));
    const close = overlay().querySelector<HTMLButtonElement>('.toast__close');
    expect(close?.getAttribute('aria-label')).toBe('Dismiss');
  });
});
