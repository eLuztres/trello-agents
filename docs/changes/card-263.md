# Card #263: Uncommitted → Committed → Pushed

## What changed

- New board lists after Testing: **Uncommitted**, **Committed**, **Pushed** (`readyList`, `lists.commit`, `lists.push` in `config.ts`).
- A review whose report says `Verdict: ready` moves the card to Uncommitted. The daemon writes **What changed**, **Video** links (Playwright recordings the reviewer saved in `logs/videos/`, attached to the card) and a proposed **Commit message** into the card description. With "not ready" the card stays in Testing.
- Your move to **Committed** squashes the card branch into the repo's target branch (`targetBranches` per repo, otherwise `baseBranch`) in the main checkout. It uses the commit message from the description plus a `Co-Authored-By: Claude` line. If the checkout is on another branch, has uncommitted changes, or the merge conflicts, nothing is committed: the card goes back to Uncommitted with a comment. Squashes run one at a time, so two cards moved together don't share the checkout's index.
- Your move to **Pushed** pushes the target branch, removes the card's worktree and branch, waits for the Vercel deployment (Vercel CLI, `vercel ls --meta githubCommitSha=…`) and comments "live" or "deploy failed" with the logs link.
- Desktop notifications for every commit and push result. Comments in Committed/Pushed never trigger git; only moves do.

## Why

The chef runs the whole flow from the board. Moving a card into Committed or Pushed is the OK that the "never commit or push without asking" rule in the workspace `AGENTS.md` needs.

## How to test by hand

1. `npm run lists`: Uncommitted shows "ready reviews wait here", and Committed → commit, Pushed → push.
2. Use a throwaway card in a repo whose main checkout is on `main` and clean. Let it build and review. On "ready" it lands in Uncommitted with the three sections in the description.
3. Edit the commit message in the description, then move the card to Committed. Expect "🤖 Committed as <hash> on main", and `git log -1` shows your message.
4. Make the main checkout dirty (edit a tracked file) and move another ready card to Committed. Expect a comment that lists the files, and the card is back in Uncommitted.
5. Move a committed card to Pushed. Expect the push, the worktree removed, and a "Pushed … and live: <url>" comment (or "deploy failed" with the logs link).
