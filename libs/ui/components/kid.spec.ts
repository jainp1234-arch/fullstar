import { AnswerButton } from './answer-button';
import { Avatar } from './avatar';
import { Celebration } from './celebration';
import { FlagItem } from './flag-item';
import { OwlLoader } from './owl-loader';
import { ProfilePicker } from './profile-picker';
import { QuestionCard } from './question-card';
import { ReadAloud } from './read-aloud';
import { SpeechBubble } from './speech-bubble';
import { all, el, render } from './testing';
import { TimeIndicator } from './time-indicator';

describe('app-speech-bubble', () => {
  it('shows a decorative owl and the text with its language', async () => {
    const fixture = await render(SpeechBubble, { text: 'नमस्ते', lang: 'hi' });
    expect(el(fixture, 'img').getAttribute('src')).toBe('ui/illustrations/mascot-owl.webp');
    expect(el(fixture, 'img').getAttribute('alt')).toBe('');
    expect(el(fixture, '.bubble__text').getAttribute('lang')).toBe('hi');
  });

  it('can hide the owl', async () => {
    const fixture = await render(SpeechBubble, { text: 'Hi', showOwl: false });
    expect(all(fixture, 'img')).toHaveLength(0);
  });
});

describe('app-owl-loader', () => {
  it('announces loading', async () => {
    const fixture = await render(OwlLoader);
    expect(el(fixture, '[role="status"]').textContent).toBe('Loading');
  });
});

describe('app-read-aloud', () => {
  it('is a named toggle that fills the icon while speaking', async () => {
    const fixture = await render(ReadAloud, { speaking: true, surface: 'sky' });
    const button = el(fixture, 'button');
    expect(button.getAttribute('aria-label')).toBe('Read aloud');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.className).toContain('ra--speaking');
    expect(button.className).toContain('ra--sky');
    expect(el(fixture, '.ui-icon').classList).toContain('ui-icon--filled');
  });
});

describe('app-time-indicator', () => {
  it.each([
    [15, 30, 'ok', '50%'],
    [24, 30, 'near', '80%'],
    [30, 30, 'over', '100%'],
    [45, 30, 'over', '100%'],
  ])('%i of %i minutes is %s at %s', async (used, limit, state, width) => {
    const fixture = await render(TimeIndicator, { used, limit });
    const fill = el(fixture, '.time__fill');
    expect(fill.className).toContain(`time__fill--${state}`);
    expect(fill.style.width).toBe(width);
  });

  it('has the screen-reader label', async () => {
    const fixture = await render(TimeIndicator, { used: 24, limit: 30 });
    const bar = el(fixture, '[role="progressbar"]');
    expect(bar.getAttribute('aria-label')).toBe('Time today: 24 of 30 minutes');
    expect(bar.getAttribute('aria-valuenow')).toBe('24');
  });
});

