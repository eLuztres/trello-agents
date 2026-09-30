# trello-agents

Runs a Claude Code agent for each list on the Trello board. You are the chef: agents plan, build and review, and you approve each step by moving the card.

| List | Agent | Permission mode | Output |
| :--- | :--- | :--- | :--- |
| **To Do** | Planner | `plan` (read-only) | Plan posted as a card comment |
| **Doing** | Developer (same session as the planner) | `auto` | Commits on `card/<n>-<slug>`, then moves the card to Testing |
| **Testing** | Reviewer (fresh session) | `auto` | Fixes, lint + tests, `docs/changes/card-<n>.md`, report comment |
| **Done** | none, you move it by hand | | |

- **Comment on a card** to talk to its agent. It re-runs the card's current stage with your comment (for example, "use the existing coupon validator" on a plan).
- **Move a card** to stop its running agent and start the new list's agent.
- Every card gets its own git worktree in `../.worktrees/`, so cards run in parallel without touching your checkout. `node_modules` and `.env` are linked from the main repo.
- A card labeled `custom` works in `custom`. Any other card works in `webStore`.
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

Review the branch, merge it (or open a PR), move the card to **Done**, then clean up:

```shell
git -C ../webStore worktree remove ../.worktrees/webStore-card-12
```

## Config

Everything is in `config.ts`: list names, repos, parallel job limit (2), poll interval (30 s) and the dollar budget per stage.
