import { z } from 'zod';
import { EventStateSchema } from '../types/index.js';

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth'),
    token: z.string(),
  }),
  z.object({
    type: z.literal('ping'),
  }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export const TimerSnapshotSchema = z.object({
  remainingMs: z.number(),
  deadlineAt: z.number().nullable(),
  paused: z.boolean(),
  /** Original question timing (ms); used for countdown ring progress */
  durationMs: z.number().nullable().optional(),
});

export type TimerSnapshot = z.infer<typeof TimerSnapshotSchema>;

/** Role-filtered public snapshots — never include secrets/keys in wall/team. */
export interface WallboardSnapshot {
  role: 'wallboard';
  eventId: string;
  eventCode: string;
  eventName: string;
  seriesName: string;
  state: z.infer<typeof EventStateSchema>;
  sectionTitle?: string | null;
  sectionTheme?: string | null;
  /** Prefetched local media URLs for Get Ready mosaic */
  topicImageUrls?: string[] | null;
  sectionIndex?: number | null;
  sectionCount?: number | null;
  questionNumber?: number | null;
  questionWording?: string | null;
  questionFormat?: string | null;
  choices?: { id: string; label: string }[] | null;
  mediaImageUrl?: string | null;
  mediaAudioUrl?: string | null;
  mediaVideoUrl?: string | null;
  audioPlaying?: boolean;
  timer?: TimerSnapshot | null;
  answerClosed?: boolean;
  /** Practice section — scores shown but not final */
  isDemoSection?: boolean;
  /** One answer at a time during section reveal */
  revealAnswer?: {
    index: number;
    total: number;
    wording: string;
    correctDisplay: string;
    /** Short audience-safe trivia colour */
    revealFact?: string | null;
    /** Answer-sheet image (reveal only) */
    imageUrl?: string | null;
    /** First fully correct — speed point winner */
    speedWinner?: {
      teamName: string;
      avatarId: string;
      /** Wall-clock ms from answer open → their submission */
      responseMs: number | null;
    } | null;
    /** Teams that wagered on this question (won/lost from marks) */
    wagers?: {
      teamName: string;
      avatarId: string;
      outcome: 'won' | 'lost';
    }[];
  } | null;
  standings?: {
    rank: number;
    teamName: string;
    avatarId: string;
    /** Player names registered with the team */
    members: string[];
    sectionScore: number;
    score: number;
    /** Wagers still available tonight */
    wagersRemaining: number;
    /**
     * Bonus nomination status for the night:
     * - this_section: used on the section just scored
     * - used: bonus already consumed earlier
     * - remaining: nominated a later section
     * - none: no nomination
     */
    bonusStatus: 'this_section' | 'used' | 'remaining' | 'none';
  }[] | null;
  /** Teams whose bonus applied to the section just scored (running scores only) */
  bonusTeamsThisSection?: {
    teamName: string;
    avatarId: string;
  }[] | null;
  joinUrl?: string | null;
  /** Teams that have wagered on the current open question (live) */
  activeWagers?: {
    teamName: string;
    avatarId: string;
  }[] | null;
}

export interface TeamPlaySnapshot {
  role: 'team';
  eventId: string;
  teamId: string;
  teamName: string;
  avatarId: string;
  /** Funny submit buzzer assigned at join */
  buzzerId: string;
  state: z.infer<typeof EventStateSchema>;
  sectionTitle?: string | null;
  sectionTheme?: string | null;
  topicImageUrls?: string[] | null;
  currentQuestionId?: string | null;
  questionNumber?: number | null;
  questionFormat?: string | null;
  /** Present once the question is on the wall (revealed / answers open) */
  questionWording?: string | null;
  mediaImageUrl?: string | null;
  mediaAudioUrl?: string | null;
  mediaVideoUrl?: string | null;
  /** Option / list labels only — never answer keys */
  optionLabels?: { id: string; label: string }[] | null;
  matchLeft?: { id: string; label: string }[] | null;
  matchRight?: { id: string; label: string }[] | null;
  orderItems?: { id: string; label: string }[] | null;
  timer?: TimerSnapshot | null;
  answerWindowOpen: boolean;
  paused: boolean;
  submissionAck?: {
    receivedAt: string;
    revision: number;
    /** Team's own latest payload — safe to echo back for revise UX */
    payload: unknown;
    /** Human-readable summary of the submitted answer */
    display: string;
  } | null;
  wagersRemaining: number;
  wagerActive: boolean;
  bonusSectionId: string | null;
  /** True when the active section is this team's nominated bonus section */
  inBonusSection: boolean;
  /** Practice round — scores do not count toward the night */
  isDemoSection?: boolean;
  bonusLocked: boolean;
  connected: boolean;
  submissionAuthority: boolean;
  /** Wall is on answers or standings during section_reveal */
  revealPhase?: 'answers' | 'standings' | null;
  /** Own official total when standings are public */
  myScore?: number | null;
  myRank?: number | null;
  /** Synced to wall reveal index during answer reveal */
  revealCard?: {
    index: number;
    total: number;
    wording: string;
    correctDisplay: string;
    yourAnswerDisplay: string | null;
    markOutcome: 'correct' | 'incorrect' | 'partial' | 'unanswered' | null;
    revealFact?: string | null;
    /** Answer-sheet image (reveal only) */
    imageUrl?: string | null;
  } | null;
}

export interface HostSnapshot {
  role: 'host';
  eventId: string;
  eventCode: string;
  state: z.infer<typeof EventStateSchema>;
  sectionId?: string | null;
  questionId?: string | null;
  /** Current section: answers open automatically shortly after reveal */
  autoOpenAnswers?: boolean;
  preview?: {
    wording: string;
    answerSummary: string;
    rubric: string;
    points: number;
    timingSeconds: number;
  } | null;
  timer?: TimerSnapshot | null;
  teams: {
    id: string;
    name: string;
    avatarId: string;
    members: string[];
    /** Host-only — never sent to wall or team clients */
    pin: string | null;
    connected: boolean;
    hasAnswered: boolean;
    wagerActive: boolean;
    score: number;
    wagersRemaining: number;
    /** True when current section is this team's bonus */
    inBonusSection: boolean;
  }[];
  privateTotals: {
    teamId: string;
    teamName: string;
    avatarId: string;
    members: string[];
    score: number;
    wagersRemaining: number;
    bonusStatus: 'this_section' | 'used' | 'remaining' | 'none';
  }[];
  /** Teams whose bonus applied to the current/completed section */
  bonusTeamsThisSection?: {
    teamName: string;
    avatarId: string;
  }[] | null;
  /** Progressive answer reveal on the wall */
  reveal?: {
    showingAnswers: boolean;
    showingStandings: boolean;
    answerIndex: number | null;
    answerTotal: number;
    /** Wagers on the currently revealed answer (when showingAnswers) */
    wagers?: {
      teamName: string;
      avatarId: string;
      outcome: 'won' | 'lost';
    }[];
  } | null;
  isDemoSection?: boolean;
  allowedTransitions: string[];
}

export type RoleSnapshot = WallboardSnapshot | TeamPlaySnapshot | HostSnapshot;

export type WsServerMessage =
  | { type: 'snapshot'; payload: RoleSnapshot }
  | { type: 'error'; message: string }
  | { type: 'pong' }
  | { type: 'ack'; of: string };
