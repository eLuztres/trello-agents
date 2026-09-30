// Shows every card the agents touched, with the command to jump into its session.
import { loadState } from './state.ts';

const { cards } = loadState();
const entries = Object.values(cards);
if (entries.length === 0) console.log('No cards yet.');

for (const card of entries) {
  console.log(`#${card.idShort} ${card.name}`);
  console.log(`  ${card.lastStage ?? '-'}: ${card.lastStatus ?? '-'} · ${card.repo} · ${card.branch}`);
  console.log(`  log:       tail -f logs/card-${card.idShort}.log`);
  if (card.devSessionId) console.log(`  developer: cd ${card.worktree} && claude --resume ${card.devSessionId}`);
  if (card.reviewSessionId) console.log(`  reviewer:  cd ${card.worktree} && claude --resume ${card.reviewSessionId}`);
  console.log();
}
