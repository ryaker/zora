import { describe, it, expect, vi } from 'vitest';
import { createAdvisorTool, advisorJobContext, ADVISOR_EXHAUSTED_MESSAGE } from '../../../src/tools/advisor-tool.js';
import { LeakDetector } from '../../../src/security/leak-detector.js';
import { DEFAULT_ADVISOR_MODEL } from '../../../src/providers/model-defaults.js';

const mk = (over: Record<string, unknown> = {}, ask = vi.fn(async () => 'use option 2')) => {
  const audit = vi.fn();
  const tool = createAdvisorTool({ config: { enabled: true, ...over }, ask, leakDetector: new LeakDetector(), audit });
  return { tool, ask, audit };
};
const call = (tool: ReturnType<typeof mk>['tool'], job: string, input: Record<string, unknown> = { question: 'q?' }) =>
  advisorJobContext.run(job, () => tool.handler(input));

describe('consult_advisor (#261)', () => {
  it('asks the default advisor model and returns text', async () => {
    const { tool, ask } = mk();
    expect(await call(tool, 'j1', { question: 'which?', context: 'ctx', options: ['a', 'b'] })).toEqual({ advice: 'use option 2' });
    const [prompt, model] = ask.mock.calls[0] as unknown as [string, string];
    expect(model).toBe(DEFAULT_ADVISOR_MODEL);
    expect(prompt).toContain('1. a');
    expect(prompt).toContain('ctx');
  });

  it('caps calls per task without failing the task', async () => {
    const { tool, ask } = mk({ max_calls_per_task: 2 });
    await call(tool, 'j1'); await call(tool, 'j1');
    expect(await call(tool, 'j1')).toMatchObject({ advice: ADVISOR_EXHAUSTED_MESSAGE, budget_exhausted: true });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(await call(tool, 'j2')).toEqual({ advice: 'use option 2' });
  });

  it('caps calls per day across tasks', async () => {
    const { tool, ask } = mk({ max_calls_per_day: 2 });
    await call(tool, 'a'); await call(tool, 'b');
    expect(await call(tool, 'c')).toMatchObject({ budget_exhausted: true });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('withholds advice containing a secret', async () => {
    const { tool } = mk({}, vi.fn(async () => 'key AKIAABCDEFGHIJKLMNOP'));
    const r = await call(tool, 'j') as { error?: string; advice?: string };
    expect(r.advice).toBeUndefined();
    expect(r.error).toContain('withheld');
  });

  it('degrades to a decide-yourself error when the advisor fails', async () => {
    const { tool, audit } = mk({}, vi.fn(async () => { throw new Error('down'); }));
    expect(await call(tool, 'j')).toMatchObject({ error: expect.stringContaining('decide yourself') });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }));
  });

  it('requires a question and audits every call', async () => {
    const { tool, audit } = mk();
    expect(await call(tool, 'j', {})).toEqual({ error: 'question is required' });
    await call(tool, 'j');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', model: DEFAULT_ADVISOR_MODEL }));
  });
});
