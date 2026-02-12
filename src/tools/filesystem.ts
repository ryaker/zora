/**
 * Filesystem Tools — Standard file operations with policy enforcement.
 *
 * Spec §5.3 "Built-in Tools":
 *   - read_file
 *   - write_file
 *   - edit_file
 *   - list_directory
 */

import fs from 'node:fs';
import path from 'node:path';
import { PolicyEngine } from '../security/policy-engine.js';

export interface ToolResult {
  success: boolean;
  content?: string;
  error?: string;
  path?: string;
}

export class FilesystemTools {
  private readonly _engine: PolicyEngine;

  constructor(engine: PolicyEngine) {
    this._engine = engine;
  }

  /**
   * Reads a file if allowed by policy.
   */
  readFile(filePath: string): ToolResult {
    const validation = this._engine.validatePath(filePath);
    if (!validation.allowed) {
      return { success: false, error: validation.reason };
    }

    try {
      const content = fs.readFileSync(validation.resolvedPath!, 'utf8');
      return { success: true, content, path: validation.resolvedPath };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to read file: ${msg}` };
    }
  }

  /**
   * Writes a file if allowed by policy.
   */
  writeFile(filePath: string, content: string): ToolResult {
    const validation = this._engine.validatePath(filePath);
    if (!validation.allowed) {
      return { success: false, error: validation.reason };
    }

    try {
      const resolvedPath = validation.resolvedPath!;
      // Ensure directory exists
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, content, 'utf8');
      return { success: true, path: resolvedPath };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to write file: ${msg}` };
    }
  }

  /**
   * Lists directory contents if allowed by policy.
   */
  listDirectory(dirPath: string): ToolResult {
    const validation = this._engine.validatePath(dirPath);
    if (!validation.allowed) {
      return { success: false, error: validation.reason };
    }

    try {
      const items = fs.readdirSync(validation.resolvedPath!);
      return { success: true, content: items.join('\n'), path: validation.resolvedPath };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to list directory: ${msg}` };
    }
  }

  /**
   * Surgically replaces text in a file.
   */
  editFile(filePath: string, oldString: string, newString: string): ToolResult {
    const readResult = this.readFile(filePath);
    if (!readResult.success) return readResult;

    const content = readResult.content!;
    if (!content.includes(oldString)) {
      return { 
        success: false, 
        error: `The string to replace was not found in ${filePath}. Use read_file to verify contents.` 
      };
    }

    // Check if there are multiple occurrences
    const occurrences = content.split(oldString).length - 1;
    if (occurrences > 1) {
      return {
        success: false,
        error: `Multiple occurrences of the search string found (${occurrences}). Please provide more context to uniquely identify the target string.`
      };
    }

    const updatedContent = content.replace(oldString, newString);
    return this.writeFile(filePath, updatedContent);
  }
}
