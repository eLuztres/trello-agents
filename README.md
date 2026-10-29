# trello-agents

Runs a Claude Code agent for each list on the Trello board. You are the chef: a card in To Do or Doing gets built right away, then reviewed. You give the OK to commit and to push by moving the card yourself. Cards you want planned first go to Planning. Every comment you write gets a reply, in any list, so you can run the team from Trello.

| List | Agent | Permission mode | Output |
| :--- | :--- | :--- | :--- |
| **✋ Backlog** | none | | Plans with open questions come back here. Your answer as a comment plans the card again |
| **✋ Planning** | Planner | `plan` (read-only) | Posts the plan. No open questions: moves the card to To Do and builds it right away. Questions: posts them and moves the card back to Backlog |
| **🤖 Ready** | none, normally empty | | Plans now go straight on to the build. A card you drop here waits; a comment here changes the plan |
| **✋ To Do** | Developer | `auto` | Your drop starts the build: the card moves to Doing while it runs |
| **🤖 Doing** | Developer | `auto` | Commits on `card/<n>-<slug>`, then moves the card to Testing |
| **🤖 Testing** | Reviewer (fresh session) | `auto` | Fixes, missing tests, lint + tests, `docs/changes/card-<n>.md`, report comment. Verdict "ready" moves the card to Uncommitted |
| **🤖 Uncommitted** | none, passes straight through | | The description gets **What changed**, the **Video** links and a **Commit message**; then the card moves on to Committed by itself and ships. A merge conflict sends it back to To Do with the conflict as instructions (at most twice), then it ships again |
| **✋ Committed** | none, plain git (your move = OK to commit, push and deploy) | | Squashes the card branch into the target branch with the message from the description, comments the hash, then pushes like Pushed and moves the card to Done. Blocked (conflict, uncommitted changes in the main checkout): comments why and moves the card back |
| **✋ Pushed** | none, plain git (your move = OK to push) | | Only needed to retry a push.  Pushes the target branch, waits for Vercel and comments the live URL or the failure, then removes the card's worktree and branch |
| **✋ Done** | none, you move it by hand | | |
| **Backlog, Done, any other list** | Chat, only when you comment | `plan` (read-only), $0.50 | A reply comment; moves the card to To Do only if you ask ("do it", "build it") |

## Who moves what

- **✋ lists are yours:** drop a card there to give an order (plan, build, commit, push) or to park it.
- **🤖 lists are the agents':** only the daemon puts cards there. If you drop one in by hand, it goes back with a note.
- **🔒 A card with the purple "🤖 AI working" label is locked:** an agent works on it or is about to. Moving it by hand puts it back. Comment `stop` to stop the agent; the card then waits in Backlog.
- Every card's name starts with its number ("#123 …"). `npm run number-cards` adds missing ones.

## Talking to an agent

Comment on any card. Within one poll (30 s) you get "🤖 Got it, looking at it…", then a real answer:

- **To Do, Doing:** the card's stage re-runs with your comment (for example, "use the existing coupon validator"). Its report starts by answering your comment. If an agent is already running on the card, your comment waits for it.
- **Testing, Uncommitted:** your comment sends the card back to To Do and builds it again with your words (same session), then on through Testing to Uncommitted. A plain question (ending with `?`) only gets an answer and the card stays put.
- **Backlog, Done and other lists:** a chat agent reads the card, its comments and the code, and answers or says what it would do and why. It ends with a next step ("Move to To Do and I build it", "Need from you: …"). It changes no code, makes no commits and leaves the card where it is, unless your comment says "do it" or "build it": then it moves the card to To Do and the build starts. It also answers on `manual` cards.

Every agent replies the same way: what was done or found, the result (with a screenshot or video link for UI work) and what's next. Logs stay in `logs/card-<n>.log`.

## How it works

- **Move a card** to stop its running agent and start the new list's agent.
- **Stopping or restarting the daemon** (Ctrl+C, closing the terminal, `kill`) stops its agents too, together with the shells and servers they started. Their cards keep the working label, get no "stopped" comment and resume on the next start. Only `kill -9` on the daemon leaves agents running.
- **Every UI change comes with a video.** Build and review record the changed pages on desktop and at 375px into `logs/videos/`. The daemon attaches them to the card and starts the report with "🎬 Video: <link>". Without a UI change the report starts with "🎬 Video: no UI change".
- Only moves made by you into **Committed** and **Pushed** commit or push. Claude sessions use your Trello account too, so AGENTS.md tells them never to move a card there.
- Every card gets its own git worktree in `../.worktrees/`, so cards run in parallel without touching your checkout. `node_modules` and `.env` are linked from the main repo.
- A card labeled with a repo name (`custom`, `webStore`, `trello-agents`, …) works in that repo. Any other card works in `shop-baifo` (`defaultRepo` in `config.ts`). Cards labeled `manual` never start a build or review agent.
- Claude sessions use the same Trello account as you, so they start their comments with 🤖, like the agents. Only comments without it steer an agent.
- Only cards, moves and comments made by **you** start agents, because card text becomes instructions for an agent in auto mode. Keep the board private.

## Setup

```shell
npm install
cp .env.example .env   # add your Trello API key and token (steps in the file)
npm run lists          # checks that list names match config.ts
npm start              # keep it running in a terminal
```

When the daemon starts for the first time, it skips everything already on the board. Only new cards, moves and comments start agents.

## Watching and taking over

```shell
tail -f logs/card-12.log    # live: what the agent says and which tools it runs
npm run status              # every card with its branch and resume commands
cd ../.worktrees/webStore-card-12 && claude --resume <session-id>   # jump into the session
```

Each report comment on the card also ends with the take-over command. You get a desktop notification when a stage finishes or fails.

## Change videos

```shell
npm run videos   # http://localhost:4500, keep it open
```

Every change video in `~/Videos/changes/` (`card-<n>-<what>.mp4|webm|gif`), newest first and grouped by card. Click to play, **Delete** moves the file to the trash. A card links straight to its video with `http://localhost:4500/#card-<n>`.

## Finishing a card

A ready review ships by itself: Uncommitted → Committed (commit) → push → Vercel → Done. You only step in when a card stops with a comment. By hand, for a card that stopped:

1. Move it to **Committed**. That's all: the card branch lands on the target branch as one commit (with a `Co-Authored-By: Claude` line), the daemon pushes, removes the card's worktree and branch, comments the Vercel result (it needs the Vercel CLI, logged in, and the repo linked with `vercel link`) and moves the card to **Done**.
2. If the push fails, the card stays in Committed with the reason; move it to **Pushed** to try the push again.

You get a desktop notification when a commit or push succeeds or fails. To finish a card by hand instead, merge the branch yourself and remove the worktree:

```shell
git -C ../webStore worktree remove ../.worktrees/webStore-card-12
```

## Config

Everything is in `config.ts`: list names, repos, the target branch per repo (`targetBranches`, otherwise `main`), parallel job limit (2), poll interval (30 s) and the dollar budget per stage (chat: $0.50).
