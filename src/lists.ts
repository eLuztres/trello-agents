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
  const restingRoles: Record<string, string> = {
    [CONFIG.plannedList]: '  → finished plans rest here',
    [CONFIG.backlogList]: '  → plans with questions come back here',
    [CONFIG.uncommittedList]: '  → ready reviews wait here',
  };
  const role = stage ? `  → ${stage}` : (restingRoles[list.name] ?? '');
  console.log(`  ${list.name}${role}`);
}
console.log('\nLabels (a label named like a repo picks it):');
for (const label of labels) {
  console.log(`  ${label.name || '(no name)'}${CONFIG.repos[label.name] ? '  → repo' : ''}`);
}
