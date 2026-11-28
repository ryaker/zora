/**
 * Frozen fixtures for the offline ontology retrieval benchmark (#241, Stage 1).
 *
 * Everything here is hand-written and deterministic. `facts` are FROZEN
 * extractor outputs: the benchmark measures retrieval, not extraction (which
 * needs a model and is measured separately). Facts are written the way the
 * real extractor behaves: exact (kind, name) entities, free-form relation kinds.
 *
 * Memories are dated so temporal/supersession questions have a stale item and a
 * current one; supersession is NOT modelled in the graph (that is #244), so the
 * benchmark shows what happens today.
 */
import type { EntityKind } from '../../../src/memory/graph/graph-types.js';

export interface Ent { name: string; kind: EntityKind }
export interface FixtureMemory {
  key: string;
  summary: string;
  /** Frozen extractor output for this memory. */
  entities: Ent[];
  relations?: Array<{ from: Ent; to: Ent; kind: string }>;
}

export type QuestionType = 'single-hop' | 'multi-hop' | 'alias' | 'temporal' | 'provenance';
export interface Question {
  id: string;
  type: QuestionType;
  query: string;
  /** What arm B passes to memory_search besides the query. */
  entity?: Ent;
  relation?: { from: Ent; to: Ent; predicate: string };
  /** Hand-labelled supporting memory keys. */
  gold: string[];
}

const E = (name: string, kind: EntityKind): Ent => ({ name, kind });
export const ZORA = E('Zora', 'project');
export const SPARROW = E('SparrowDB', 'tool');
export const SIGNAL = E('Signal', 'tool');
export const TELEGRAM = E('Telegram', 'tool');
export const SLACK = E('Slack', 'tool');
export const ONECLI = E('OneCLI', 'tool');
export const OLLAMA = E('Ollama', 'tool');
export const NANOCLAW = E('NanoClaw', 'project');
export const RICHARD = E('Richard', 'person');
export const HERMES = E('Hermes', 'tool');
export const WSJF = E('WSJF', 'concept');

