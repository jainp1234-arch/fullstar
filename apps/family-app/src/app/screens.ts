import { EN, ScreenConfig, ScreenDef } from '@fullstar/ui';

/**
 * Every family app screen (App Flow §4–§6) with its shell (Guidelines §10). Back goes to the
 * parent; links are the other screens a screen leads to.
 */
const SCREENS: readonly ScreenDef[] = [
  // Sign-up, sign-in and setup (App Flow §4)
  { id: 'A1', path: 'welcome', shell: 'focus', mode: 'parent', links: ['A2'] },
  { id: 'A2', path: 'sign-in/email', shell: 'focus', mode: 'parent', parent: 'A1', links: ['A3'] },
  {
    id: 'A3',
    path: 'sign-in/code',
    shell: 'focus',
    mode: 'parent',
    parent: 'A2',
    links: ['B1', 'C1'],
  },
  { id: 'A4', path: 'parent/forgot-pin', shell: 'focus', mode: 'parent', parent: 'P0' },
  { id: 'B1', path: 'setup/pin', shell: 'focus', mode: 'parent', links: ['B2'] },
  { id: 'B2', path: 'setup/child', shell: 'focus', mode: 'parent', parent: 'B1', links: ['B3'] },
  { id: 'B3', path: 'setup/books', shell: 'focus', mode: 'parent', parent: 'B2', links: ['B4'] },
  {
    id: 'B4',
    path: 'setup/time-limit',
    shell: 'focus',
    mode: 'parent',
    parent: 'B3',
    links: ['B5'],
  },
  { id: 'B5', path: 'setup/done', shell: 'celebration', mode: 'parent', links: ['C1'] },

  // Kid mode (App Flow §5)
  { id: 'C1', path: 'who', shell: 'sky-list', mode: 'kid', nav: false, links: ['K1', 'P0'] },
  { id: 'K1', path: 'kid/learn', shell: 'sky-list', mode: 'kid', tab: 'learn' },
  {
    id: 'K2',
    path: 'kid/learn/:subject',
    sample: 'kid/learn/english',
    shell: 'sky-list',
    mode: 'kid',
    parent: 'K1',
  },
  {
    id: 'K3',
    path: 'kid/learn/:subject/:chapter',
    sample: 'kid/learn/english/1',
    shell: 'sky-sheet',
    mode: 'kid',
    parent: 'K2',
  },
  {
    id: 'K4',
    path: 'kid/lesson/:lessonId',
    sample: 'kid/lesson/sample',
    shell: 'focus',
    mode: 'kid',
    parent: 'K3',
  },
  {
    id: 'K5',
    path: 'kid/read-along/:chapterId',
    sample: 'kid/read-along/sample',
    shell: 'focus',
    mode: 'kid',
    parent: 'K3',
  },
  {
    id: 'K6',
    path: 'kid/worksheet/:worksheetId',
    sample: 'kid/worksheet/sample',
    shell: 'focus',
    mode: 'kid',
    parent: 'K3',
  },
  { id: 'K7', path: 'kid/well-done', shell: 'celebration', mode: 'kid', parent: 'K6' },
  { id: 'K8', path: 'kid/practice', shell: 'sky-list', mode: 'kid', tab: 'practice' },
  {
    id: 'K9',
    path: 'kid/practice/set/:topic',
    sample: 'kid/practice/set/nouns',
    shell: 'focus',
    mode: 'kid',
    parent: 'K8',
  },
  { id: 'K10', path: 'kid/practice/tables', shell: 'focus', mode: 'kid', parent: 'K8' },
  { id: 'K11', path: 'kid/practice/mistakes', shell: 'focus', mode: 'kid', parent: 'K8' },
  { id: 'K12', path: 'kid/read', shell: 'sky-list', mode: 'kid', tab: 'read' },
  { id: 'K13', path: 'kid/read/test', shell: 'focus', mode: 'kid', parent: 'K12' },
  { id: 'K14', path: 'kid/read/result', shell: 'celebration', mode: 'kid', parent: 'K13' },

  // Parent mode (App Flow §6)
  { id: 'P0', path: 'parent/pin', shell: 'focus', mode: 'parent', parent: 'C1', links: ['P1'] },
  { id: 'P1', path: 'parent/progress', shell: 'sky-sheet', mode: 'parent', tab: 'progress' },
  {
    id: 'P2',
    path: 'parent/progress/subject/:subject',
    sample: 'parent/progress/subject/english',
    shell: 'sky-sheet',
    mode: 'parent',
    parent: 'P1',
  },
  {
    id: 'P3',
    path: 'parent/progress/reading',
    shell: 'sky-sheet',
    mode: 'parent',
    parent: 'P1',
  },
  { id: 'P4', path: 'parent/books', shell: 'sky-sheet', mode: 'parent', tab: 'books' },
  ...(
    [
      ['P5', 'upload'],
      ['P6', 'chapters'],
      ['P7', 'add-chapter'],
      ['P8', 'fix-pages'],
      ['P8a', 'preview'],
      ['P9', 'replace'],
    ] as const
  ).map(([id, page]): ScreenDef => ({
    id,
    path: `parent/books/:subject/${page}`,
    sample: `parent/books/english/${page}`,
    shell: 'sky-sheet',
    mode: 'parent',
    parent: 'P4',
  })),
  { id: 'P10', path: 'parent/worksheets', shell: 'sky-sheet', mode: 'parent', tab: 'worksheets' },
  {
    id: 'P11',
    path: 'parent/worksheets/new',
    shell: 'sky-sheet',
    mode: 'parent',
    parent: 'P10',
  },
  {
    id: 'P12',
    path: 'parent/worksheets/:worksheetId/print',
    sample: 'parent/worksheets/sample/print',
    shell: 'sky-sheet',
    mode: 'parent',
    parent: 'P10',
  },
  {
    id: 'P13',
    path: 'parent/worksheets/:worksheetId/solutions',
    sample: 'parent/worksheets/sample/solutions',
    shell: 'sky-sheet',
    mode: 'parent',
    parent: 'P10',
  },
  { id: 'P14', path: 'parent/settings', shell: 'sky-sheet', mode: 'parent', tab: 'settings' },
  {
    id: 'P15',
    path: 'parent/settings/children/:childId',
    sample: 'parent/settings/children/sample',
    shell: 'sky-sheet',
    mode: 'parent',
    parent: 'P14',
  },
  { id: 'P16', path: 'parent/settings/help', shell: 'sky-sheet', mode: 'parent', parent: 'P14' },
  {
    id: 'P17',
    path: 'parent/settings/privacy',
    shell: 'sky-sheet',
    mode: 'parent',
    parent: 'P14',
  },
  { id: 'P18', path: 'parent/report', shell: 'sky-sheet', mode: 'parent', parent: 'P8a' },
  { id: 'P19', path: 'parent/messages', shell: 'sky-sheet', mode: 'parent', parent: 'P1' },
];

export const FAMILY_SCREENS: ScreenConfig = {
  appName: EN.app.name,
  screens: SCREENS,
  family: { who: 'C1', parentPin: 'P0', messages: 'P19' },
  nav: {
    kid: [
      { tab: 'learn', label: EN.nav.kid.learn, icon: 'school', screen: 'K1' },
      { tab: 'practice', label: EN.nav.kid.practice, icon: 'extension', screen: 'K8' },
      { tab: 'read', label: EN.nav.kid.read, icon: 'record_voice_over', screen: 'K12' },
    ],
    parent: [
      { tab: 'progress', label: EN.nav.parent.progress, icon: 'insights', screen: 'P1' },
      { tab: 'books', label: EN.nav.parent.books, icon: 'menu_book', screen: 'P4' },
      { tab: 'worksheets', label: EN.nav.parent.worksheets, icon: 'assignment', screen: 'P10' },
      { tab: 'settings', label: EN.nav.parent.settings, icon: 'settings', screen: 'P14' },
    ],
  },
};
