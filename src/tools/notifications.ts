/**
 * Notification Tools — macOS native notifications.
 *
 * Spec §5.3 "Built-in Tools":
 *   - notify_user: Send macOS notification
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class NotificationTools {
  /**
   * Sends a macOS native notification using AppleScript.
   */
  async notify(title: string, message: string): Promise<void> {
    // Safer approach: pass strings as arguments to the script
    // This avoids manual escaping and prevents injection.
    const script = 'on run argv\n' +
                   '  display notification (item 2 of argv) with title "Zora" subtitle (item 1 of argv)\n' +
                   'end run';
    
    try {
      await execFileAsync('osascript', ['-e', script, title, message]);
    } catch (err) {
      // If notification fails (e.g. not on macOS or headless), we log to console
      console.log(`[Notification] ${title}: ${message}`);
    }
  }
}
