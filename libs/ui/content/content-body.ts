/**
 * Content formats of Schema §5 (content_versions.body and solution). The API checks them against
 * services/api/src/main/resources/schemas before saving. Shared by the Studio editors (S5) and the
 * kid-mode preview.
 */

export type ContentKind = 'lesson' | 'question' | 'passage';
export type QuestionType = 'mcq' | 'true_false' | 'fill_blank' | 'match';
export type SceneAnimation = 'fade-up' | 'slide-in' | 'pop' | 'none';

export const SCENE_ANIMATIONS: readonly SceneAnimation[] = ['fade-up', 'slide-in', 'pop', 'none'];
export const QUESTION_TYPES: readonly QuestionType[] = ['mcq', 'true_false', 'fill_blank', 'match'];

export interface SceneVisual {
  /** An illustration key from libs/ui (Guidelines §9). */
  readonly illustration: string;
  readonly animation: SceneAnimation;
}

/** A narration scene has text; a quiz scene has quiz. Never both. */
export interface LessonScene {
  readonly id: string;
  readonly duration_ms: number;
  readonly text?: string | null;
  readonly visual?: SceneVisual | null;
  readonly quiz?: { readonly question_item_id: string } | null;
}

export interface LessonBody {
  readonly scenes: readonly LessonScene[];
}

export interface ChoiceOption {
  readonly id: string;
  readonly text: string;
}

export interface McqBody {
  readonly prompt: string;
  readonly image_key?: string | null;
  readonly options: readonly ChoiceOption[];
}

export interface McqSolution {
  readonly correct: readonly [string];
  readonly explanation: string;
}

export interface TrueFalseBody {
  readonly prompt: string;
}

export interface TrueFalseSolution {
  readonly correct: boolean;
  readonly explanation: string;
}

export interface FillBlankBody {
  /** Marks the blank with ___. */
  readonly prompt: string;
  readonly choices: readonly string[];
}

export interface FillBlankSolution {
  readonly correct: string;
  readonly explanation: string;
}

export interface MatchBody {
  readonly prompt: string;
  readonly left: readonly ChoiceOption[];
  readonly right: readonly ChoiceOption[];
}

export interface MatchSolution {
  readonly pairs: readonly (readonly [string, string])[];
  readonly explanation: string;
}

export interface PassageBody {
  readonly text: string;
  readonly word_count: number;
  /** 1 (easy) to 3 (hard). */
  readonly level: number;
}

/** A question with its type, body and solution kept together so they always match. */
export type QuestionContent =
  | { readonly type: 'mcq'; readonly body: McqBody; readonly solution: McqSolution }
  | {
      readonly type: 'true_false';
      readonly body: TrueFalseBody;
      readonly solution: TrueFalseSolution;
    }
  | {
      readonly type: 'fill_blank';
      readonly body: FillBlankBody;
      readonly solution: FillBlankSolution;
    }
  | { readonly type: 'match'; readonly body: MatchBody; readonly solution: MatchSolution };

export type ContentValue =
  | { readonly kind: 'lesson'; readonly body: LessonBody }
  | { readonly kind: 'passage'; readonly body: PassageBody }
  | ({ readonly kind: 'question' } & QuestionContent);

/** Words in a passage, counted like the API (runs of non-space characters). */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * A saved body and solution as typed content. The API checked them against Schema §5 before
 * saving, so the shapes are trusted here.
 */
export function contentValue(
  kind: ContentKind,
  questionType: QuestionType | null,
  body: unknown,
  solution: unknown,
): ContentValue {
  switch (kind) {
    case 'lesson':
      return { kind, body: body as LessonBody };
    case 'passage':
      return { kind, body: body as PassageBody };
    case 'question':
      return { kind, type: questionType ?? 'mcq', body, solution } as ContentValue;
  }
}

/** The body and (questions only) solution to send to the API. */
export function bodyAndSolution(value: ContentValue): { body: unknown; solution?: unknown } {
  return value.kind === 'question'
    ? { body: value.body, solution: value.solution }
    : { body: value.body };
}
