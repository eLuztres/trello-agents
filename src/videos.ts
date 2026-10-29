// The review page: every ticket with what its agent did, its video, and a chat with that agent.
// Messages go to the card as your comments, which the daemon hands to the card's own agent session.
// Cards link to it as http://localhost:4500/#card-<n>.
import { createReadStream, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { CONFIG } from '../config.ts';
import { BOT_PREFIX } from './events.ts';
import { REVIEW_VIDEO_DIR } from './stages.ts';
import { loadState } from './state.ts';
import { trello, type TrelloList } from './trello.ts';

const PORT = 4500;
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const MAX_MESSAGE_LENGTH = 5000;
// OpenAI's limit for one audio file.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TRANSCRIBE_LANGUAGES = new Set(['en', 'es', 'de']);
const VIDEO_DIR = REVIEW_VIDEO_DIR;
const MEDIA_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif', '.mov': 'video/quicktime' };
/** Lists whose agent reacts to a comment today. */
const AGENT_LISTS = new Set(Object.values(CONFIG.lists).flat());

interface VideoFile {
  name: string;
  card: number | null;
  modifiedAt: number;
}

interface TicketSummary {
  number: number;
  name: string;
  status: string;
  videos: string[];
  updatedAt: number;
}

/** "card-130-video-gallery.mp4" (or the older "baifo-card-130-…") belongs to card #130. */
function cardNumberOf(fileName: string): number | null {
  const match = fileName.match(/(?:^|-)card-(\d+)/);
  return match ? Number(match[1]) : null;
}

function listVideos(): VideoFile[] {
  return readdirSync(VIDEO_DIR)
    .filter((name) => MEDIA_TYPES[path.extname(name).toLowerCase()])
    .map((name) => ({ name, card: cardNumberOf(name), modifiedAt: statSync(path.join(VIDEO_DIR, name)).mtimeMs }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** Every card an agent worked on, plus cards that only have a video. */
function listTickets(): TicketSummary[] {
  const tickets = new Map<number, TicketSummary>();
  for (const card of Object.values(loadState().cards)) {
    const status = card.lastStage ? `${card.lastStage}: ${card.lastStatus ?? '-'}` : '';
    tickets.set(card.idShort, { number: card.idShort, name: card.name, status, videos: [], updatedAt: 0 });
  }
  for (const video of listVideos()) {
    if (!video.card) continue;
    const ticket = tickets.get(video.card) ?? { number: video.card, name: '', status: '', videos: [], updatedAt: 0 };
    ticket.videos.push(video.name);
    ticket.updatedAt = Math.max(ticket.updatedAt, video.modifiedAt);
    tickets.set(video.card, ticket);
  }
  return [...tickets.values()].sort((a, b) => b.updatedAt - a.updatedAt || b.number - a.number);
}

let listNames: Map<string, string> | undefined;
async function listNameOf(listId: string): Promise<string> {
  listNames ??= new Map((await trello.getLists(CONFIG.boardId)).map((list: TrelloList) => [list.id, list.name]));
  return listNames.get(listId) ?? '';
}

async function ticketDetail(number: number) {
  const card = await trello.getCardByNumber(CONFIG.boardId, number);
  const [list, comments] = await Promise.all([listNameOf(card.idList), trello.getComments(card.id)]);
  return {
    number,
    name: card.name,
    url: card.shortUrl,
    list,
    isAgentListening: AGENT_LISTS.has(list),
    videos: listVideos().filter((video) => video.card === number).map((video) => video.name),
    comments: comments
      .map((comment) => ({ date: comment.date, text: comment.data.text, isAgent: comment.data.text.startsWith(BOT_PREFIX) }))
      .reverse(),
  };
}

/** Posted without 🤖, so it counts as yours and the card's agent picks it up. */
async function sendMessage(number: number, text: string): Promise<void> {
  const message = text.trim().replace(new RegExp(`^${BOT_PREFIX}\\s*`, 'u'), '').slice(0, MAX_MESSAGE_LENGTH);
  if (!message) throw new Error('EMPTY');
  const card = await trello.getCardByNumber(CONFIG.boardId, number);
  await trello.addComment(card.id, message);
}

async function readAudio(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_AUDIO_BYTES) throw new Error('TOO_LONG');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function transcribe(audio: Buffer, mimeType: string, language: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Set OPENAI_API_KEY in .env');
  const form = new FormData();
  form.set('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe');
  form.set('file', new Blob([new Uint8Array(audio)], { type: mimeType }), 'speech.webm');
  if (TRANSCRIBE_LANGUAGES.has(language)) form.set('language', language);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { text: string }).text;
}

/** Only plain names of files that exist in the folder, so a request can't reach anything else. */
function videoPath(name: string): string | null {
  return listVideos().some((video) => video.name === name) ? path.join(VIDEO_DIR, name) : null;
}

// Ranges let the browser seek in long videos.
function sendFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  const { size } = statSync(filePath);
  const type = MEDIA_TYPES[path.extname(filePath).toLowerCase()];
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (!range) {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    createReadStream(filePath).pipe(res);
    return;
  }
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
  createReadStream(filePath, { start, end }).pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_MESSAGE_LENGTH * 4) throw new Error('TOO_LONG');
  }
  return body;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // A foreign page that resolves its own name to 127.0.0.1 still sends its own Host.
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return void res.writeHead(403).end();
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return void res.end(PAGE);
  }
  if (url.pathname === '/api/tickets') return sendJson(res, 200, { tickets: listTickets(), otherVideos: listVideos().filter((video) => !video.card) });

  // The custom header forces a CORS preflight we never answer, so other websites can't use the key.
  if (url.pathname === '/api/transcribe' && req.method === 'POST' && req.headers['x-review-page'] === '1') {
    try {
      const mimeType = (req.headers['content-type'] ?? 'audio/webm').split(';')[0];
      return sendJson(res, 200, { text: await transcribe(await readAudio(req), mimeType, url.searchParams.get('lang') ?? '') });
    } catch (error) {
      console.error(`Transcribe: ${(error as Error).message}`);
      return sendJson(res, 502, { error: 'The voice could not be turned into text.' });
    }
  }

  const ticketMatch = url.pathname.match(/^\/api\/tickets\/(\d+)(\/messages)?$/);
  if (ticketMatch) {
    const number = Number(ticketMatch[1]);
    try {
      if (!ticketMatch[2] && req.method === 'GET') return sendJson(res, 200, await ticketDetail(number));
      // The custom header forces a CORS preflight we never answer, so other websites can't post.
      if (ticketMatch[2] && req.method === 'POST' && req.headers['x-review-page'] === '1') {
        const { text } = JSON.parse(await readBody(req)) as { text?: unknown };
        await sendMessage(number, typeof text === 'string' ? text : '');
        return sendJson(res, 201, { ok: true });
      }
      return void res.writeHead(405).end();
    } catch (error) {
      console.error(`Ticket #${number}: ${(error as Error).message}`);
      return sendJson(res, 502, { error: 'Trello could not be reached, or the ticket does not exist.' });
    }
  }

  const filePath = url.pathname.startsWith('/files/') ? videoPath(decodeURIComponent(url.pathname.slice('/files/'.length))) : null;
  if (!filePath) return void res.writeHead(404).end();
  if (req.method === 'GET') return sendFile(req, res, filePath);
  // DELETE needs a CORS preflight we never answer, so other websites can't delete videos.
  if (req.method === 'DELETE') return void execFile('gio', ['trash', filePath], (error) => res.writeHead(error ? 500 : 204).end());
  res.writeHead(405).end();
}

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticket review</title>
<style>
  :root { --bg: #f4f1ea; --panel: #fffdf8; --fg: #1f2a2a; --muted: #66726f; --line: #ddd6c8; --accent: #0a716d; --mine: #dcefec; --danger: #a33b2f; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121a1a; --panel: #182323; --fg: #e3ebe8; --muted: #93a39f; --line: #2b3a39; --accent: #46c2b8; --mine: #173a37; --danger: #ff8f80; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 18px/1.55 system-ui, sans-serif; }
  main { display: grid; grid-template-columns: minmax(220px, 300px) 1fr; height: 100vh; }
  main.wide { grid-template-columns: 1fr; }
  main.wide aside { display: none; }
  aside { border-right: 1px solid var(--line); padding: 20px 12px; overflow-y: auto; }
  h1 { font-size: 1.3rem; margin: 0 0 14px 6px; }
  h2 { font-size: 1.05rem; margin: 0; }
  button.ticket { display: block; width: 100%; text-align: left; font: inherit; font-size: 0.95rem; color: inherit; background: none; border: 1px solid transparent; border-radius: 8px; padding: 8px 10px; margin-bottom: 4px; cursor: pointer; overflow-wrap: anywhere; }
  button.ticket:hover { background: var(--panel); }
  button.ticket[aria-current="true"] { background: var(--panel); border-color: var(--accent); }
  .small { font-size: 0.82rem; color: var(--muted); }
  .search { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 7px 14px; width: 100%; margin: 0 0 10px; }
  section { overflow-y: auto; padding: 14px 18px 40px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .head { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; justify-content: space-between; }
  .title { font-size: 1.25rem; font-weight: 600; overflow-wrap: anywhere; }
  .chip { font-size: 0.82rem; border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; color: var(--muted); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .plain, .delete { font: inherit; font-size: 0.9rem; background: none; border-radius: 999px; padding: 5px 14px; cursor: pointer; }
  .plain { color: var(--accent); border: 1px solid var(--accent); }
  .delete { color: var(--danger); border: 1px solid var(--danger); }
  a { color: var(--accent); }
  /* The video fills most of the screen; small GIFs are scaled up to it. */
  .stage { background: #000; border-radius: 10px; height: 64vh; display: flex; }
  .stage video, .stage img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .stage:fullscreen { border-radius: 0; height: 100vh; }
  .no-video { border: 1px dashed var(--line); border-radius: 10px; padding: 14px 16px; color: var(--muted); }
  .block { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  .text.rich { white-space: normal; }
  .text.rich p { margin: 0 0 8px; }
  .text.rich ul { margin: 0 0 8px; padding-left: 1.3em; }
  .chat { display: flex; flex-direction: column; gap: 10px; }
  .message { border-radius: 10px; padding: 10px 14px; max-width: 900px; }
  .message.agent { background: var(--panel); border: 1px solid var(--line); }
  .message.mine { background: var(--mine); align-self: flex-end; }
  .composer { display: flex; flex-direction: column; gap: 8px; }
  .text h3 { font-size: 1.05rem; margin: 14px 0 4px; }
  .text code { font-family: ui-monospace, monospace; font-size: 0.85em; background: var(--bg); padding: 1px 5px; border-radius: 4px; }
  textarea { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; min-height: 90px; resize: vertical; width: 100%; }
  .send-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
  .send { font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 999px; padding: 8px 22px; cursor: pointer; }
  .send:disabled { opacity: 0.5; cursor: default; }
  .voice { align-items: center; }
  .lang { font: inherit; font-size: 0.9rem; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; }
  .mic { font: inherit; font-weight: 600; color: var(--accent); background: var(--panel); border: 2px solid var(--accent); border-radius: 999px; min-height: 52px; padding: 10px 24px; cursor: pointer; }
  .mic[aria-pressed="true"] { color: var(--bg); background: var(--danger); border-color: var(--danger); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--danger) 25%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .mic[aria-pressed="true"] { animation: none; } }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 760px) { main { grid-template-columns: 1fr; height: auto; } aside { border-right: 0; border-bottom: 1px solid var(--line); max-height: 35vh; } .stage { height: 45vh; } section { overflow: visible; } }
</style>
</head>
<body>
<main>
  <aside><h1>Tickets</h1><input id="search" class="search" type="search" placeholder="Search: 271 or words…" aria-label="Search tickets" autocomplete="off"><div id="list"></div></aside>
  <section id="detail"><p class="small">Pick a ticket on the left.</p></section>
</main>
<script>
  let tickets = [];
  let ticket = null;
  let videoName = null;
  let waitingSince = 0;
  const $ = (tag, props = {}, ...children) => { const el = Object.assign(document.createElement(tag), props); el.append(...children); return el; };

  const SPEECH_LANGS = [['auto', 'Any language'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch']];
  const SPEECH_HELP = 'Speaking needs microphone access.';
  const MAX_RECORDING_MS = 5 * 60 * 1000;
  let isSpeechBlocked = !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder;
  let speechLang = savedSpeechLang();
  let recorder = null;
  let isTranscribing = false;

  // A number finds that card ("271", "#271"); words must all appear in the name.
  function matchesSearch(item, query) {
    const words = query.toLowerCase().replace(/#/g, ' ').split(' ').filter(Boolean);
    const haystack = ('#' + item.number + ' ' + (item.name || '')).toLowerCase();
    return words.every((word) => /^[0-9]+$/.test(word) ? String(item.number).startsWith(word) || haystack.includes(word) : haystack.includes(word));
  }

  function renderList() {
    const list = document.getElementById('list');
    const query = document.getElementById('search').value.trim();
    const shown = query ? tickets.filter((item) => matchesSearch(item, query)) : tickets;
    // The list holds only cards the agents touched; any other card number still opens straight from Trello.
    const number = Number(query.replace('#', ''));
    const openOther = Number.isInteger(number) && number > 0 && !tickets.some((item) => item.number === number)
      ? [$('button', { className: 'plain', textContent: 'Open #' + number + ' from Trello', onclick: () => { location.hash = 'card-' + number; } })]
      : [];
    if (!shown.length && !openOther.length) return list.replaceChildren($('p', { className: 'small', textContent: 'No ticket matches.' }));
    list.replaceChildren(...openOther, ...shown.map((item) => {
      const button = $('button', { className: 'ticket', onclick: () => open(item.number) },
        $('div', { textContent: '#' + item.number + ' ' + (item.name || '') }),
        $('div', { className: 'small', textContent: [item.videos.length ? '🎬 video' : '', item.status].filter(Boolean).join(' · ') }));
      button.setAttribute('aria-current', String(ticket?.number === item.number));
      return button;
    }));
  }

  function stripPrefix(text) { return text.replace(/^🤖\\s*/u, ''); }
  // The agents write Markdown: escape everything first, then turn only headings, lists, bold and code into tags.
  function escapeHtml(text) { return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
  function inline(text) { return text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>').replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>'); }
  function richText(markdown) {
    const html = [];
    let isList = false;
    for (const raw of escapeHtml(markdown).split('\\n')) {
      const line = raw.trimEnd();
      const item = line.match(/^\\s*(?:[-*]|\\d+\\.)\\s+(.*)/);
      if (item && !isList) { html.push('<ul>'); isList = true; }
      if (!item && isList) { html.push('</ul>'); isList = false; }
      if (item) html.push('<li>' + inline(item[1]) + '</li>');
      else if (/^#{1,6}\\s/.test(line)) html.push('<h3>' + inline(line.replace(/^#+\\s*/, '')) + '</h3>');
      else if (line.trim()) html.push('<p>' + inline(line) + '</p>');
    }
    if (isList) html.push('</ul>');
    return $('div', { className: 'text rich', innerHTML: html.join('') });
  }
  // The newest long agent comment is the report; short ones are notes like "started".
  function latestReport(comments) {
    return [...comments].reverse().find((c) => c.isAgent && c.text.length > 300);
  }

  function renderDetail() {
    const detail = document.getElementById('detail');
    if (!ticket) return;
    const head = $('div', { className: 'head' },
      $('div', {}, $('div', { className: 'title', textContent: '#' + ticket.number + ' ' + ticket.name }),
        $('div', { className: 'actions' }, $('span', { className: 'chip', textContent: ticket.list }), $('a', { href: ticket.url, target: '_blank', rel: 'noopener', className: 'small', textContent: 'Open in Trello' }))),
      $('div', { className: 'actions' },
        $('button', { className: 'plain', textContent: document.querySelector('main').classList.contains('wide') ? 'Show list' : 'Hide list', onclick: (e) => { e.target.textContent = document.querySelector('main').classList.toggle('wide') ? 'Show list' : 'Hide list'; } })));

    const parts = [head];
    if (ticket.videos.length) {
      videoName = ticket.videos.includes(videoName) ? videoName : ticket.videos[0];
      const src = '/files/' + encodeURIComponent(videoName);
      const media = videoName.toLowerCase().endsWith('.gif') ? $('img', { src, alt: videoName }) : $('video', { src, controls: true, autoplay: true });
      const stage = $('div', { className: 'stage', ondblclick: () => stage.requestFullscreen() }, media);
      parts.push(stage, $('div', { className: 'head' },
        $('div', { className: 'actions' }, ...ticket.videos.map((name) => $('button', { className: 'plain', textContent: name, onclick: () => { videoName = name; renderDetail(); } }))),
        $('div', { className: 'actions' },
          $('button', { className: 'plain', textContent: 'Full screen', onclick: () => stage.requestFullscreen() }),
          $('button', { className: 'delete', textContent: 'Delete video', onclick: deleteVideo }))));
    } else {
      parts.push($('div', { className: 'no-video', textContent: 'No video for this ticket: no screen change, or it was built before videos were made. What was done is below.' }));
    }

    const report = latestReport(ticket.comments);
    parts.push($('div', { className: 'block' }, $('h2', { textContent: 'What was done' }),
      report ? richText(stripPrefix(report.text)) : $('div', { className: 'text', textContent: 'No report from an agent yet.' })));

    const others = ticket.comments.filter((c) => c !== report);
    if (others.length) {
      parts.push($('h2', { textContent: 'Conversation' }), $('div', { className: 'chat' }, ...others.map((c) =>
        $('div', { className: 'message ' + (c.isAgent ? 'agent' : 'mine') },
          $('div', { className: 'small', textContent: (c.isAgent ? 'Agent' : 'You') + ' · ' + new Date(c.date).toLocaleString() }),
          richText(stripPrefix(c.text))))));
    }

    const input = $('textarea', { id: 'message', placeholder: 'Ask about the implementation, or say what to improve…' });
    const status = $('div', { className: 'small', textContent: (waitingSince ? 'Sent. Waiting for the agent: it starts within 30 seconds and answers here.' : (ticket.isAgentListening ? 'The agent of this ticket reads it and answers here.' : 'This ticket is in "' + ticket.list + '". Its agent answers once the ticket is in To Do, Doing or Testing.')) + (isSpeechBlocked ? ' ' + SPEECH_HELP : '') });
    const send = $('button', { className: 'send', textContent: 'Send', onclick: () => sendMessage(input, send) });
    parts.push($('div', { className: 'composer' }, input, $('div', { className: 'send-row' }, status, $('div', { className: 'actions voice' }, ...voiceControls(), send))));

    const draft = document.getElementById('message')?.value;
    detail.replaceChildren(...parts);
    if (draft) input.value = draft;
    updateMic();
  }

  function savedSpeechLang() {
    try { const saved = localStorage.getItem('speechLang'); if (SPEECH_LANGS.some(([code]) => code === saved)) return saved; } catch {}
    return 'auto';
  }

  function voiceControls() {
    if (isSpeechBlocked) return [];
    const lang = $('select', { className: 'lang', onchange: () => { speechLang = lang.value; try { localStorage.setItem('speechLang', speechLang); } catch {} } },
      ...SPEECH_LANGS.map(([value, label]) => $('option', { value, textContent: label })));
    lang.value = speechLang;
    lang.setAttribute('aria-label', 'Speaking language');
    const mic = $('button', { id: 'mic', className: 'mic', type: 'button', onclick: () => (recorder ? recorder.stop() : startListening()) });
    return [lang, mic];
  }

  function updateMic() {
    const mic = document.getElementById('mic');
    if (!mic) return;
    mic.textContent = recorder ? '■ Stop' : isTranscribing ? '… Writing' : '🎤 Speak';
    mic.disabled = isTranscribing;
    mic.setAttribute('aria-pressed', String(Boolean(recorder)));
  }

  function joinText(before, after) {
    const tail = after.trim();
    if (!tail) return before;
    return before.trim() ? before.trimEnd() + ' ' + tail : tail;
  }

  // Records until Stop, then OpenAI writes it out; the text lands in the message field to check before sending.
  async function startListening() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { isSpeechBlocked = true; renderDetail(); return; }
    const current = recorder = new MediaRecorder(stream);
    const chunks = [];
    const forTicket = ticket.number;
    const timer = setTimeout(() => current.state === 'recording' && current.stop(), MAX_RECORDING_MS);
    current.ondataavailable = (event) => chunks.push(event.data);
    current.onstop = async () => {
      clearTimeout(timer);
      stream.getTracks().forEach((track) => track.stop());
      if (recorder === current) recorder = null;
      if (current.isAborted) { updateMic(); return; }
      isTranscribing = true;
      updateMic();
      const response = await fetch('/api/transcribe?lang=' + speechLang, { method: 'POST', headers: { 'Content-Type': current.mimeType || 'audio/webm', 'X-Review-Page': '1' }, body: new Blob(chunks, { type: current.mimeType }) }).catch(() => null);
      isTranscribing = false;
      updateMic();
      const box = document.getElementById('message');
      if (!response?.ok) { alertLine('Not understood: the voice could not be turned into text. Try again.'); return; }
      const { text } = await response.json();
      // renderDetail() replaces the textarea, and the ticket may have changed meanwhile.
      if (box && ticket?.number === forTicket) { box.value = joinText(box.value, text); box.focus(); }
    };
    current.start();
    updateMic();
  }

  // Switching tickets drops a running recording, so it can't land in another ticket's message.
  function abortListening() {
    if (!recorder) return;
    recorder.isAborted = true;
    recorder.stop();
  }

  async function sendMessage(input, button) {
    const text = input.value.trim();
    if (!text) return;
    button.disabled = true;
    const response = await fetch('/api/tickets/' + ticket.number + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Page': '1' }, body: JSON.stringify({ text }) });
    button.disabled = false;
    if (!response.ok) { alertLine('Not sent: Trello could not be reached. Try again.'); return; }
    input.value = '';
    waitingSince = Date.now();
    await refreshTicket();
  }

  function alertLine(text) { document.querySelector('.send-row .small').textContent = text; }

  async function deleteVideo() {
    const response = await fetch('/files/' + encodeURIComponent(videoName), { method: 'DELETE' });
    if (response.ok) { videoName = null; await loadTickets(); await refreshTicket(); }
  }

  async function refreshTicket() {
    if (!ticket) return;
    const response = await fetch('/api/tickets/' + ticket.number);
    if (!response.ok) return;
    ticket = await response.json();
    const lastAgent = [...ticket.comments].reverse().find((c) => c.isAgent);
    if (waitingSince && lastAgent && new Date(lastAgent.date).getTime() > waitingSince) waitingSince = 0;
    renderDetail();
  }

  async function open(number) {
    const response = await fetch('/api/tickets/' + number);
    if (!response.ok) { document.getElementById('detail').replaceChildren($('p', { className: 'small', textContent: 'Ticket #' + number + ' could not be loaded from Trello.' })); return; }
    if (ticket?.number !== number) abortListening();
    ticket = await response.json();
    waitingSince = 0;
    history.replaceState(null, '', '#card-' + number);
    renderList();
    renderDetail();
  }

  async function loadTickets() {
    tickets = (await (await fetch('/api/tickets')).json()).tickets;
    renderList();
  }

  document.getElementById('search').addEventListener('input', renderList);
  window.addEventListener('hashchange', () => { const n = Number(location.hash.match(/card-(\\d+)/)?.[1]); if (n) open(n); });
  loadTickets().then(() => { const n = Number(location.hash.match(/card-(\\d+)/)?.[1]) || tickets[0]?.number; if (n) open(n); });
  setInterval(loadTickets, 15000);
  // While waiting for an answer, check often; otherwise now and then.
  setInterval(() => { if (waitingSince) refreshTicket(); }, 5000);
  setInterval(() => { if (!waitingSince && !document.getElementById('message')?.value) refreshTicket(); }, 30000);
</script>
</body>
</html>`;

mkdirSync(VIDEO_DIR, { recursive: true });
createServer((req, res) => void handle(req, res)).listen(PORT, '127.0.0.1', () => console.log(`Ticket review: http://localhost:${PORT} (videos in ${VIDEO_DIR})`));