describe('app-answer-button', () => {
  it('shows the letter and emits it', async () => {
    const fixture = await render(AnswerButton, { letter: 'B', text: 'Cat' });
    expect(el(fixture, '.answer__letter').textContent).toBe('B');
    let letter = '';
    fixture.componentInstance.pressed.subscribe((value) => (letter = value));
    el(fixture, 'button').click();
    expect(letter).toBe('B');
    expect(all(fixture, '.answer__check')).toHaveLength(0);
  });

  it('correct: green with a labelled check, never red', async () => {
    const fixture = await render(AnswerButton, { letter: 'A', text: 'Cow', correct: true });
    expect(el(fixture, 'button').className).toContain('answer--correct');
    expect(el(fixture, '.answer__check').getAttribute('aria-label')).toBe('Right answer');
  });

  it('shake() shakes once and returns to normal', async () => {
    const fixture = await render(AnswerButton, { letter: 'C', text: 'Dog' });
    vi.useFakeTimers();
    try {
      fixture.componentInstance.shake();
      await Promise.resolve();
      fixture.detectChanges();
      expect(el(fixture, 'button').className).toContain('answer--shake');
      vi.advanceTimersByTime(300);
      fixture.detectChanges();
      expect(el(fixture, 'button').className).not.toContain('answer--shake');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('app-question-card', () => {
  it('shows dots up to the current question, the count and the question heading', async () => {
    const fixture = await render(QuestionCard, { question: 'Which?', position: 3, total: 10 });
    expect(all(fixture, '.q__dot')).toHaveLength(10);
    expect(all(fixture, '.q__dot--done')).toHaveLength(2);
    expect(all(fixture, '.q__dot--now')).toHaveLength(1);
    expect(el(fixture, '.q__count').textContent).toBe('3 of 10');
    expect(el(fixture, 'h2').textContent).toBe('Which?');
  });

  it('drops the dots for long sets and shows a picture with alt text', async () => {
    const fixture = await render(QuestionCard, {
      question: 'Count the apples',
      position: 1,
      total: 20,
      picture: { src: 'lesson/apples.webp', alt: 'Five apples' },
    });
    expect(all(fixture, '.q__dot')).toHaveLength(0);
    expect(el(fixture, '.q__picture').getAttribute('alt')).toBe('Five apples');
  });
});

describe('app-avatar', () => {
  it('shows the animal at the size with its name as alt text', async () => {
    const fixture = await render(Avatar, { animal: 'panda', size: 96 });
    expect(el(fixture, 'img').getAttribute('src')).toBe('ui/illustrations/avatar-panda.webp');
    expect(el(fixture, 'img').getAttribute('alt')).toBe('Panda');
    expect((fixture.nativeElement as HTMLElement).style.getPropertyValue('--avatar-size')).toBe(
      '96px',
    );
  });

  it('selected: ring and a labelled badge; decorative: empty alt', async () => {
    const fixture = await render(Avatar, { animal: 'tiger', selected: true, decorative: true });
    expect(el(fixture, '.avatar').className).toContain('avatar--selected');
    expect(el(fixture, '.badge').getAttribute('aria-label')).toBe('Selected');
    expect(el(fixture, 'img').getAttribute('alt')).toBe('');
  });
});

describe('app-profile-picker', () => {
  it('lists each child as a button named by the name and emits the id', async () => {
    const fixture = await render(ProfilePicker, {
      profiles: [
        { id: 'c1', name: 'Asha', avatar: 'rabbit' },
        { id: 'c2', name: 'Ravi', avatar: 'lion' },
      ],
    });
    const buttons = all(fixture, '.profile');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Asha', 'Ravi']);
    let picked = '';
    fixture.componentInstance.picked.subscribe((id) => (picked = id));
    buttons[1].click();
    expect(picked).toBe('c2');
    let parent = 0;
    fixture.componentInstance.parent.subscribe(() => parent++);
    el(fixture, 'app-icon-button button').click();
    expect(parent).toBe(1);
    expect(el(fixture, 'app-icon-button button').getAttribute('aria-label')).toBe('Parent mode');
  });
});

describe('app-flag-item', () => {
  it('critical: no accept action', async () => {
    const fixture = await render(FlagItem, {
      severity: 'critical',
      category: 'Not suitable for age',
      location: 'Lesson 2, scene 3',
      reason: 'Brand name',
    });
    expect(el(fixture, '.flag').className).toContain('flag--critical');
    expect(el(fixture, '.flag__chip').textContent).toContain('Critical');
    expect(all(fixture, '.btn__label').map((l) => l.textContent)).toEqual(['Go to item']);
  });

  it('warning: can be accepted; the location goes to the item', async () => {
    const fixture = await render(FlagItem, {
      severity: 'warning',
      category: 'Spelling',
      location: 'Question 7',
      reason: 'Typo',
    });
    expect(all(fixture, '.btn__label').map((l) => l.textContent)).toEqual([
      'Go to item',
      'Accept with note',
    ]);
    let goTo = 0;
    let accept = 0;
    fixture.componentInstance.goTo.subscribe(() => goTo++);
    fixture.componentInstance.accept.subscribe(() => accept++);
    el(fixture, '.flag__location').click();
    all(fixture, 'app-button button')[1].click();
    expect(goTo).toBe(1);
    expect(accept).toBe(1);
  });
});

describe('app-celebration', () => {
  it('uses the "Well done" message and shows the stars earned', async () => {
    const fixture = await render(Celebration, { stars: 3 });
    expect(el(fixture, 'h1').textContent).toBe('Well done! You got 3 stars.');
    expect(all(fixture, '.earned img')).toHaveLength(3);
    expect(all(fixture, '.burst__star')).toHaveLength(12);
    expect(el(fixture, '[role="status"]').textContent).toBe('Well done! You got 3 stars.');
  });

  it('shows the final frame at once when celebrations are off', async () => {
    const fixture = await render(Celebration, { stars: 1, animate: false });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.dataset['celebration']).toBe('final');
    const star = el(fixture, '.burst__star');
    expect(star.style.opacity).toBe('1');
    expect(star.style.transform).not.toBe('');
  });
});
