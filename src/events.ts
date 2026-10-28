import type { TrelloAction } from './trello.ts';

export type AgentStage = 'plan' | 'build' | 'review';
/** Plain git, no agent: your own move into their list is your OK to commit or push. */
export type GitStage = 'commit' | 'push';
export type Stage = AgentStage | GitStage;

export const isGitStage = (stage: Stage): stage is GitStage => stage === 'commit' || stage === 'push';

/** Marks comments written by the agents, so they don't trigger new runs. */
export const BOT_PREFIX = '🤖';

export type CardEvent =
  | { kind: 'moved'; cardId: string; stage: Stage | null }
  | { kind: 'commented'; cardId: string; text: string };

export function toCardEvent(action: TrelloAction, stageByListId: Record<string, Stage>, myMemberId: string): CardEvent | null {
  // Only your own actions count: card text becomes instructions for an agent in auto mode.
  if (action.idMemberCreator !== myMemberId || !action.data.card) return null;
  const cardId = action.data.card.id;

  switch (action.type) {
    case 'createCard':
      return movedTo(cardId, action.data.list?.id, stageByListId);
    case 'updateCard':
      return action.data.listAfter ? movedTo(cardId, action.data.listAfter.id, stageByListId) : null;
    case 'commentCard': {
      const text = action.data.text ?? '';
      return text.startsWith(BOT_PREFIX) ? null : { kind: 'commented', cardId, text };
    }
    default:
      return null;
  }
}

function movedTo(cardId: string, listId: string | undefined, stageByListId: Record<string, Stage>): CardEvent | null {
  return listId ? { kind: 'moved', cardId, stage: stageByListId[listId] ?? null } : null;
}
