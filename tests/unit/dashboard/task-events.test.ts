import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTaskEvent, eventJobId, reconcileFinalText } from '../../../src/dashboard/frontend/src/task-events.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/dashboard/frontend/src/App.tsx');

describe('dashboard task lifecycle events (#167)', () => {
  it('job_completed (task promise resolved) is terminal and carries the result', () => {
    expect(classifyTaskEvent({ type: 'job_completed', data: { jobId: 'j', text: 'result' } })).toEqual({ finished: true, resultText: 'result' });
    expect(classifyTaskEvent({ type: 'job_completed', data: {} })).toEqual({ finished: true, resultText: undefined });
  });

  it('job_failed ends the task with a failure message', () => {
    expect(classifyTaskEvent({ type: 'job_failed', data: { jobId: 'j', error: 'boom' } })).toEqual({ finished: true, failure: 'boom' });
    expect(classifyTaskEvent({ type: 'job_failed', data: {} }).failure).toBe('Task failed');
  });

  it('provider done / task.end are NOT terminal (failover or retry can follow)', () => {
    expect(classifyTaskEvent({ type: 'done', data: { text: 'x' } }).finished).toBe(false);
    expect(classifyTaskEvent({ type: 'task.end', data: {} }).finished).toBe(false);
    for (const type of ['tool_call', 'tool_result', 'text', 'error', 'connected']) {
      expect(classifyTaskEvent({ type, data: {} }).finished).toBe(false);
    }
  });

  it('eventJobId prefers the envelope and falls back to data.jobId', () => {
    expect(eventJobId({ type: 'text', jobId: 'a', data: { jobId: 'b' } })).toBe('a');
    expect(eventJobId({ type: 'job_failed', data: { jobId: 'b' } })).toBe('b');
    expect(eventJobId({ type: 'text', data: { text: 'x' } })).toBeUndefined();
  });

  describe('reconcileFinalText', () => {
    it('streamed text equal to the final answer (text → tool → done) is not repeated', () => {
      expect(reconcileFinalText('The answer is 4.', 'The answer is 4.')).toBeUndefined();
    });
    it('interim text does not suppress a distinct final result', () => {
      expect(reconcileFinalText('Let me check.', 'The answer is 4.')).toBe('The answer is 4.');
    });
    it('interim text followed by the streamed final answer is not repeated', () => {
      expect(reconcileFinalText('Let me check.The answer is 4.', 'The answer is 4.')).toBeUndefined();
    });
    it('a done-only result (nothing streamed) is shown', () => {
      expect(reconcileFinalText('', 'only result')).toBe('only result');
    });
    it('no final text yields nothing', () => {
      expect(reconcileFinalText('streamed', undefined)).toBeUndefined();
      expect(reconcileFinalText('', '')).toBeUndefined();
    });
  });

  it('chat submits to /api/task, scopes events to the returned jobId', () => {
    const src = fs.readFileSync(APP, 'utf8');
    const submit = src.slice(src.indexOf('const handleSubmitTask'), src.indexOf('// Auto-scroll'));
    expect(submit).toContain("axios.post('/api/task'");
    expect(submit).not.toContain("axios.post('/api/steer'");
    expect(submit).toContain('activeJobRef.current = jobId');
    expect(src).toContain('evJob !== activeJobRef.current');
  });
});
