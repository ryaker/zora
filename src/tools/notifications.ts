/**
 * Notification Tools — macOS native notifications.
 *
 * Spec §5.3 "Built-in Tools":
 *   - notify_user: Send macOS notification
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const log = createLogger('notifications');

export class NotificationTools {
  /**
   * Sends a macOS native notification using AppleScript.
   */
  async notify(title: string, message: string): Promise<void> {
    // To prevent AppleScript injection, we must escape backslashes first, then double quotes.
    // In AppleScript strings, a quote is escaped as \" and a backslash as \\.
    const escapeForAppleScript = (str: string) => 
      str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const escapedTitle = escapeForAppleScript(title);
    const escapedMessage = escapeForAppleScript(message);
    
    const script = `display notification "${escapedMessage}" with title "Zora" subtitle "${escapedTitle}"`;
    
    try {
      await execFileAsync('osascript', ['-e', script]);
    } catch (err) {
      // If notification fails (e.g. not on macOS or headless), we log to console
      log.info({ title, message }, 'Notification fallback (osascript unavailable)');
    }
  }
}
