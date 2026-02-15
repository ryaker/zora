import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiProvider } from '../../../src/providers/gemini-provider.js';
import type { TaskContext, ProviderConfig } from '../../../src/types.js';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('GeminiProvider', () => {
  let config: ProviderConfig;
  let provider: GeminiProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    config = {
      name: 'gemini-test',
      type: 'gemini-cli',
      rank: 2,
      capabilities: ['search', 'large-context'],
      cost_tier: 'included',
      enabled: true,
      cli_path: 'gemini',
      model: 'gemini-2.0-flash',
    };
    provider = new GeminiProvider({ config });
  });

  function mockSpawn(stdoutData: string, stderrData: string = '', exitCode: number = 0) {
    const stdout = Readable.from([stdoutData]);
    const stderr = Readable.from([stderrData]);
    const child = new EventEmitter() as any;
    child.stdout = stdout;
    child.stderr = stderr;
    
    vi.mocked(spawn).mockReturnValue(child);

    // Simulate exit
    setImmediate(() => {
      child.emit('close', exitCode);
    });

    return child;
  }

  describe('checkAuth', () => {
    it('returns valid true if CLI exits with 0', async () => {
      mockSpawn('gemini v1.0');
      const auth = await provider.checkAuth();
      expect(auth.valid).toBe(true);
    });

    it('returns valid false if CLI exits with non-zero', async () => {
      mockSpawn('', 'Unauthorized', 1);
      const auth = await provider.checkAuth();
      expect(auth.valid).toBe(false);
      expect(auth.requiresInteraction).toBe(true);
    });
  });

  describe('execute', () => {
    const task: TaskContext = {
      jobId: 'job-1',
      task: 'Search for news',
      requiredCapabilities: [],
      complexity: 'simple',
      resourceType: 'search',
      systemPrompt: 'Be concise',
      memoryContext: ['User likes tech'],
      history: [],
    };

    it('yields text events and done', async () => {
      mockSpawn('Found some tech news.\nAll done.');
      
      const events = [];
      for await (const event of provider.execute(task)) {
        events.push(event);
      }

      expect(events.filter(e => e.type === 'text')).toHaveLength(2);
      expect(events[events.length - 1]!.type).toBe('done');
    });

    it('parses XML tool calls', async () => {
      const output = 'I will read the file.\n<tool_call name="read_file">{"path": "foo.txt"}</tool_call>';
      mockSpawn(output);

      const events = [];
      for await (const event of provider.execute(task)) {
        events.push(event);
      }

      const toolCall = events.find(e => e.type === 'tool_call');
      expect(toolCall).toBeDefined();
      expect(toolCall!.content).toMatchObject({
        tool: 'read_file',
        arguments: { path: 'foo.txt' },
      });
    });

    it('parses Markdown JSON tool calls', async () => {
      const output = 'Using JSON format.\n```json\n{"tool": "shell_exec", "arguments": {"command": "ls"}}\n```';
      mockSpawn(output);

      const events = [];
      for await (const event of provider.execute(task)) {
        events.push(event);
      }

      const toolCall = events.find(e => e.type === 'tool_call');
      expect(toolCall).toBeDefined();
      expect(toolCall!.content).toMatchObject({
        tool: 'shell_exec',
        arguments: { command: 'ls' },
      });
    });

    it('handles quota errors (429)', async () => {
      mockSpawn('', 'Error: 429 Rate Limit Exceeded', 1);

      const events = [];
      for await (const event of provider.execute(task)) {
        events.push(event);
      }

      const error = events.find(e => e.type === 'error');
      expect(error).toBeDefined();
      expect((error!.content as any).isQuotaError).toBe(true);
      expect((await provider.getQuotaStatus()).isExhausted).toBe(true);
    });
  });
});
