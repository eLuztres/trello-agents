import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const API_URL = 'https://api.trello.com/1';
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 2000;

export interface TrelloAction {
  id: string;
  type: string;
  idMemberCreator: string;
  data: {
    card?: { id: string };
    list?: { id: string };
    listAfter?: { id: string };
    text?: string;
  };
}

export interface TrelloCard {
  id: string;
  idShort: number;
  idList: string;
  name: string;
  desc: string;
  shortUrl: string;
  labels: { name: string }[];
}

export interface TrelloList {
  id: string;
  name: string;
}

function authHeader(): string {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) throw new Error('Set TRELLO_API_KEY and TRELLO_TOKEN in .env');
  // Header auth keeps the token out of URLs and logs.
  return `OAuth oauth_consumer_key="${key}", oauth_token="${token}"`;
}

async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, params: Record<string, string> | FormData = {}): Promise<T> {
  const url = new URL(API_URL + path);
  const isGet = method === 'GET';
  if (isGet && !(params instanceof FormData)) Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  for (let attempt = 1; ; attempt++) {
    const isLastAttempt = attempt === MAX_ATTEMPTS;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { Authorization: authHeader(), Accept: 'application/json' },
        body: isGet ? undefined : params instanceof FormData ? params : new URLSearchParams(params),
      });
    } catch (error) {
      // Usually a kept-alive socket Trello closed while an agent was working.
      if (isLastAttempt) throw new Error(`Trello ${method} ${path} failed: ${describeNetworkError(error)}`);
      await sleep(RETRY_DELAY_MS * attempt);
      continue;
    }

    const isRetryable = response.status === 429 || response.status >= 500;
    if (isRetryable && !isLastAttempt) {
      await sleep(RETRY_DELAY_MS * attempt);
      continue;
    }
    if (!response.ok) throw new Error(`Trello ${method} ${path} failed: ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  }
}

function describeNetworkError(error: unknown): string {
  const { message, cause } = error as Error & { cause?: Error & { code?: string } };
  return cause ? `${message} (${cause.code ?? cause.message})` : message;
}

export const trello = {
  getMe: () => request<{ id: string; username: string }>('GET', '/members/me', { fields: 'id,username' }),

  getLists: (boardId: string) => request<TrelloList[]>('GET', `/boards/${boardId}/lists`, { fields: 'id,name' }),

  getLabels: (boardId: string) => request<TrelloList[]>('GET', `/boards/${boardId}/labels`, { fields: 'id,name' }),

  /** Newest first. */
  getBoardActions: (boardId: string, sinceActionId?: string) =>
    request<TrelloAction[]>('GET', `/boards/${boardId}/actions`, {
      filter: 'createCard,updateCard,commentCard',
      limit: '100',
      ...(sinceActionId && { since: sinceActionId }),
    }),

  getCard: (cardId: string) =>
    request<TrelloCard>('GET', `/cards/${cardId}`, { fields: 'idShort,idList,name,desc,shortUrl,labels' }),

  /** Newest first. */
  getComments: (cardId: string) =>
    request<TrelloAction[]>('GET', `/cards/${cardId}/actions`, { filter: 'commentCard', limit: '50' }),

  addComment: (cardId: string, text: string) => request('POST', `/cards/${cardId}/actions/comments`, { text }),

  moveCard: (cardId: string, listId: string) => request('PUT', `/cards/${cardId}`, { idList: listId }),

  setDescription: (cardId: string, desc: string) => request('PUT', `/cards/${cardId}`, { desc }),

  attachFile: async (cardId: string, filePath: string) => {
    const form = new FormData();
    form.set('file', new Blob([await readFile(filePath)]), path.basename(filePath));
    return request<{ url: string; name: string }>('POST', `/cards/${cardId}/attachments`, form);
  },

  renameCard: (cardId: string, name: string) => request('PUT', `/cards/${cardId}`, { name }),

  getOpenCards: (boardId: string) => request<TrelloCard[]>('GET', `/boards/${boardId}/cards/open`, { fields: 'idShort,name' }),
};
