# trello-agents

Runs a Claude Code agent for each list on the Trello board. You are the chef: a card in To Do or Doing gets built right away, then reviewed, and you approve by moving it to Done. Every comment you write gets a reply, in any list, so you can run the team from Trello. (A planning step exists too: give `plan` a list in `config.ts` to use it.)

| List | Agent | Permission mode | Output |
| :--- | :--- | :--- | :--- |
| **To Do** | Developer | `auto` | Commits on `card/<n>-<slug>`, then moves the card to Testing |
| **Doing** | Developer, same as To Do | `auto` | |
| **Testing** | Reviewer (fresh session) | `auto` | Fixes, missing tests, lint + tests, `docs/changes/card-<n>.md`, report comment |
| **Backlog, Done, any other list** | Chat, only when you comment | `plan` (read-only), $0.50 | A reply comment; moves the card to To Do only if you ask ("do it", "build it") |

## Talking to an agent

Comment on any card. Within one poll (30 s) you get "🤖 Got it, looking at it…", then a real answer:

- **To Do, Doing, Testing:** the card's stage re-runs with your comment (for example, "use the existing coupon validator"). Its report starts by answering your comment. If an agent is already running on the card, your comment waits for it.
- **Backlog, Done and other lists:** a chat agent reads the card, its comments and the code, and answers or says what it would do and why. It ends with a next step ("Move to To Do and I build it", "Need from you: …"). It changes no code, makes no commits and leaves the card where it is, unless your comment says "do it" or "build it": then it moves the card to To Do and the build starts. It also answers on `manual` cards.

Every agent replies the same way: what was done or found, the result (with a screenshot or video link for UI work) and what's next. Logs stay in `logs/card-<n>.log`.

## How it works

- **Move a card** to stop its running agent and start the new list's agent.
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

## Finishing a card

Review the branch, merge it (or open a PR), move the card to **Done**, then clean up:

```shell
git -C ../webStore worktree remove ../.worktrees/webStore-card-12
```

## Config

Everything is in `config.ts`: list names, repos, parallel job limit (2), poll interval (30 s) and the dollar budget per stage (chat: $0.50).
