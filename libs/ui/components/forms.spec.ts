import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CodeInput } from './code-input';
import { PageThumb } from './page-thumb';
import { PinPad } from './pin-pad';
import { StatusChip } from './status-chip';
import { all, el, render } from './testing';
import { TextField } from './text-field';
import { UploadZone } from './upload-zone';

@Component({
  imports: [ReactiveFormsModule, TextField, CodeInput],
  template: `
    <app-text-field label="Email" helper="Helper" [error]="error" [formControl]="email" />
    <app-code-input [formControl]="code" (completed)="completed = $event" />
  `,
})
class FormHost {
  readonly email = new FormControl('a@b.co', { nonNullable: true });
  readonly code = new FormControl('', { nonNullable: true });
  error: string | null = null;
  completed = '';
}

function type(box: HTMLElement, value: string): void {
  (box as HTMLInputElement).value = value;
  box.dispatchEvent(new Event('input'));
}

describe('app-text-field', () => {
  it('links the label, shows the helper and writes to the form control', async () => {
    const fixture = await render(FormHost);
    const field = el(fixture, 'app-text-field input') as HTMLInputElement;
    expect(el(fixture, 'app-text-field label').getAttribute('for')).toBe(field.id);
    expect(field.value).toBe('a@b.co');
    expect(field.getAttribute('aria-describedby')).toBe(`${field.id}-helper`);
    type(field, 'asha@example.com');
    expect(fixture.componentInstance.email.value).toBe('asha@example.com');
  });

  it('shows the error instead of the helper and marks the field invalid', async () => {
    const fixture = TestBed.createComponent(FormHost);
    fixture.componentInstance.error = 'Enter an email';
    await fixture.whenStable();
    const field = el(fixture, 'app-text-field input');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(`${field.id}-error`);
    expect(el(fixture, '.field__error').textContent).toContain('Enter an email');
    expect(all(fixture, '.field__helper')).toHaveLength(0);
  });

  it('follows the control disabled state', async () => {
    const fixture = await render(FormHost);
    fixture.componentInstance.email.disable();
    await fixture.whenStable();
    expect((el(fixture, 'app-text-field input') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('app-code-input', () => {
  it('advances on each digit and emits the full code', async () => {
    const fixture = await render(FormHost);
    const boxes = all(fixture, 'app-code-input input');
    expect(boxes).toHaveLength(6);
    expect(boxes[0].getAttribute('autocomplete')).toBe('one-time-code');
    '02418'.split('').forEach((digit, i) => type(boxes[i], digit));
    expect(document.activeElement).toBe(boxes[5]);
    type(boxes[5], '3');
    expect(fixture.componentInstance.code.value).toBe('024183');
    expect(fixture.componentInstance.completed).toBe('024183');
  });

  it('ignores letters', async () => {
    const fixture = await render(FormHost);
    const boxes = all(fixture, 'app-code-input input');
    type(boxes[0], 'a');
    expect((boxes[0] as HTMLInputElement).value).toBe('');
    expect(fixture.componentInstance.code.value).toBe('');
  });

  it('fills every box from a paste or autofill', async () => {
    const fixture = await render(FormHost);
    const boxes = all(fixture, 'app-code-input input');
    type(boxes[2], '171 515');
    await fixture.whenStable();
    expect(boxes.map((box) => (box as HTMLInputElement).value).join('')).toBe('171515');
    expect(fixture.componentInstance.completed).toBe('171515');
  });

  it('goes back on backspace in an empty box', async () => {
    const fixture = await render(FormHost);
    const boxes = all(fixture, 'app-code-input input');
    type(boxes[0], '1');
    boxes[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(boxes[0]);
    expect(fixture.componentInstance.code.value).toBe('');
  });
});

describe('app-pin-pad', () => {
  it('fills a dot per digit and emits the 4-digit PIN', async () => {
    const fixture = await render(PinPad);
    let pin = '';
    fixture.componentInstance.completed.subscribe((value) => (pin = value));
    const keys = all(fixture, '.key');
    expect(keys.slice(0, 10).map((key) => key.textContent?.trim())).toEqual('1234567890'.split(''));
    keys[0].click();
    keys[1].click();
    await fixture.whenStable();
    expect(all(fixture, '.dot--filled')).toHaveLength(2);
    expect(el(fixture, '[role="status"]').textContent).toBe('2 of 4 digits entered');
    keys[2].click();
    keys[9].click();
    expect(pin).toBe('1230');
  });

  it('deletes the last digit', async () => {
    const fixture = await render(PinPad);
    const keys = all(fixture, '.key');
    keys[4].click();
    await fixture.whenStable();
    keys[10].click();
    await fixture.whenStable();
    expect(all(fixture, '.dot--filled')).toHaveLength(0);
    expect(keys[10].getAttribute('aria-label')).toBe('Delete last digit');
  });

  it('shakes then clears on reject()', async () => {
    const fixture = await render(PinPad);
    vi.useFakeTimers();
    try {
      for (const key of all(fixture, '.key').slice(0, 4)) {
        key.click();
      }
      fixture.componentInstance.reject();
      fixture.detectChanges();
      expect(el(fixture, '.dots').classList).toContain('dots--shake');
      vi.advanceTimersByTime(300);
      fixture.detectChanges();
      expect(el(fixture, '.dots').classList).not.toContain('dots--shake');
      expect(all(fixture, '.dot--filled')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('app-upload-zone', () => {
  it('has the two buttons, the limits line and typed file inputs', async () => {
    const fixture = await render(UploadZone);
    const labels = all(fixture, '.btn__label').map((label) => label.textContent);
    expect(labels).toEqual(['Take photos', 'Choose file']);
    const [camera, picker] = all(fixture, 'input[type="file"]');
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(camera.getAttribute('accept')).toBe('image/jpeg,image/png');
    expect(picker.getAttribute('accept')).toBe('application/pdf,image/jpeg,image/png');
    expect(el(fixture, '.zone__limits').textContent).toContain('50 MB');
  });
});

describe('app-page-thumb', () => {
  it('marks an unclear page and emits retake with the page number', async () => {
    const fixture = await render(PageThumb, { src: 'blob:x', page: 3, unclear: true });
    expect(el(fixture, 'img').getAttribute('alt')).toBe('Page 3, unclear');
    expect(el(fixture, 'img').className).toContain('thumb__img--unclear');
    let page = 0;
    fixture.componentInstance.retake.subscribe((value) => (page = value));
    const retake = el(fixture, '.thumb__retake');
    expect(retake.getAttribute('aria-label')).toBe('Retake page 3');
    retake.click();
    expect(page).toBe(3);
  });

  it('has no retake for a clear page', async () => {
    const fixture = await render(PageThumb, { src: 'blob:x', page: 1 });
    expect(all(fixture, '.thumb__retake')).toHaveLength(0);
  });
});

describe('app-status-chip', () => {
  it.each([
    ['no-book', 'chip--blue', 'No book'],
    ['getting-ready', 'chip--gold', 'Getting ready'],
    ['needs-attention', 'chip--error', 'Needs attention'],
    ['read-along-ready', 'chip--blue', 'Read-along ready'],
    ['lessons-preparing', 'chip--gold', 'Lessons being prepared'],
    ['lessons-ready', 'chip--green', 'Lessons ready'],
  ])('%s has its tone, an icon and text', async (status, tone, label) => {
    const fixture = await render(StatusChip, { status });
    expect(el(fixture, '.chip').className).toContain(tone);
    expect(el(fixture, '.chip__icon').getAttribute('aria-hidden')).toBe('true');
    expect(el(fixture, '.chip').textContent).toContain(label);
  });
});
