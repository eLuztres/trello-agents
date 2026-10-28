// Puts every open card's number in front of its name ("#123 Fix the cart"). New cards get it from the daemon.
import { CONFIG } from '../config.ts';
import { numberedName } from './numbering.ts';
import { trello } from './trello.ts';

const cards = await trello.getOpenCards(CONFIG.boardId);
let renamed = 0;
for (const card of cards) {
  const name = numberedName(card.idShort, card.name);
  if (name === card.name) continue;
  await trello.renameCard(card.id, name);
  renamed++;
}
console.log(`${renamed} of ${cards.length} cards numbered.`);
