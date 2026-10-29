# Card #295: Daemon stops its agents on restart

## What changed

- On SIGTERM, SIGINT or SIGHUP (`kill`, Ctrl+C, closing the terminal) the daemon stops every running job, waits until they have exited (at most 10 s), then exits. No new job starts while it shuts down (`shutdown` in `src/index.ts`).
- Each agent runs in its own process group (`detached: true` in `src/claude.ts`). Stopping it sends SIGKILL to the whole group, so the shells and dev servers the agent started die with it. Killing only `claude` was not enough: a shell it had started kept the job open.
- A shutdown is not a card move: the job aborts with the reason `shutdown` (`SHUTDOWN` in `src/state.ts`), stays `running` in `state.json`, keeps the "🤖 AI working" label and gets no comment. The next start resumes it as before. A card move or a `stop` comment still marks the job `stopped`.
- A commit or push cut off by a shutdown is marked failed, but the next start re-queues every card still in Committed or Pushed, so it runs again.

## Why

Agents used to keep running after the daemon stopped, and they ignored a plain SIGTERM. The next daemon started the same cards again, so two agents edited the same worktree. On 29 Oct four leftover agents had to be killed by hand with `kill -9`.

## Tests

- `tests/state.test.ts`: a shutdown abort leaves the job `running` (resumable); a plain abort marks it `stopped`.
- `tests/claude.test.ts`: a fake `claude` that ignores SIGTERM and starts a `sleep 30` is stopped within seconds, and its shell is gone too. This test fails on the old code.

## How to test by hand

1. Start the daemon (`npm start`) and move one or two cards to To Do so agents run.
2. `ps -eo pid,pgid,args | grep 'claude -p'`: one agent per card.
3. Press Ctrl+C. The daemon logs `SIGINT: stopping N job(s)…` and `stopped by the shutdown, resumes on the next start`, then exits within about 10 s.
4. Run the `ps` command again: no `claude -p` and no shells or servers from those worktrees are left.
5. On the board: the cards keep the "🤖 AI working" label and have no "stopped" comment. `npm run status` shows them as `running`.
6. `npm start` again: the same cards start again, one agent per card.
7. Move a card while its agent runs: it is still stopped as before (`stopped because the card moved`).
