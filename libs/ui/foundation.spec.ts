import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { ICON_CODEPOINTS } from './icons/icon-codepoints';
import { iconGlyph } from './icons/icons';
import { AVATAR_KEYS, illustrationUrl } from './illustrations/illustrations';
import { DisplayModeService } from './mode/display-mode';
import { EN } from './strings/en';

describe('UI foundations (Plan 2.1)', () => {
  it('maps icon names to their Material Symbols codepoints', () => {
    expect(iconGlyph('arrow_back')).toBe(String.fromCodePoint(0xe5c4));
    expect(Object.keys(ICON_CODEPOINTS)).toContain('school');
  });

  it('builds illustration URLs relative to the base href', () => {
    expect(illustrationUrl('subject-maths')).toBe('ui/illustrations/subject-maths.webp');
    expect(illustrationUrl('avatar-unicorn')).toBe('ui/illustrations/avatar-unicorn.webp');
  });

  it('has alt text for every avatar', () => {
    for (const key of AVATAR_KEYS) {
      expect(EN.illustrations[`avatar-${key}`]).toBeTruthy();
    }
  });

  it('follows the writing rules for kid and parent strings', () => {
    for (const value of Object.values(EN.parent)) {
      if (typeof value === 'string') {
        expect(value).not.toContain('!');
      }
    }
    expect(EN.kid.finished(1)).toBe('Well done! You got 1 star.');
    expect(EN.kid.finished(3)).toBe('Well done! You got 3 stars.');
    expect(EN.classLevel(3)).toBe('Class 3');
  });

  it('switches the data-mode on the root element', () => {
    const service = TestBed.inject(DisplayModeService);
    const root = TestBed.inject(DOCUMENT).documentElement;
    service.set('parent');
    expect(root.dataset['mode']).toBe('parent');
    expect(service.mode()).toBe('parent');
    service.set('kid');
    expect(root.dataset['mode']).toBe('kid');
  });
});
