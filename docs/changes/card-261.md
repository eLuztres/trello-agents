# Card #261: talk to Claude through card comments

## What changed

- **Receipt:** every comment you write gets "🤖 Got it, looking at it…" within one poll (30 s), even when the card waits for a running job.
- **Chat stage:** a comment on a card outside the automated lists (Backlog, Done, any other list) starts a read-only chat agent (`plan` mode, no Edit/Write, $0.50 budget, fresh session). It reads the card, its latest 20 comments and the code, answers, and ends with a next step. It runs in the card's worktree if there is one, else in the repo checkout. It also answers on `manual` cards.
- **"Do it" / "build it":** the chat agent then ends its reply with `ACTION: build`. The daemon strips that line and moves the card to To Do, which starts the build.
- **Comments on To Do, Doing, Testing** re-run the stage as before, and the report now starts by answering the comment. Every new session also gets the card's comments in its brief.
- **One reply style** for all agents (system prompt): what was done or found, the result (screenshot or video link for UI work), what's next. No logs or command output.
- `trello-agents` is a repo label now, so cards can work on this repo.

## Why

So the chef can run the agents from Trello: every comment gets a reply in any list, not only in To Do and Testing.

## How to test by hand

1. Restart the daemon (`npm start`).
2. Comment a question on a Backlog card. Within 30 s: the receipt. Then a **Chat** reply with a next step. The card stays in Backlog and `git status` in the repo is clean.
3. Comment "build it" on a Backlog card. The reply ends with "Moving the card to **To Do**", and the build starts on the next poll.
4. Comment on a card in Testing. The receipt comes, then the review report starts with the answer to your comment.
5. Write a comment starting with 🤖: nothing happens.
