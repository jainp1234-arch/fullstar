/**
 * Every piece of user-facing text (Guidelines §1, §15, §16). Components read text only from here.
 * Kid mode: 8 words or fewer, at most one exclamation mark. Parent mode and Studio: no exclamation
 * marks. Sentence case everywhere.
 */
export const EN = {
  app: {
    name: 'FullStar',
    studioName: 'FullStar Studio',
  },

  subjects: {
    english: 'English',
    hindi: 'Hindi',
    maths: 'Maths',
    evs: 'EVS',
  },

  /** "Class 3", never "Grade 3" (§15). */
  classLevel: (level: number) => `Class ${level}`,

  nav: {
    kid: { learn: 'Learn', practice: 'Practice', read: 'Read' },
    parent: {
      progress: 'Progress',
      books: 'Books',
      worksheets: 'Worksheets',
      settings: 'Settings',
    },
    studio: {
      dashboard: 'Dashboard',
      uploads: 'Uploads queue',
      library: 'Library',
      questionBank: 'Question bank',
      contentCheck: 'Content check',
      reports: 'Reports',
    },
    back: 'Back',
    close: 'Close',
    parentButton: 'Parent mode',
    messages: 'Messages',
  },

  /** Message patterns (§16). */
  kid: {
    correct: "Yes! That's right.",
    notCorrect: "Let's try again.",
    finished: (stars: number) => `Well done! You got ${stars} ${stars === 1 ? 'star' : 'stars'}.`,
    somethingFailed: "Let's try again.",
    tryAgain: 'Try again',
    lessonNotReady: 'Coming soon! Read along for now.',
    offline: 'This needs the internet.',
    needsParent: 'Ask Mummy or Papa to help.',
  },

  parent: {
    somethingFailed: 'Something went wrong on our side. Please try again in a few minutes.',
    tryAgain: 'Try again',
    noBook: 'No book yet. Upload it so we can prepare lessons. Practice is ready meanwhile.',
    uploadBook: 'Upload book',
    lessonsPreparing: "Lessons being prepared. We'll message you when they're ready.",
    offline: "You're offline. Some features are paused.",
    lessonsReady: (subject: string, chapter: number) =>
      `Lessons for ${subject} Ch ${chapter} are ready. We recommend a quick preview.`,
    uploadProblem: (pages: number, subject: string) =>
      `${pages} ${pages === 1 ? 'page' : 'pages'} of your ${subject} book were unclear. Retake just those pages.`,
    fixPages: 'Fix pages',
    eraseProgressTitle: (classLevel: number) => `Erase Class ${classLevel} progress?`,
    eraseProgress: 'Erase progress',
    keepProgress: 'Keep progress',
  },

  a11y: {
    /** Time indicator (§11): no visible text, read by screen readers. */
    timeToday: (used: number, limit: number) => `Time today: ${used} of ${limit} minutes`,
    stars: (count: number) => `${count} ${count === 1 ? 'star' : 'stars'}`,
    readAloud: 'Read aloud',
    loading: 'Loading',
  },

  /** Alt text for every illustration (§14). */
  illustrations: {
    'subject-english': 'English book',
    'subject-hindi': 'Hindi book',
    'subject-maths': 'Maths abacus',
    'subject-evs': 'EVS seedling',
    'act-lesson': 'Lesson',
    'act-readalong': 'Read along',
    'act-worksheet': 'Worksheet',
    'act-tables': 'Tables',
    'act-grammar': 'Grammar',
    'act-quiz': 'Quiz',
    'act-mistakes': 'Fix my mistakes',
    'act-reading': 'Reading test',
    'reward-star': 'Star',
    celebrate: 'Party popper',
    'empty-books': 'Books',
    'empty-done': 'Trophy',
    'state-offline': 'Offline',
    'state-retry': 'Thinking face',
    'state-wait': 'Coming soon',
    'mascot-owl': 'The owl',
    'avatar-cat': 'Cat',
    'avatar-dog': 'Dog',
    'avatar-lion': 'Lion',
    'avatar-panda': 'Panda',
    'avatar-rabbit': 'Rabbit',
    'avatar-tiger': 'Tiger',
    'avatar-fox': 'Fox',
    'avatar-koala': 'Koala',
    'avatar-monkey': 'Monkey',
    'avatar-penguin': 'Penguin',
    'avatar-frog': 'Frog',
    'avatar-unicorn': 'Unicorn',
  },
} as const;

export type Strings = typeof EN;
