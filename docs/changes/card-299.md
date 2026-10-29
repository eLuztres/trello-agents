# Card #299: Card branches stay up to date with main, and clashes go back to the builder

## What changed

- **Before Testing**, the daemon merges the target branch (`main`, or `targetBranches[repo]` in `config.ts`) into the card branch in its worktree (`mergeTargetIntoBranch` in `src/ship-git.ts`). A clean merge is committed on the card branch and the reviewer tests that code. A reply to your comment on a Testing card skips the merge.
- **On a clash before Testing**, the merge is undone, the card moves to **To Do** with one comment, "🤖 `main` moved on; the agent is updating this card, then it is tested again and ships by itself.", and a build is queued in the same session.
- The card state remembers the clash (`updateOnto` in `src/state.ts`). The next build prompt starts with "Update the branch onto main: run `git merge main`, resolve the conflicts, commit the merge". A successful build clears it. After a daemon restart, a card waiting in To Do for this update is picked up again even though its last build was marked done.
- Clashes before Testing and at Committed share one limit (`conflictRetries`, at most `MAX_CONFLICT_RETRIES` = 2). Once it is used up, Testing runs on the branch as it is, and Committed sends the card back to Uncommitted for the chef instead of looping.
- A conflict at **Committed** is handled by `main`'s own flow (`sendBackToMerge`, at most `MAX_CONFLICT_RETRIES` builds), which this card now uses instead of its own.
- If git refuses the merge before Testing for another reason (e.g. an untracked file in the way), the review fails with a comment instead of testing a half-updated branch.
- README: Testing and Committed rows, and a new section "When main moves on".

## Why

Many agents work in parallel, so `main` moves on while a card is built. Cards kept failing at Committed with "doesn't merge cleanly into main" (#278, #296), and the chef had to send them back by hand.

## How to test by hand

1. Build a small card that edits a line of a file. Before it reaches Testing, commit a change to another file on `main`. When Testing starts, `git log card/<n>-…` shows a merge of `main`, and the reviewer runs on it.
2. Repeat, but commit a change to the **same line** on `main`. When the build ends, the card goes to To Do (then Doing) with the one-line comment, and the build log starts with the update instruction. Afterwards it goes through Testing again and ships by itself with a new report.
3. Take a card in Uncommitted, commit a change to the same lines on `main`, move the card to Committed. Expect the "Merge conflict" comment, the card back in a build, nothing committed on `main`, and a clean main checkout.
4. Move a clean card to Committed: it is committed, pushed and moved to Done as before.
5. Move a card to Committed with no commit message in the description: it still goes back to Uncommitted with the "no commit message" note.
6. During step 2, stop the daemon while the card waits in To Do and start it again: the build starts.
7. Comment on a card in Testing: the reply runs without a merge.
8. Make the clash in step 2 come back each time (e.g. keep changing the same line on `main`). After two hand-backs, Testing runs without updating, and Committed moves the card to Uncommitted with "Nothing committed" instead of another build.