export const MEMORIES: FixtureMemory[] = [
  // — Zora + storage
  { key: 'z1', summary: 'Zora stores graph memory in SparrowDB, an embedded graph database, behind a feature flag.', entities: [ZORA, SPARROW], relations: [{ from: ZORA, to: SPARROW, kind: 'uses' }] },
  { key: 'z2', summary: 'SparrowDB has no prebuilt binary for Linux ARM64, so graph memory degrades to lexical search there.', entities: [SPARROW] },
  { key: 'z3', summary: 'The graph tier only proposes memory IDs; each one is re-checked against current memory content before it is returned.', entities: [] },
  { key: 'z4', summary: 'Zora keeps its safety rules in policy.toml, consulted before every tool call rather than in the conversation.', entities: [ZORA] },
  { key: 'z5', summary: 'Zora runs as a long-lived daemon on the M2 Air and restarts through launchd.', entities: [ZORA] },
  { key: 'z6', summary: 'Zora memory retrieval needs no permission gate; the ontology ranks results and never blocks them.', entities: [ZORA] },
  { key: 'z7', summary: 'The audit log in Zora is hash-chained and append-only so tampering is detectable.', entities: [ZORA] },
  { key: 'z8', summary: 'Zora quarantines channel message content with a dual-LLM step before the privileged loop sees it.', entities: [ZORA] },
  // — channels
  { key: 'c1', summary: 'Zora talks to Signal through signal-cli running as a local intake process.', entities: [ZORA, SIGNAL], relations: [{ from: ZORA, to: SIGNAL, kind: 'uses' }] },
  { key: 'c2', summary: 'Signal group replies need the quote timestamp and author of the original message.', entities: [SIGNAL] },
  { key: 'c3', summary: 'Telegram polling and a webhook must never run together against one bot token.', entities: [TELEGRAM] },
  { key: 'c4', summary: 'Zora gets Telegram updates through the Vercel chat SDK adapter in polling mode by default.', entities: [ZORA, TELEGRAM], relations: [{ from: ZORA, to: TELEGRAM, kind: 'uses' }] },
  { key: 'c5', summary: 'The Slack adapter connects over Socket Mode so no public URL is needed.', entities: [SLACK] },
  { key: 'c6', summary: 'Zora joins the zora-agents Slack channel through a Socket Mode adapter.', entities: [ZORA, SLACK], relations: [{ from: ZORA, to: SLACK, kind: 'uses' }] },
  { key: 'c7', summary: 'Webhook deliveries are authenticated by WebhookServer with a constant-time secret comparison.', entities: [] },
  // — credentials / infra
  { key: 'i1', summary: 'OneCLI injects real credentials at the gateway, so agents only ever hold the placeholder token.', entities: [ONECLI] },
  { key: 'i2', summary: 'NanoClaw agents reach GitHub through OneCLI, using the literal token onecli-managed.', entities: [NANOCLAW, ONECLI], relations: [{ from: NANOCLAW, to: ONECLI, kind: 'uses' }] },
  { key: 'i3', summary: 'The OneCLI gateway sometimes answers 502; retrying after a few seconds works.', entities: [ONECLI] },
  { key: 'i4', summary: 'NanoClaw runs each agent in its own container with a private workspace mount.', entities: [NANOCLAW] },
  { key: 'i5', summary: 'NanoClaw tasks run on a cron-like schedule and write a run log.', entities: [NANOCLAW] },
  // — models
  { key: 'm1', summary: 'Ollama serves local and cloud models; Zora reaches it at host.docker.internal port 11434.', entities: [ZORA, OLLAMA], relations: [{ from: ZORA, to: OLLAMA, kind: 'uses' }] },
  { key: 'm2', summary: 'Ollama cloud models deepseek and glm scored 9 of 12 on the smoke bake-off.', entities: [OLLAMA] },
  { key: 'm3', summary: 'In the bake-off every model called memory_search where send_message was expected.', entities: [] },
  { key: 'm4', summary: 'Node fetch needs NO_PROXY=host.docker.internal to reach Ollama from the sandbox.', entities: [OLLAMA] },
  { key: 'm5', summary: 'Hermes is the open model used as the referee agent via Ollama.', entities: [HERMES, OLLAMA], relations: [{ from: HERMES, to: OLLAMA, kind: 'runs on' }] },
  // — process
  { key: 'p1', summary: 'Work is ordered by WSJF: business value plus time criticality plus risk reduction over job size.', entities: [WSJF] },
  { key: 'p2', summary: 'Richard asked that research findings go straight to agent:todo with a WSJF line.', entities: [RICHARD, WSJF], relations: [{ from: RICHARD, to: WSJF, kind: 'requested' }] },
  { key: 'p3', summary: 'Richard decided needs-richard is only for money, his accounts, or loosening security.', entities: [RICHARD] },
  { key: 'p4', summary: 'Richard prefers short plain-words questions with a proposal rather than bare PR numbers.', entities: [RICHARD] },
  { key: 'p5', summary: 'The architect keeps at most three open PRs at once.', entities: [] },
  // — temporal pairs (old, then new)
  { key: 't1_old', summary: 'On 2026-11-10 the review cap was three rounds before escalating.', entities: [ZORA] },
  { key: 't1_new', summary: 'On 2026-11-23 Richard removed the fixed review-round cap; only repeated disagreement escalates.', entities: [ZORA, RICHARD] },
  { key: 't2_old', summary: 'On 2026-11-12 Telegram ran in polling mode only.', entities: [TELEGRAM] },
  { key: 't2_new', summary: 'On 2026-11-20 Telegram gained a webhook mode selected by config, polling stays the default.', entities: [TELEGRAM] },
  // — alias: the memory never uses the canonical name the graph holds
  { key: 'a1', summary: 'The assistant daemon restarts automatically after a crash within ten seconds.', entities: [ZORA] },
  { key: 'a2', summary: 'Sparrow stores edges as typed relationships with a kind property.', entities: [SPARROW] },
  { key: 'a3', summary: 'The Slack bot token lives in the gateway, never in the repo.', entities: [SLACK, ONECLI] },
  // — filler / distractors that share words but are unrelated
  { key: 'd1', summary: 'A sparrow was seen outside the office window on Tuesday.', entities: [] },
  { key: 'd2', summary: 'Signal strength on the office wifi is weak near the kitchen.', entities: [] },
  { key: 'd3', summary: 'The telegram from the archive describes a historic 1900s event.', entities: [] },
  { key: 'd4', summary: 'Gateway timeout settings for the staging proxy are 30 seconds.', entities: [] },
  { key: 'd5', summary: 'Slack time between meetings is limited on Fridays.', entities: [] },
  { key: 'd6', summary: 'The project retrospective is scheduled for the first Monday of the month.', entities: [] },
  { key: 'd7', summary: 'Local model weights are stored on the external drive.', entities: [] },
  { key: 'd8', summary: 'Container images are rebuilt weekly on the build host.', entities: [] },
  { key: 'e1', summary: "The weekly report lists open pull requests, escalation notes and review status for each agent.", entities: [] },
  { key: 'e2', summary: "Escalation of a disagreement goes to a referee model, whose ruling the reviewer weighs.", entities: [] },
  { key: 'e3', summary: "Delivery of update notifications to the owner happens through the chat channels each morning.", entities: [] },
  { key: 'e4', summary: "Database backups for the staging environment run nightly at two in the morning.", entities: [] },
  { key: 'e5', summary: "A storage engine benchmark compared B-tree and LSM layouts for the analytics warehouse.", entities: [] },
  { key: 'e6', summary: "Messenger apps differ in how they deliver rules for group admins and bots.", entities: [] },
  { key: 'e7', summary: "The bot lunch order is collected in the team chat on Thursdays.", entities: [] },
  { key: 'e8', summary: "Edges in the office floor plan are marked with yellow tape near the exits.", entities: [] },
  { key: 'e9', summary: "Model railway setup notes: the local layout uses three serving sidings.", entities: [] },
  { key: 'e10', summary: "Prioritisation of the home renovation scoring was done on a whiteboard.", entities: [] },
  { key: 'e11', summary: "Credential rotation for the staging database happens every ninety days.", entities: [] },
  { key: 'e12', summary: "Agents in the travel office authenticate customers with passports at the desk.", entities: [] },
  { key: 'e13', summary: "A daemon in Unix folklore is a background process; the term predates computing.", entities: [] },
  { key: 'e14', summary: "Lookups in the company phone directory are gated by a login on the intranet.", entities: [] },
  { key: 'e15', summary: "The cap on expense reports was raised and the escalation rule for approvals changed.", entities: [] },
  { key: 'e16', summary: "Referee serving instructions for the weekend football league are posted on the club site.", entities: [] },
];

