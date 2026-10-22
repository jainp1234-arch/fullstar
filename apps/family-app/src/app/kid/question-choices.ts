import { AnswerLetter, EN, QuestionContent } from '@fullstar/ui';

const LETTERS: readonly AnswerLetter[] = ['A', 'B', 'C', 'D'];

export interface Choice {
  readonly letter: AnswerLetter;
  readonly text: string;
  readonly correct: boolean;
  /** What the answer event records (Schema §4.4 answer_events.answer). */
  readonly answer: unknown;
}

/** The A–D answers of a question; match questions show pairs instead (none here). */
export function choicesOf(question: QuestionContent): readonly Choice[] {
  switch (question.type) {
    case 'mcq':
      return question.body.options.map((option, i) => ({
        letter: LETTERS[i],
        text: option.text,
        correct: option.id === question.solution.correct[0],
        answer: { selected: [option.id] },
      }));
    case 'true_false':
      return [true, false].map((value, i) => ({
        letter: LETTERS[i],
        text: value ? EN.preview.trueLabel : EN.preview.falseLabel,
        correct: question.solution.correct === value,
        answer: { value },
      }));
    case 'fill_blank':
      return question.body.choices.map((choice, i) => ({
        letter: LETTERS[i],
        text: choice,
        correct: choice.trim() === question.solution.correct.trim(),
        answer: { text: choice },
      }));
    case 'match':
      return [];
  }
}

/** The left–right pairs of a match question, for showing once the child has thought. */
export function pairsOf(question: QuestionContent): readonly { left: string; right: string }[] {
  if (question.type !== 'match') {
    return [];
  }
  const right = new Map(question.body.right.map((item) => [item.id, item.text]));
  const partner = new Map(question.solution.pairs.map(([l, r]) => [l, right.get(r) ?? '']));
  return question.body.left.map((item) => ({ left: item.text, right: partner.get(item.id) ?? '' }));
}
