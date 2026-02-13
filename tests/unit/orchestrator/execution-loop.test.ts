import { describe, it, expect } from 'vitest';
import { ExecutionLoop } from '../../../src/orchestrator/execution-loop.js';
import type { ZoraExecutionOptions } from '../../../src/orchestrator/execution-loop.js';

describe('ExecutionLoop', () => {
  const baseOptions: ZoraExecutionOptions = {
    systemPrompt: 'You are Zora, a helpful agent.',
    cwd: '/tmp',
    model: 'sonnet',
    maxTurns: 50,
    permissionMode: 'default',
  };

  it('accepts ZoraExecutionOptions and stores them', () => {
    const loop = new ExecutionLoop(baseOptions);
    expect(loop.options).toBe(baseOptions);
  });

  it('stores systemPrompt correctly', () => {
    const loop = new ExecutionLoop(baseOptions);
    expect(loop.options.systemPrompt).toBe('You are Zora, a helpful agent.');
  });

  it('stores model and maxTurns correctly', () => {
    const loop = new ExecutionLoop(baseOptions);
    expect(loop.options.model).toBe('sonnet');
    expect(loop.options.maxTurns).toBe(50);
  });

  it('stores permissionMode correctly', () => {
    const loop = new ExecutionLoop(baseOptions);
    expect(loop.options.permissionMode).toBe('default');
  });

  it('stores MCP server config', () => {
    const opts: ZoraExecutionOptions = {
      ...baseOptions,
      mcpServers: {
        github: { type: 'stdio', command: 'gh-mcp', args: ['--token', 'xxx'] },
        web: { type: 'sse', url: 'http://localhost:9000/mcp' },
      },
    };
    const loop = new ExecutionLoop(opts);
    expect(loop.options.mcpServers).toHaveProperty('github');
    expect(loop.options.mcpServers).toHaveProperty('web');
    expect(loop.options.mcpServers!.github.type).toBe('stdio');
    expect(loop.options.mcpServers!.web.url).toBe('http://localhost:9000/mcp');
  });

  it('stores agent definitions', () => {
    const opts: ZoraExecutionOptions = {
      ...baseOptions,
      agents: {
        researcher: {
          description: 'Searches codebases',
          prompt: 'You are a research agent.',
          model: 'haiku',
        },
      },
    };
    const loop = new ExecutionLoop(opts);
    expect(loop.options.agents).toHaveProperty('researcher');
    expect(loop.options.agents!.researcher.model).toBe('haiku');
  });

  it('stores canUseTool callback', () => {
    const canUseTool = async () => ({ behavior: 'allow' as const, updatedInput: {} });
    const opts: ZoraExecutionOptions = { ...baseOptions, canUseTool };
    const loop = new ExecutionLoop(opts);
    expect(loop.options.canUseTool).toBe(canUseTool);
  });

  it('stores onMessage callback', () => {
    const onMessage = () => {};
    const opts: ZoraExecutionOptions = { ...baseOptions, onMessage };
    const loop = new ExecutionLoop(opts);
    expect(loop.options.onMessage).toBe(onMessage);
  });

  it('accepts minimal options', () => {
    const loop = new ExecutionLoop({});
    expect(loop.options).toEqual({});
    expect(loop.options.systemPrompt).toBeUndefined();
    expect(loop.options.mcpServers).toBeUndefined();
  });
});
