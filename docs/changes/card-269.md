# Card #269: Planning list that ends in Ready, and a video for every UI change

## What changed

- New list **Planning** (between Backlog and Ready) runs the read-only plan stage (`lists.plan` in `config.ts`). The planner ends with `Verdict: ready` or `Verdict: questions`.
  - `ready`: the card moves to **Ready** (`plannedList`), a resting list with no agent.
  - `questions` (or no verdict): the card moves back to **Backlog** (`backlogList`).
- Your comment on a card whose last stage was a finished plan, sitting in Backlog (your answers) or Ready (a change), plans it again in the same session. Comments on other Backlog cards still start nothing.
- `readyList` in `config.ts` is now `uncommittedList`, so it doesn't clash with the new Ready list.
- Build and review prompts both carry the video rule: record the changed pages with Playwright on desktop and at 375px into `logs/videos/card-<n>-*.webm`, or start the final message with "🎬 Video: no UI change". After each build and review, the daemon uploads the recorded files as card attachments, deletes them locally and puts "🎬 Video: <links>" at the top of the comment. A ready review also writes those links into the description's **Video** section.

## Why

A card belongs in Ready only when its plan is complete and nothing is left to ask the chef, and the chef wants to watch a video of every UI change instead of reading the details.

## How to test by hand

1. `npm run lists`: Planning → plan, Ready shows "finished plans rest here", Backlog "plans with questions come back here", Uncommitted "ready reviews wait here". The daemon refuses to start if Ready or Backlog is missing on the board.
2. Move a clear, small card to Planning. Expect a plan comment ending in `Verdict: ready` and the card in Ready, with a hint to move it to To Do.
3. Move a vague card to Planning. Expect questions, `Verdict: questions` and the card back in Backlog. Answer in a comment (without 🤖): the plan runs again.
4. Comment on a Backlog card that was never planned: nothing starts.
5. Move a card with a UI change to To Do. The build comment starts with "🎬 Video: [desktop](…) · [phone](…)" and the card has the attachments. `logs/videos/` no longer has the files. The review does the same and the Uncommitted description lists the review's videos.
6. A card without UI change: the comment starts with "🎬 Video: no UI change".
