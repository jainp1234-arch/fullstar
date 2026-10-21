import { errorMessage, fieldMessage } from './errors';

describe('errorMessage (Guidelines §16)', () => {
  it('kid mode never says error: offline, needs a parent, or try again', () => {
    expect(errorMessage('NETWORK', 'kid')).toBe('This needs the internet.');
    expect(errorMessage('PIN_REQUIRED', 'kid')).toBe('Ask Mummy or Papa to help.');
    expect(errorMessage('INTERNAL_ERROR', 'kid')).toBe("Let's try again.");
    expect(errorMessage('UPLOAD_LIMIT', 'kid')).toBe("Let's try again.");
  });

  it('parent mode explains, without exclamation marks', () => {
    expect(errorMessage('NETWORK', 'parent')).toBe("You're offline. Some features are paused.");
    expect(errorMessage('INTERNAL_ERROR', 'parent')).toBe(
      'Something went wrong on our side. Please try again in a few minutes.',
    );
    expect(errorMessage('PIN_LOCKED', 'parent', 61)).toContain('2 minutes');
    expect(errorMessage('PIN_LOCKED', 'parent', 30)).toContain('1 minute ');
    expect(errorMessage('MAX_CHILDREN', 'parent')).toBe('You can add up to 2 children.');
    expect(errorMessage('SOMETHING_NEW', 'studio')).toContain('Something went wrong');
    for (const code of [
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'CONFLICT',
      'UPLOAD_LIMIT',
      'RATE_LIMITED',
    ]) {
      expect(errorMessage(code, 'parent')).not.toContain('!');
    }
  });

  it('maps field codes', () => {
    expect(fieldMessage('REQUIRED')).toBe('This is required.');
    expect(fieldMessage('WRONG')).toBe('That PIN is not right.');
    expect(fieldMessage('ANYTHING')).toBe('Please check this.');
  });
});
