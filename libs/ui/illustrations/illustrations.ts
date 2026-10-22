/** Illustration keys (Guidelines §9). Files: libs/ui/assets/illustrations/<key>.webp, served at ui/illustrations/. */
export const AVATAR_KEYS = [
  'cat',
  'dog',
  'lion',
  'panda',
  'rabbit',
  'tiger',
  'fox',
  'koala',
  'monkey',
  'penguin',
  'frog',
  'unicorn',
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

export type IllustrationKey =
  | 'subject-english'
  | 'subject-hindi'
  | 'subject-maths'
  | 'subject-evs'
  | 'act-lesson'
  | 'act-readalong'
  | 'act-worksheet'
  | 'act-tables'
  | 'act-grammar'
  | 'act-quiz'
  | 'act-mistakes'
  | 'act-reading'
  | 'reward-star'
  | 'celebrate'
  | 'empty-books'
  | 'empty-done'
  | 'state-offline'
  | 'state-retry'
  | 'state-wait'
  | 'mascot-owl'
  | 'level-seed'
  | 'level-plant'
  | 'level-tree'
  | `avatar-${AvatarKey}`;

/** Relative to the app's base href, so it works under /studio/ too. */
export function illustrationUrl(key: IllustrationKey): string {
  return `ui/illustrations/${key}.webp`;
}

/** Every illustration key, e.g. for lesson scene visuals (Schema §5 lesson.body.schema.json). */
export const ILLUSTRATION_KEYS: readonly IllustrationKey[] = [
  'subject-english',
  'subject-hindi',
  'subject-maths',
  'subject-evs',
  'act-lesson',
  'act-readalong',
  'act-worksheet',
  'act-tables',
  'act-grammar',
  'act-quiz',
  'act-mistakes',
  'act-reading',
  'reward-star',
  'celebrate',
  'empty-books',
  'empty-done',
  'state-offline',
  'state-retry',
  'state-wait',
  'mascot-owl',
  'level-seed',
  'level-plant',
  'level-tree',
  ...AVATAR_KEYS.map((animal) => `avatar-${animal}` as const),
];
