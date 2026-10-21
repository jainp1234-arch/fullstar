import { wordAt } from './read-along';

/** Plan 6.3: the highlighted word follows the narration's timings. */
describe('wordAt', () => {
  const timings = [
    { w: 'Rain', start_ms: 300, end_ms: 620 },
    { w: 'falls', start_ms: 700, end_ms: 1020 },
    { w: 'down.', start_ms: 1100, end_ms: 1420 },
  ];

  it('finds the word being read', () => {
    expect(wordAt(timings, 300)).toBe(0);
    expect(wordAt(timings, 619)).toBe(0);
    expect(wordAt(timings, 800)).toBe(1);
    expect(wordAt(timings, 1419)).toBe(2);
  });

  it('is -1 before the first word, between words and after the last', () => {
    expect(wordAt(timings, 0)).toBe(-1);
    expect(wordAt(timings, 650)).toBe(-1);
    expect(wordAt(timings, 5000)).toBe(-1);
    expect(wordAt([], 10)).toBe(-1);
  });
});
