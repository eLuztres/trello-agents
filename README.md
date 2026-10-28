# trello-agents

Runs a Claude Code agent for each list on the Trello board. You are the chef: a card in To Do or Doing gets built right away, then reviewed. You give the OK to commit and to push by moving the card yourself. (A planning step exists too: give `plan` a list in `config.ts` to use it.)

| List | Agent | Permission mode | Output |
| :--- | :--- | :--- | :--- |
| **To Do** | Developer | `auto` | Commits on `card/<n>-<slug>`, then moves the card to Testing |
| **Doing** | Developer, same as To Do | `auto` | |
| **Testing** | Reviewer (fresh session) | `auto` | Fixes, missing tests, lint + tests, `docs/changes/card-<n>.md`, videos of front-end changes, report comment. Verdict "ready" moves the card to Uncommitted |
| **Uncommitted** | none, waits for you | | The description gets **What changed**, the **Video** links and a proposed **Commit message** you can edit |
| **Committed** | none, plain git (your move = OK to commit) | | Squashes the card branch into the target branch with the message from the description, comments the hash. Blocked (conflict, uncommitted changes in the main checkout): comments why and moves the card back |
| **Pushed** | none, plain git (your move = OK to push) | | Pushes the target branch, waits for Vercel and comments the live URL or the failure, then removes the card's worktree and branch |
| **Done** | none, you move it by hand | | |

- **Comment on a card** to talk to its agent. It re-runs the card's current stage with your comment (for example, "use the existing coupon validator").
- **Move a card** to stop its running agent and start the new list's agent.
- Only moves made by you into **Committed** and **Pushed** commit or push. Claude sessions use your Trello account too, so AGENTS.md tells them never to move a card there.
- Every card gets its own git worktree in `../.worktrees/`, so cards run in parallel without touching your checkout. `node_modules` and `.env` are linked from the main repo.
- A card labeled with a repo name (`custom`, `webStore`, …) works in that repo. Any other card works in `shop-baifo` (`defaultRepo` in `config.ts`). Cards labeled `manual` never start an agent.
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

## Finishing a card

Check the card in **Uncommitted** (report, video, What changed), edit the commit message in the description if you like, then:

1. Move it to **Committed**. The card branch lands on the target branch as one commit (with a `Co-Authored-By: Claude` line). The repo's main checkout must be on that branch and have no uncommitted changes.
2. Move it to **Pushed**. The daemon pushes, removes the card's worktree and branch, and comments the Vercel result (it needs the Vercel CLI, logged in, and the repo linked with `vercel link`).
3. Move it to **Done**.

You get a desktop notification when a commit or push succeeds or fails. To finish a card by hand instead, merge the branch yourself and remove the worktree:

```shell
git -C ../webStore worktree remove ../.worktrees/webStore-card-12
```

## Config

Everything is in `config.ts`: list names, repos, the target branch per repo (`targetBranches`, otherwise `main`), parallel job limit (2), poll interval (30 s) and the dollar budget per stage.