export const QUESTIONS: Question[] = [
  // single-hop: everything the graph links to one entity
  { id: 'q1', type: 'single-hop', query: 'embedded database quirks on this machine', entity: SPARROW, gold: ['z1', 'z2'] },
  { id: 'q2', type: 'single-hop', query: 'secure messenger integration notes', entity: SIGNAL, gold: ['c1', 'c2'] },
  { id: 'q3', type: 'single-hop', query: 'bot update delivery rules', entity: TELEGRAM, gold: ['c3', 'c4', 't2_new'] },
  { id: 'q4', type: 'single-hop', query: 'where do real secrets get injected', entity: ONECLI, gold: ['i1', 'i2', 'i3'] },
  { id: 'q5', type: 'single-hop', query: 'local model serving setup', entity: OLLAMA, gold: ['m1', 'm2', 'm4'] },
  { id: 'q6', type: 'single-hop', query: 'what has the owner ruled on process', entity: RICHARD, gold: ['p2', 'p3', 'p4'] },
  // multi-hop: a relation between two entities
  { id: 'q7', type: 'multi-hop', query: 'which storage engine backs the ontology tier', relation: { from: ZORA, to: SPARROW, predicate: 'uses' }, gold: ['z1'] },
  { id: 'q8', type: 'multi-hop', query: 'how does the agent reach the secure messenger', relation: { from: ZORA, to: SIGNAL, predicate: 'uses' }, gold: ['c1'] },
  { id: 'q9', type: 'multi-hop', query: 'how do containerised agents authenticate to GitHub', relation: { from: NANOCLAW, to: ONECLI, predicate: 'uses' }, gold: ['i2'] },
  { id: 'q10', type: 'multi-hop', query: 'what serves the referee model', relation: { from: HERMES, to: OLLAMA, predicate: 'runs on' }, gold: ['m5'] },
  { id: 'q11', type: 'multi-hop', query: 'how does the agent join the team chat', relation: { from: ZORA, to: SLACK, predicate: 'uses' }, gold: ['c6'] },
  // alias: gold memory does not contain the canonical name; the real tool's
  // stale-evidence check (name must still appear in the text) should drop them.
  { id: 'q12', type: 'alias', query: 'self-healing behaviour of the always-on service', entity: ZORA, gold: ['a1'] },
  { id: 'q13', type: 'alias', query: 'how are links persisted', entity: SPARROW, gold: ['a2'] },
  { id: 'q14', type: 'alias', query: 'where are chat app secrets held', entity: SLACK, gold: ['a3'] },
  // temporal: the current fact must be present; the stale one is a known miss today
  { id: 'q15', type: 'temporal', query: 'what is the escalation rule for reviews now', entity: ZORA, gold: ['t1_new'] },
  { id: 'q16', type: 'temporal', query: 'which delivery modes does the bot support now', entity: TELEGRAM, gold: ['t2_new'] },
  // provenance: every memory that supports a statement
  { id: 'q17', type: 'provenance', query: 'which memories describe tools the agent depends on', entity: ZORA, gold: ['z1', 'c1', 'c4', 'c6', 'm1'] },
  { id: 'q18', type: 'provenance', query: 'evidence that lookups are not gated', entity: ZORA, gold: ['z6'] },
  { id: 'q19', type: 'provenance', query: 'what supports prioritisation scoring', entity: WSJF, gold: ['p1', 'p2'] },
  { id: 'q20', type: 'provenance', query: 'where is the container agent credential flow described', entity: NANOCLAW, gold: ['i2'] },
];
