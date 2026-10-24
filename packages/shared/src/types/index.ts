import { z } from 'zod';

export const QuestionFormatSchema = z.enum([
  'multiple_choice',
  'short_answer',
  'ordered_list',
  'matching',
]);
export type QuestionFormat = z.infer<typeof QuestionFormatSchema>;

export const EventStateSchema = z.enum([
  'draft',
  'ready',
  'lobby',
  'rules',
  'section_active',
  'question_revealed',
  'answer_open',
  'answer_closed',
  'section_marking',
  'section_reveal',
  'finished',
  'abandoned',
]);
export type EventState = z.infer<typeof EventStateSchema>;

export const QuestionStatusSchema = z.enum([
  'draft',
  'proposed',
  'approved',
  'dismissed',
  'reserved',
  'used',
  'revealed_abandoned',
]);
export type QuestionStatus = z.infer<typeof QuestionStatusSchema>;

export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const RoleSchema = z.enum(['host', 'team', 'wallboard']);
export type Role = z.infer<typeof RoleSchema>;

export interface MultipleChoiceSpec {
  options: { id: string; label: string }[];
  correctOptionIds: string[];
}

export interface ShortAnswerSpec {
  acceptedAnswers: string[];
  caseSensitive?: boolean;
}

export interface OrderedListSpec {
  items: { id: string; label: string }[];
  correctOrder: string[];
}

export interface MatchingSpec {
  left: { id: string; label: string }[];
  right: { id: string; label: string }[];
  pairs: { leftId: string; rightId: string }[];
}

export type AnswerSpec =
  | { format: 'multiple_choice'; data: MultipleChoiceSpec }
  | { format: 'short_answer'; data: ShortAnswerSpec }
  | { format: 'ordered_list'; data: OrderedListSpec }
  | { format: 'matching'; data: MatchingSpec };

export interface QuestionContent {
  id: string;
  format: QuestionFormat;
  wording: string;
  answerSpec: AnswerSpec;
  rubric: string;
  difficulty: Difficulty;
  themeTags: string[];
  points: number;
  timingSeconds: number;
  sourceReferences?: string[];
  sourcesVerified?: boolean;
  mediaImageId?: string | null;
  mediaAudioId?: string | null;
  mediaVideoId?: string | null;
  /** Audience-safe colour shown on wall/phones during answer reveal */
  revealFact?: string | null;
  /** Answer-sheet image — reveal only, never during the live question */
  revealImageId?: string | null;
  hostNotes?: string;
}

export interface ScoreComponents {
  answerPoints: number;
  speedPoints: number;
  bonusEffect: number;
  wagerEffect: number;
  hostAdjustment: number;
}

export function totalScore(c: ScoreComponents): number {
  return (
    c.answerPoints +
    c.speedPoints +
    c.bonusEffect +
    c.wagerEffect +
    c.hostAdjustment
  );
}
