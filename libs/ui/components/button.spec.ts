import { Button } from './button';
import { IconButton } from './icon-button';
import { StarPill } from './star-pill';
import { el, render } from './testing';

describe('app-button', () => {
  it('renders the label with the variant class and emits on click', async () => {
    const fixture = await render(Button, { label: 'Start lesson', variant: 'secondary' });
    const button = el(fixture, 'button');
    expect(button.textContent?.trim()).toBe('Start lesson');
    expect(button.className).toContain('btn--secondary');
    let clicks = 0;
    fixture.componentInstance.pressed.subscribe(() => clicks++);
    button.click();
    expect(clicks).toBe(1);
  });

  it('is disabled and busy while loading, keeping the label for screen readers', async () => {
    const fixture = await render(Button, { label: 'Start lesson', loading: true });
    const button = el(fixture, 'button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(el(fixture, '.spinner')).toBeTruthy();
    expect(el(fixture, '.visually-hidden').textContent).toBe('Start lesson');
  });

  it('shows a decorative leading icon and goes full width', async () => {
    const fixture = await render(Button, {
      label: 'Read along',
      icon: 'volume_up',
      fullWidth: true,
    });
    expect(el(fixture, '.btn__icon').getAttribute('aria-hidden')).toBe('true');
    expect((fixture.nativeElement as HTMLElement).classList).toContain('full');
  });

  it('uses the given type and disabled state', async () => {
    const fixture = await render(Button, { label: 'Send code', type: 'submit', disabled: true });
    const button = el(fixture, 'button') as HTMLButtonElement;
    expect(button.type).toBe('submit');
    expect(button.disabled).toBe(true);
  });
});

describe('app-icon-button', () => {
  it('has an accessible name and the surface style', async () => {
    const fixture = await render(IconButton, { icon: 'arrow_back', label: 'Back', surface: 'sky' });
    const button = el(fixture, 'button');
    expect(button.getAttribute('aria-label')).toBe('Back');
    expect(button.className).toContain('icon-btn--sky');
    expect(el(fixture, '.ui-icon').getAttribute('aria-hidden')).toBe('true');
  });

  it('can show the filled icon and be disabled', async () => {
    const fixture = await render(IconButton, {
      icon: 'volume_up',
      label: 'Read aloud',
      filled: true,
      disabled: true,
    });
    expect(el(fixture, '.ui-icon').classList).toContain('ui-icon--filled');
    expect((el(fixture, 'button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('app-star-pill', () => {
  it('shows the count with an accessible label and a decorative star', async () => {
    const fixture = await render(StarPill, { count: 128 });
    expect(el(fixture, '.pill__count').textContent?.trim()).toBe('128');
    expect(el(fixture, '.pill').getAttribute('aria-label')).toBe('128 stars');
    expect(el(fixture, 'img').getAttribute('alt')).toBe('');
  });

  it('counts up to a higher number and bumps the star', async () => {
    const fixture = await render(StarPill, { count: 1 });
    fixture.componentRef.setInput('count', 4);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 600));
    fixture.detectChanges();
    expect(el(fixture, '.pill__count').textContent?.trim()).toBe('4');
    expect(el(fixture, '.pill').classList).toContain('pill--bump');
    expect(el(fixture, '.pill').getAttribute('aria-label')).toBe('4 stars');
  });
});
