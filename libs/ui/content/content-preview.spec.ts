import { all, el, render } from '../components/testing';
import { ContentValue, bodyAndSolution, contentValue, wordCount } from './content-body';
import { ContentPreview } from './content-preview';

const MCQ: ContentValue = {
  kind: 'question',
  type: 'mcq',
  body: {
    prompt: 'Which word is a noun?',
    options: [
      { id: 'a', text: 'run' },
      { id: 'b', text: 'bird' },
    ],
  },
  solution: { correct: ['b'], explanation: 'A bird is a thing.' },
};

describe('app-content-preview', () => {
  it('is in kid mode and steps through lesson scenes', async () => {
    const fixture = await render(ContentPreview, {
      value: {
        kind: 'lesson',
        body: {
          scenes: [
            {
              id: 's1',
              duration_ms: 1000,
              text: 'A bird builds a nest.',
              visual: { illustration: 'subject-evs', animation: 'pop' },
            },
            { id: 's2', duration_ms: 0, quiz: { question_item_id: 'q' } },
          ],
        },
      } satisfies ContentValue,
    });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('data-mode')).toBe('kid');
    expect(host.textContent).toContain('Scene 1 of 2');
    expect(host.textContent).toContain('A bird builds a nest.');
    expect(el(fixture, 'img.anim--pop').getAttribute('src')).toBe(
      'ui/illustrations/subject-evs.webp',
    );

    const next = all(fixture, 'button').find((b) => b.textContent?.trim() === 'Next');
    next?.click();
    await fixture.whenStable();
    expect(host.textContent).toContain('Scene 2 of 2');
    expect(host.textContent).toContain('A quiz question comes here.');
  });

  it('marks a wrong answer, then shows the explanation for the right one', async () => {
    const fixture = await render(ContentPreview, { value: MCQ });
    const host = fixture.nativeElement as HTMLElement;
    const answers = all(fixture, 'app-answer-button button');
    expect(answers.map((b) => b.textContent)).toEqual([
      expect.stringContaining('run'),
      expect.stringContaining('bird'),
    ]);
    answers[0].click();
    await fixture.whenStable();
    expect(host.textContent).toContain('Try again.');
    answers[1].click();
    await fixture.whenStable();
    expect(host.textContent).toContain('Well done! A bird is a thing.');
  });

  it('shows true or false, match pairs on request, and passages', async () => {
    const tf = await render(ContentPreview, {
      value: {
        kind: 'question',
        type: 'true_false',
        body: { prompt: 'Fish live in water.' },
        solution: { correct: true, explanation: 'Yes.' },
      } satisfies ContentValue,
    });
    expect(all(tf, 'app-answer-button').map((b) => b.textContent?.trim())).toEqual([
      expect.stringContaining('True'),
      expect.stringContaining('False'),
    ]);

    const match = await render(ContentPreview, {
      value: {
        kind: 'question',
        type: 'match',
        body: {
          prompt: 'Match.',
          left: [
            { id: 'l1', text: 'Bird' },
            { id: 'l2', text: 'Bee' },
          ],
          right: [
            { id: 'r1', text: 'Hive' },
            { id: 'r2', text: 'Nest' },
          ],
        },
        solution: {
          pairs: [
            ['l1', 'r2'],
            ['l2', 'r1'],
          ],
          explanation: 'Homes.',
        },
      } satisfies ContentValue,
    });
    expect(el(match, '.pairs').textContent).not.toContain('Nest');
    all(match, 'button')
      .find((b) => b.textContent?.includes('Show the answers'))
      ?.click();
    await match.whenStable();
    expect(all(match, '.pairs__row').map((row) => row.textContent?.replace(/\s+/g, ''))).toEqual([
      'Bird→Nest',
      'Bee→Hive',
    ]);

    const passage = await render(ContentPreview, {
      value: { kind: 'passage', body: { text: 'राम स्कूल जाता है।', word_count: 4, level: 1 } },
      lang: 'hi',
    });
    expect(el(passage, '.passage').getAttribute('lang')).toBe('hi');
  });
});

describe('content-body helpers', () => {
  it('counts words like the API and round-trips body and solution', () => {
    expect(wordCount('  Ravi has\na kite. ')).toBe(4);
    expect(wordCount('')).toBe(0);
    const value = contentValue(
      'question',
      'mcq',
      MCQ.body,
      (MCQ as { solution: unknown }).solution,
    );
    expect(bodyAndSolution(value)).toEqual({
      body: MCQ.body,
      solution: { correct: ['b'], explanation: 'A bird is a thing.' },
    });
    expect(
      bodyAndSolution({ kind: 'passage', body: { text: 'a', word_count: 1, level: 1 } }),
    ).toEqual({
      body: { text: 'a', word_count: 1, level: 1 },
    });
  });
});
