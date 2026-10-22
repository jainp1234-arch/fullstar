import { starsFor } from './kid-events';

/** Schema §11 (Plan 6.2): the device shows the same stars the server will count. */
describe('starsFor', () => {
  it('gives one star for trying when there was nothing to answer', () => {
    expect(starsFor(null, null)).toBe(1);
    expect(starsFor(0, 0)).toBe(1);
  });

  it('gives 2 stars over half and 3 over 80%', () => {
    expect(starsFor(1, 2)).toBe(1);
    expect(starsFor(3, 5)).toBe(2);
    expect(starsFor(4, 5)).toBe(2);
    expect(starsFor(9, 10)).toBe(3);
    expect(starsFor(1, 1)).toBe(3);
  });
});
