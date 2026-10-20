import { ICON_CODEPOINTS, IconName } from './icon-codepoints';

export type { IconName };

/** The character for an icon in the subset Material Symbols font (Guidelines §8). */
export function iconGlyph(name: IconName): string {
  return String.fromCodePoint(ICON_CODEPOINTS[name]);
}
