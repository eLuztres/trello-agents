// Prints the board's lists and labels, to check the names in config.ts.
import { CONFIG } from '../config.ts';
import { trello } from './trello.ts';

const [me, lists, labels] = await Promise.all([
  trello.getMe(),
  trello.getLists(CONFIG.boardId),
  trello.getLabels(CONFIG.boardId),
]);

console.log(`Signed in as @${me.username}\n`);
console.log('Lists:');
for (const list of lists) {
  const stage = Object.entries(CONFIG.lists).find(([, names]) => names.includes(list.name))?.[0];
  console.log(`  ${list.name}${stage ? `  → ${stage} agent` : ''}`);
}
console.log('\nLabels (a label named like a repo picks it):');
for (const label of labels) {
  console.log(`  ${label.name || '(no name)'}${CONFIG.repos[label.name] ? '  → repo' : ''}`);
}
