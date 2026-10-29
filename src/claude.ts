import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type PermissionMode = 'plan' | 'auto';

export interface ClaudeRun {
  cwd: string;
  prompt: string;
  permissionMode: PermissionMode;
  sessionId: string;
  shouldResume: boolean;
  maxBudgetUsd: number;
  appendSystemPrompt: string;
  disallowedTools: string[];
  logFile: string;
}

export interface ClaudeResult {
  isSuccess: boolean;
  text: string;
  costUsd: number;
}

interface StreamMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  message?: { content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[] };
}

const MAX_TOOL_SUMMARY_LENGTH = 120;

export function runClaude(run: ClaudeRun, signal: AbortSignal): Promise<ClaudeResult> {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', run.permissionMode,
    '--max-budget-usd', String(run.maxBudgetUsd),
    '--append-system-prompt', run.appendSystemPrompt,
    run.shouldResume ? '--resume' : '--session-id', run.sessionId,
    '--disallowedTools', ...run.disallowedTools,
  ];

  return new Promise((resolve, reject) => {
    // Own process group, so a stop also kills the shells and servers the agent started.
    const child = spawn('claude', args, { cwd: run.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = () => killGroup(child.pid);
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
    const log = createWriteStream(run.logFile, { flags: 'a' });
    let result: StreamMessage | undefined;

    // Prompt goes through stdin: no argument length limit, and --disallowedTools can't swallow it.
    child.stdin.end(run.prompt);
    child.stderr.pipe(log, { end: false });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const message = parseLine(line);
      if (!message) return;
      if (message.type === 'result') result = message;
      log.write(formatForLog(message, run.permissionMode));
    });

    child.on('error', (error) => {
      if (!signal.aborted) reject(error);
    });
    child.on('close', (exitCode) => {
      signal.removeEventListener('abort', stop);
      log.end();
      if (signal.aborted) return reject(new Error('stopped'));
      resolve({
        isSuccess: exitCode === 0 && result?.is_error === false,
        text: result?.result ?? `claude exited with code ${exitCode}, see the log`,
        costUsd: result?.total_cost_usd ?? 0,
      });
    });
  });
}

/** SIGKILL: claude ignores a plain SIGTERM and kept running after the daemon stopped. */
function killGroup(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

function parseLine(line: string): StreamMessage | undefined {
  try {
    return JSON.parse(line) as StreamMessage;
  } catch {
    return undefined;
  }
}

/** Turns the JSON stream into a log you can follow with `tail -f`. */
function formatForLog(message: StreamMessage, permissionMode: PermissionMode): string {
  if (message.type === 'system' && message.subtype === 'init') {
    return `\n── ${new Date().toLocaleString()} · session ${message.session_id} · ${permissionMode} mode ──\n`;
  }
  if (message.type === 'result') {
    return `\n── ${message.subtype} · $${(message.total_cost_usd ?? 0).toFixed(2)} ──\n`;
  }
  if (message.type !== 'assistant') return '';

  return (message.message?.content ?? [])
    .map((block) => {
      if (block.type === 'text') return `${block.text}\n`;
      if (block.type === 'tool_use') return `  → ${block.name} ${summarizeToolInput(block.input ?? {})}\n`;
      return '';
    })
    .join('');
}

function summarizeToolInput(input: Record<string, unknown>): string {
  const value = input.command ?? input.file_path ?? input.pattern ?? input.description ?? '';
  return String(value).replace(/\s+/g, ' ').slice(0, MAX_TOOL_SUMMARY_LENGTH);
}
