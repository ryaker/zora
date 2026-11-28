/**
 * #199 audit — classification coverage of IrreversibilityScorer.toolToAction().
 *
 * Characterization only. Pins which tool names resolve to a scored category in
 * toolToAction() and which resolve to a key with no score, so the scorer falls
 * back to its default of 50. It changes no score and weakens no check. This
 * covers the *scorer hook only*: other layers (PolicyEngine, ShellSafety,
 * capability tokens, canUseTool) still apply independently, so 'the scorer does
 * not flag it' is not 'policy allows it'. If a gap is closed, move the name
 * from GAPS to COVERED.
 */
import { describe, it, expect } from 'vitest';
import {
  IrreversibilityScorerHook,
  toolToAction,
  DEFAULT_IRREVERSIBILITY_SCORES,
  DEFAULT_IRREVERSIBILITY_THRESHOLDS,
} from '../../../src/hooks/built-in/irreversibility-scorer.js';

const COVERED: Array<[string, string]> = [
  ['Bash', 'shell_exec'],
  ['Write', 'write_file'],
  ['Edit', 'edit_file'],
  ['Read', 'read_file'],
  ['WebFetch', 'http_request'],
  ['Task', 'spawn_agent'],
  // #265: Zora's own server speaks as Zora; a bare send_message does not.
  ['mcp__zora-tools__send_message', 'send_as_zora'],
  ['send_message', 'send_message'],
  // #265: connector tools are classified by effect, not looked up by name.
  ['mcp__gmail__send_email', 'send_message'],
  ['mcp__x__post_tweet', 'send_message'],
  ['mcp__drive__share_file', 'send_message'],
  ['mcp__calendar__delete_event', 'remote_delete'],
  // #200: payments ask (90).
  ['mcp__stripe__create_refund', 'payment'],
  ['git_push', 'git_push'],
  ['rm', 'file_delete'],
  // #194c: retrieval is a read (~5), not an unscored unknown action.
  ['mcp__zora-tools__memory_search', 'read_file'],
  ['mcp__zora-tools__recall_context', 'read_file'],
];

// Names with no mapping: they resolve to themselves, which has no entry in the
// score table, so the scorer uses its default of 50.
const GAPS = [
  // Zora's own tools (src/tools)
  'mcp__zora-tools__memory_save',
  'mcp__zora-tools__memory_forget',
  'mcp__zora-tools__graph_recall',
  'mcp__zora-tools__delegate_to_subagent',
  'mcp__zora-tools__list_subagents',
  // Representative third-party MCP verbs from the OpenBot kinds. Send, share,
  // publish and delete are classified by effect since #265; payments ask and
  // credential changes are human-only since #200 (see human-only.test.ts).
];

describe('IrreversibilityScorer classification coverage (#199)', () => {
  it.each(COVERED)('%s resolves to scored category %s', (tool, action) => {
    expect(toolToAction(tool)).toBe(action);
    expect(DEFAULT_IRREVERSIBILITY_SCORES[action]).toBeDefined();
  });

  it.each(GAPS)('%s is unclassified: no score entry, and the real scorer applies its default', async (tool) => {
    expect(DEFAULT_IRREVERSIBILITY_SCORES[toolToAction(tool)]).toBeUndefined();
    // Exercise the actual fallback: default config, no approval queue, no
    // forecaster/project policy registered for this job id. A flagged score
    // would deny here (no queue to escalate to), so allow=true shows the
    // fallback stays under the flag threshold in this hook.
    const hook = new IrreversibilityScorerHook({
      scores: { ...DEFAULT_IRREVERSIBILITY_SCORES },
      thresholds: { ...DEFAULT_IRREVERSIBILITY_THRESHOLDS },
    });
    const res = await hook.run({ jobId: 'audit-199-no-policy', tool, arguments: {} });
    expect(res.allow).toBe(true);
  });

  it('shell_exec_destructive has a score, but none of the names audited here map to it', () => {
    expect(DEFAULT_IRREVERSIBILITY_SCORES['shell_exec_destructive']).toBe(90);
    // Mapping coverage only: this does not prove no input can resolve to it.
    for (const tool of [...COVERED.map(([t]) => t), ...GAPS]) {
      expect(toolToAction(tool)).not.toBe('shell_exec_destructive');
    }
  });
});
