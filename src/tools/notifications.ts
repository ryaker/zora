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
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedMessage = message.replace(/"/g, '\\"');
    
    const script = `display notification "${escapedMessage}" with title "Zora" subtitle "${escapedTitle}"`;
    
    try {
      await execFileAsync('osascript', ['-e', script]);
    } catch (err) {
      // If notification fails (e.g. not on macOS or headless), we log to console
      console.log(`[Notification] ${title}: ${message}`);
    }
  }
}
