import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTaskEvent } from '../../../src/dashboard/frontend/src/task-events.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/dashboard/frontend/src/App.tsx');

describe('dashboard task lifecycle events (#167)', () => {
  it('done ends the task and carries the result text', () => {
    expect(classifyTaskEvent({ type: 'done', data: { text: 'result' } })).toEqual({ finished: true, resultText: 'result' });
    expect(classifyTaskEvent({ type: 'done', data: {} })).toEqual({ finished: true, resultText: undefined });
    expect(classifyTaskEvent({ type: 'done' }).finished).toBe(true);
  });

  it('job_failed ends the task with a failure message', () => {
    expect(classifyTaskEvent({ type: 'job_failed', data: { jobId: 'j', error: 'boom' } })).toEqual({ finished: true, failure: 'boom' });
    expect(classifyTaskEvent({ type: 'job_failed', data: {} }).failure).toBe('Task failed');
  });

  it('legacy job_update completed/failed still ends; progress events do not', () => {
    expect(classifyTaskEvent({ type: 'job_update', data: { status: 'completed' } }).finished).toBe(true);
    expect(classifyTaskEvent({ type: 'job_update', data: { status: 'running' } }).finished).toBe(false);
    for (const type of ['tool_call', 'tool_result', 'text', 'error', 'connected']) {
      expect(classifyTaskEvent({ type, data: {} }).finished).toBe(false);
    }
  });

  it('chat submits to /api/task, not /api/steer', () => {
    const src = fs.readFileSync(APP, 'utf8');
    const submit = src.slice(src.indexOf('const handleSubmitTask'), src.indexOf('// Auto-scroll'));
    expect(submit).toContain("axios.post('/api/task'");
    expect(submit).not.toContain("axios.post('/api/steer'");
  });
});
