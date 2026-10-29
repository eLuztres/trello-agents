import { spawn } from 'node:child_process';

export function notifyDesktop(title: string, body: string): void {
  spawn('notify-send', ['--app-name=Trello agents', title, body], { stdio: 'ignore' }).on('error', () => {
    // No notification daemon: the Trello comment still tells you.
  });
}

export function openInBrowser(url: string): void {
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {
    // No desktop: the video link is on the card anyway.
  }).unref();
}
