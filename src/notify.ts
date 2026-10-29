import { spawn } from 'node:child_process';

export function notifyDesktop(title: string, body: string): void {
  spawn('notify-send', ['--app-name=Trello agents', title, body], { stdio: 'ignore' }).on('error', () => {
    // No notification daemon: the Trello comment still tells you.
  });
}
