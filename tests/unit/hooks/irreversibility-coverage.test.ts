/**
 * #199 audit — classification coverage of IrreversibilityScorer.toolToAction().
 *
 * Characterization only: this pins which tool names resolve to a scored
 * category today and which fall through to the unknown-tool default (50, i.e.
 * below the flag threshold of 65, so allowed with a warning). It changes no
 * score and weakens no check. If a gap below is closed, move the name from
 * GAPS to COVERED; a surprise change in either list is the signal.
 */
import { describe, it, expect } from 'vitest';
import {
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
  ['mcp__zora-tools__send_message', 'send_message'],
  ['git_push', 'git_push'],
  ['rm', 'file_delete'],
];

// Names with no mapping: they resolve to themselves, which has no entry in the
// score table, so the scorer uses its default of 50.
const GAPS = [
  // Zora's own tools (src/tools)
  'mcp__zora-tools__memory_save',
  'mcp__zora-tools__memory_forget',
  'mcp__zora-tools__memory_search',
  'mcp__zora-tools__graph_recall',
  'mcp__zora-tools__delegate_to_subagent',
  'mcp__zora-tools__list_subagents',
  // Representative third-party MCP verbs from the OpenBot kinds (pay, credential,
  // share, publish, send, delete) — none is recognized by name.
  'mcp__gmail__send_email',
  'mcp__stripe__create_refund',
  'mcp__drive__share_file',
  'mcp__x__post_tweet',
  'mcp__calendar__delete_event',
  'mcp__vault__rotate_api_key',
];

describe('IrreversibilityScorer classification coverage (#199)', () => {
  it.each(COVERED)('%s resolves to scored category %s', (tool, action) => {
    expect(toolToAction(tool)).toBe(action);
    expect(DEFAULT_IRREVERSIBILITY_SCORES[action]).toBeDefined();
  });

  it.each(GAPS)('%s is unclassified and scores the default 50 (below flag)', (tool) => {
    const action = toolToAction(tool);
    expect(DEFAULT_IRREVERSIBILITY_SCORES[action]).toBeUndefined();
    expect(50).toBeLessThan(DEFAULT_IRREVERSIBILITY_THRESHOLDS.flag);
  });

  it('shell_exec_destructive has a score but toolToAction never returns it', () => {
    expect(DEFAULT_IRREVERSIBILITY_SCORES['shell_exec_destructive']).toBe(90);
    expect(toolToAction('Bash')).toBe('shell_exec');
  });
});
