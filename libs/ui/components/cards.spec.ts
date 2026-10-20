import { ActionCard } from './action-card';
import { BannerCard } from './banner-card';
import { CornerTab } from './corner-tab';
import { ListCard } from './list-card';
import { NoticeCard } from './notice-card';
import { ProgressBar } from './progress-bar';
import { ProgressCard } from './progress-card';
import { SectionHeader } from './section-header';
import { all, el, render } from './testing';
import { Tile } from './tile';

describe('app-corner-tab', () => {
  it('uses the tone', async () => {
    const fixture = await render(CornerTab, { text: 'Done', tone: 'green' });
    expect(el(fixture, '.tab').className).toContain('tab--green');
  });
});

describe('app-list-card', () => {
  it('is one button with illustration, title, subtitle and corner tab', async () => {
    const fixture = await render(ListCard, {
      illustration: 'subject-english',
      title: 'Chapter 4',
      subtitle: '3 of 12 chapters done',
      cornerTab: { text: 'Chapter 4', tone: 'gold' },
    });
    expect(all(fixture, 'button')).toHaveLength(1);
    expect(el(fixture, 'img').getAttribute('src')).toBe('ui/illustrations/subject-english.webp');
    expect(el(fixture, 'img').getAttribute('alt')).toBe('English book');
    expect(el(fixture, '.card__title').textContent).toBe('Chapter 4');
    expect(el(fixture, '.tab').className).toContain('tab--gold');
  });

  it('locked: state-wait, "Coming soon", and still emits so the screen can toast', async () => {
    const fixture = await render(ListCard, {
      illustration: 'subject-evs',
      title: 'EVS',
      state: 'locked',
    });
    expect(el(fixture, 'img').getAttribute('src')).toBe('ui/illustrations/state-wait.webp');
    expect(el(fixture, '.tab').textContent).toBe('Coming soon');
    let state = '';
    fixture.componentInstance.pressed.subscribe((value) => (state = value));
    el(fixture, 'button').click();
    expect(state).toBe('locked');
  });

  it('offline: aria-disabled with a labelled cloud_off', async () => {
    const fixture = await render(ListCard, {
      illustration: 'subject-hindi',
      title: 'Hindi',
      state: 'offline',
    });
    expect(el(fixture, 'button').getAttribute('aria-disabled')).toBe('true');
    expect(el(fixture, '.card__offline').getAttribute('aria-label')).toBe('Needs the internet');
  });

  it('shows the chevron only when asked (parent mode)', async () => {
    const without = await render(ListCard, { illustration: 'act-lesson', title: 'Lesson' });
    expect(all(without, '.card__chevron')).toHaveLength(0);
    const withChevron = await render(ListCard, {
      illustration: 'act-lesson',
      title: 'Lesson',
      chevron: true,
    });
    expect(all(withChevron, '.card__chevron')).toHaveLength(1);
  });
});

describe('app-tile', () => {
  it('shows the label and the locked state', async () => {
    const fixture = await render(Tile, {
      illustration: 'act-tables',
      label: 'Tables',
      state: 'locked',
    });
    expect(el(fixture, '.tile__label').textContent).toBe('Tables');
    expect(el(fixture, 'img').getAttribute('src')).toBe('ui/illustrations/state-wait.webp');
    expect(el(fixture, '.tab').textContent).toBe('Coming soon');
  });
});

describe('app-banner-card', () => {
  it('shows eyebrow, body and illustration', async () => {
    const fixture = await render(BannerCard, {
      eyebrow: 'New lessons ready',
      body: 'Hindi Chapter 4 is ready to watch.',
      illustration: 'act-lesson',
    });
    expect(el(fixture, '.banner__eyebrow').textContent).toBe('New lessons ready');
    expect(el(fixture, 'img').getAttribute('alt')).toBe('Lesson');
  });
});

describe('app-progress-bar', () => {
  it('is a progressbar with clamped values', async () => {
    const fixture = await render(ProgressBar, { value: 25, max: 20, label: 'Chapters done' });
    const bar = el(fixture, '[role="progressbar"]');
    expect(bar.getAttribute('aria-valuenow')).toBe('20');
    expect(bar.getAttribute('aria-valuemax')).toBe('20');
    expect(bar.getAttribute('aria-label')).toBe('Chapters done');
    expect(el(fixture, '.bar__fill').style.width).toBe('100%');
  });

  it('fills the milestone dots that are reached', async () => {
    const fixture = await render(ProgressBar, { value: 2, max: 4, milestones: 4, label: 'Steps' });
    expect(all(fixture, '.bar__dot')).toHaveLength(4);
    expect(all(fixture, '.bar__dot--reached')).toHaveLength(2);
  });
});

describe('app-progress-card', () => {
  it('shows the count as value/max', async () => {
    const fixture = await render(ProgressCard, {
      illustration: 'act-worksheet',
      title: 'This week',
      value: 6,
      max: 20,
    });
    expect(el(fixture, '.progress__count').textContent).toBe('6/20');
  });
});

describe('app-notice-card', () => {
  it('shows title and body', async () => {
    const fixture = await render(NoticeCard, {
      illustration: 'empty-books',
      title: 'Upload your books',
      body: 'Body',
    });
    expect(el(fixture, '.notice__title').textContent).toBe('Upload your books');
  });
});

describe('app-action-card', () => {
  it('is a button with a decorative icon', async () => {
    const fixture = await render(ActionCard, { icon: 'settings', label: 'Children' });
    expect(el(fixture, 'button').textContent).toContain('Children');
    expect(el(fixture, '.action__icon').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('app-section-header', () => {
  it('is an h2 with an optional link or count', async () => {
    const withLink = await render(SectionHeader, { title: 'My subjects', linkText: 'See all' });
    expect(el(withLink, 'h2').textContent).toBe('My subjects');
    let pressed = 0;
    withLink.componentInstance.linkPressed.subscribe(() => pressed++);
    el(withLink, '.header__link').click();
    expect(pressed).toBe(1);
    const withCount = await render(SectionHeader, { title: 'Activity', count: 3, surface: 'sky' });
    expect(el(withCount, '.header__count').textContent).toBe('3');
    expect(el(withCount, '.header').className).toContain('header--sky');
  });
});
