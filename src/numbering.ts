import { trello } from './trello.ts';

/** "Fix the cart" → "#123 Fix the cart"; a name that already starts with its number stays as it is. */
export function numberedName(idShort: number, name: string): string {
  const prefix = `#${idShort} `;
  return name.startsWith(prefix) ? name : prefix + name.replace(/^#\d+\s+/, '');
}

// Trello hides card numbers on the board, so they go into the names.
export async function numberCard(cardId: string): Promise<void> {
  const card = await trello.getCard(cardId);
  const name = numberedName(card.idShort, card.name);
  if (name !== card.name) await trello.renameCard(cardId, name);
}
