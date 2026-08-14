/**
 * Ontology allowlist and surrogate-key tests (MEM-33).
 *
 * These replace the escaper tests that MEM-30 shipped. The escaper is gone —
 * sparrowdb 0.1.24 binds parameters, so no value is interpolated any more —
 * and what remains to guard are the three positions Cypher cannot parameterize
 * at all: labels, relationship types and property keys. Those are checked
 * against the ontology itself rather than against a character pattern, which
 * is a stronger claim: a closed set of four labels cannot be talked into
 * accepting a fifth.
 */

import { describe, it, expect } from 'vitest';
import {
  GraphIdentifierError,
  PROPERTY_KEYS,
  assertEdgeType,
  assertNodeLabel,
  assertPropertyKey,
  assertSurrogateId,
  surrogateId,
} from '../../../../src/memory/graph/identifiers.js';
import { EDGE_TYPES, NODE_LABELS } from '../../../../src/memory/graph/graph-types.js';

/** A raw NUL byte, built by code so it never appears literally in this file. */
const NUL = String.fromCharCode(0);

/**
 * Identifier-position payloads. None of these can be escaped in Cypher — there
 * is no escape syntax for a label — so the only defence is refusing them.
 */
const HOSTILE_IDENTIFIERS = [
  'Entity {name:1}) CREATE (n',
  'Entity`',
  'Entity Entity',
  'Entity-Type',
  '1Entity',
  '',
  ':Entity',
  'Entity)',
  `Entity${NUL}`,
  'a'.repeat(65),
  'entity', // right word, wrong case — still not a member
  'Entity ',
  ' Entity',
  '$lbl',
  'Entity OR 1=1',
  'MATCH',
];

describe('assertNodeLabel', () => {
  it('accepts every label the ontology defines', () => {
    for (const label of NODE_LABELS) expect(assertNodeLabel(label)).toBe(label);
  });

  it('rejects anything that is not an ontology label', () => {
    for (const value of [...HOSTILE_IDENTIFIERS, 'User', 'Admin', 'MENTIONS']) {
      expect(() => assertNodeLabel(value)).toThrow(GraphIdentifierError);
    }
  });

  it('rejects non-strings', () => {
    for (const value of [7, null, undefined, {}, ['Entity']]) {
      expect(() => assertNodeLabel(value)).toThrow(GraphIdentifierError);
    }
  });

  it('names the permitted labels in the error, so a typo is self-diagnosing', () => {
    expect(() => assertNodeLabel('Entty')).toThrow(/Entity, Task, Decision, Failure/);
  });
});

describe('assertEdgeType', () => {
  it('accepts every relationship type the ontology defines', () => {
    for (const type of EDGE_TYPES) expect(assertEdgeType(type)).toBe(type);
  });

  it('rejects anything else, including node labels', () => {
    for (const value of [...HOSTILE_IDENTIFIERS, 'Entity', 'KNOWS', 'mentions']) {
      expect(() => assertEdgeType(value)).toThrow(GraphIdentifierError);
    }
  });
});

describe('assertPropertyKey', () => {
  it('accepts every property key the ontology defines', () => {
    for (const key of PROPERTY_KEYS) expect(assertPropertyKey(key)).toBe(key);
  });

  it('rejects anything else', () => {
    for (const value of [...HOSTILE_IDENTIFIERS, 'role', 'admin', 'password', 'Name']) {
      expect(() => assertPropertyKey(value)).toThrow(GraphIdentifierError);
    }
  });

  it('rejects the injected key from the original 0.1.21 exploit', () => {
    // The S0 repro added a `role` property by closing the `name` value. Even
    // if a value somehow reached a key position now, `role` is not in the
    // ontology and never becomes syntax.
    expect(() => assertPropertyKey('role')).toThrow(GraphIdentifierError);
    expect(() => assertPropertyKey('", role: "admin')).toThrow(GraphIdentifierError);
  });

  it('keeps property names unique across the whole ontology', () => {
    // sparrowdb resolves a projected property by name rather than by the
    // pattern variable it was qualified with, so an edge property sharing a
    // node property's name reads back the node's value. `relKind` exists
    // because of that; `kind` must not be reused for the edge.
    expect(new Set(PROPERTY_KEYS).size).toBe(PROPERTY_KEYS.length);
    expect(PROPERTY_KEYS).toContain('relKind');
  });
});

describe('surrogateId', () => {
  it('is deterministic for the same node', () => {
    expect(surrogateId('Task', 'jobId', 'job-1')).toBe(surrogateId('Task', 'jobId', 'job-1'));
  });

  it('separates nodes that differ only by label', () => {
    expect(surrogateId('Entity', 'name', 'x')).not.toBe(surrogateId('Decision', 'summary', 'x'));
  });

  it('cannot be collided by concatenation ambiguity', () => {
    // The components are NUL-separated, so a value cannot impersonate a
    // longer key plus a shorter value.
    expect(surrogateId('Task', 'jobId', 'ab')).not.toBe(surrogateId('Task', 'jobId', 'a' + NUL + 'b'));
  });

  it('always produces the shape the interpolation guard demands', () => {
    const values = [
      '',
      'plain',
      "'}) CREATE (evil:Entity {name:'pwned'}) MATCH (n:Entity {name:'",
      '", role: "admin',
      `nul${NUL}byte`,
      '日本語 🎉',
      'x'.repeat(10_000),
      '$name',
      "', zid: 'deadbeefdeadbeefdeadbeefdeadbeef",
    ];
    for (const value of values) {
      const id = surrogateId('Entity', 'name', value);
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(() => assertSurrogateId(id)).not.toThrow();
    }
  });

  it('will not derive an id for a label or key outside the ontology', () => {
    expect(() => surrogateId('User', 'name', 'x')).toThrow(GraphIdentifierError);
    expect(() => surrogateId('Entity', 'role', 'x')).toThrow(GraphIdentifierError);
  });
});

describe('assertSurrogateId', () => {
  it('accepts a well-formed id', () => {
    expect(assertSurrogateId('0123456789abcdef0123456789abcdef')).toBe(
      '0123456789abcdef0123456789abcdef',
    );
  });

  it('rejects anything that could carry Cypher syntax into an endpoint selector', () => {
    // This is the guard that makes interpolating a `zid` safe, so it must
    // reject on shape alone — length, alphabet and case.
    const bad = [
      '',
      '0123456789abcdef0123456789abcde', // 31
      '0123456789abcdef0123456789abcdef0', // 33
      '0123456789ABCDEF0123456789ABCDEF', // uppercase
      "0123456789abcdef0123456789abcde'",
      "'}) CREATE (n:Entity {zid:'x",
      "abc' OR '1'='1",
      `0123456789abcdef0123456789abcde${NUL}`,
      'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
    ];
    for (const value of bad) expect(() => assertSurrogateId(value)).toThrow(GraphIdentifierError);
  });

  it('rejects non-strings', () => {
    for (const value of [7, null, undefined, {}]) {
      expect(() => assertSurrogateId(value)).toThrow(GraphIdentifierError);
    }
  });
});
