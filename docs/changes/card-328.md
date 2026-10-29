# Card #328: change videos move without a click

## What changed

- When the daemon uploads a recording from `logs/videos/` (`card-<n>-desktop.webm`, `-phone.webm`), it first makes a GIF of it with ffmpeg (10 fps, at most 720 px wide, own color palette) under the same name (`card-<n>-desktop.gif`) and attaches both.
- The "🎬 Video:" line links the GIF first and the recording (the shrunk copy under 10 MB, if needed) as "(full video)": `[desktop](…gif) ([full video](…webm))`.
- The first GIF becomes the card cover (`idAttachmentCover`), so the newest change moves on the board.
- If ffmpeg fails, or the GIF can't be uploaded (e.g. over Trello's 10 MB limit), the recording is attached and linked as before, without a cover. A recording that already is a GIF is attached as it is (and can be the cover).
- The local GIF is always deleted afterwards, also when an upload fails, so the next run doesn't attach it as a video of its own. A recording whose upload failed stays for the next run.

## Why

Trello's attachment viewer never autoplays a video, so the chef had to press play on every change video. A GIF moves on its own in Trello's preview and on the card.

Not in this change: autoplay on the local review page. The chef dropped it, since the review page is being removed from main.

## How to test by hand

1. Put a short recording at `logs/videos/card-<n>-desktop.webm` for a test card and let a build or review finish on it (or move a UI card through To Do).
2. The report comment starts with "🎬 Video: [desktop](…) ([full video](…))". The first link opens a GIF that moves without a click, the second the webm.
3. The card shows the GIF as its cover, moving on the board.
4. `logs/videos/` holds no `card-<n>-*` files afterwards.
5. Without ffmpeg on the PATH, the report links only the webm, as before.
