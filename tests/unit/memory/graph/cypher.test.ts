import { describe, it, expect } from 'vitest';
import {
  CypherValidationError,
  MAX_STRING_LENGTH,
  escapeNumber,
  escapeString,
  escapeValue,
  formatPropertyMap,
  nodePattern,
  validateIdentifier,
} from '../../../../src/memory/graph/cypher.js';

/** A raw NUL byte, built by code so it never appears literally in this file. */
const NUL = String.fromCharCode(0);

describe('escapeString', () => {
  it('wraps plain values in single quotes', () => {
    expect(escapeString('hello')).toBe("'hello'");
  });

  it('escapes single quotes', () => {
    expect(escapeString("it's")).toBe("'it\\'s'");
  });

  it('escapes backslashes before quotes, so an escaped quote cannot be un-escaped', () => {
    // A naive escaper that handles quotes but not backslashes turns  \'  into
    // \\'  — which closes the literal. Order matters.
    expect(escapeString("\\'")).toBe("'\\\\\\''");
  });

  it('escapes double quotes', () => {
    expect(escapeString('say "hi"')).toBe("'say \\\"hi\\\"'");
  });

  it('renders newline, carriage return and tab as escape sequences', () => {
    expect(escapeString('a\nb')).toBe("'a\\nb'");
    expect(escapeString('a\rb')).toBe("'a\\rb'");
    expect(escapeString('a\tb')).toBe("'a\\tb'");
  });

  it('replaces NUL and other control characters with spaces', () => {
    // Verified against sparrowdb@0.1.21: a raw NUL in a property value silently
    // truncates the stored string, so it must never reach the query.
    expect(escapeString(`a${NUL}b`)).toBe("'a b'");
    expect(escapeString('a' + String.fromCharCode(7) + 'b')).toBe("'a b'"); // BEL
    expect(escapeString('a' + String.fromCharCode(11) + 'b')).toBe("'a b'"); // vertical tab
    expect(escapeString('a' + String.fromCharCode(27) + 'b')).toBe("'a b'"); // ESC
    expect(escapeString('a' + String.fromCharCode(127) + 'b')).toBe("'a b'"); // DEL
    expect(escapeString('a' + String.fromCharCode(133) + 'b')).toBe("'a b'"); // NEL (C1)
  });

  it('preserves unicode', () => {
    expect(escapeString('日本語 🎉 ünï')).toBe("'日本語 🎉 ünï'");
  });

  it('truncates over-long input rather than rejecting it', () => {
    const long = 'a'.repeat(MAX_STRING_LENGTH + 500);
    const escaped = escapeString(long);
    expect(escaped.length).toBe(MAX_STRING_LENGTH + 2); // + surrounding quotes
  });

  it('respects a custom max length', () => {
    expect(escapeString('abcdef', 3)).toBe("'abc'");
  });

  it('rejects non-strings', () => {
    expect(() => escapeString(42)).toThrow(CypherValidationError);
    expect(() => escapeString(null)).toThrow(CypherValidationError);
    expect(() => escapeString(undefined)).toThrow(CypherValidationError);
  });
});

describe('escapeString — injection attempts', () => {
  // Every one of these is a plausible LLM-generated summary derived from
  // untrusted tool output. None may escape its literal.
  const attempts = [
    // The two vectors reproduced against sparrowdb@0.1.21: the first added an
    // unintended property to a CREATE, the second subverted a WHERE predicate.
    '", role: "admin',
    '" OR n.name <> "',
    "'}) CREATE (evil:Entity {name:'pwned'}) MATCH (n:Entity {name:'",
    "'})-[:X]->(n) //",
    "'; DROP GRAPH; --",
    "\\' OR 1=1 --",
    "x'}) DETACH DELETE n MATCH (n) RETURN n //",
    "') RETURN n UNION MATCH (m) RETURN m //",
    "line1\nCREATE (n:Entity {name:'injected'})",
    "tab\there'}) SET n.kind = 'admin'",
    `${NUL}'}) CREATE (n:Entity {name:'nul'})`,
    "back`tick'}) //",
    '"}) CREATE (n:Entity {name:"dq"}) //',
    "\\\\'}) CREATE (n:Entity {name:'double-backslash'}) //",
  ];

  for (const attempt of attempts) {
    it(`neutralizes ${JSON.stringify(attempt).slice(0, 55)}`, () => {
      const literal = escapeString(attempt);

      // The literal opens and closes exactly once.
      expect(literal.startsWith("'")).toBe(true);
      expect(literal.endsWith("'")).toBe(true);

      // No unescaped single quote survives in the body: every ' must be
      // preceded by an odd number of backslashes.
      const body = literal.slice(1, -1);
      for (let i = 0; i < body.length; i++) {
        if (body[i] !== "'") continue;
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && body[j] === '\\'; j--) backslashes++;
        expect(backslashes % 2).toBe(1);
      }

      // Nothing can start a fresh clause or truncate the statement.
      expect(body).not.toContain('\n');
      expect(body).not.toContain('\r');
      expect(body).not.toContain(NUL);
    });
  }

  it('keeps an injected property map inside the literal when spliced into a pattern', () => {
    const hostile = "'}) CREATE (evil:Entity {name:'pwned'}) MATCH (n:Entity {name:'";
    const query = `MATCH ${nodePattern('n', 'Entity', { name: hostile })} RETURN n.name`;
    // Exactly two single quotes are structural (the ones we emitted); every
    // other quote in the query is escaped.
    const structural = query.split('').filter((c, i) => c === "'" && query[i - 1] !== '\\').length;
    expect(structural).toBe(2);
    // The hostile text survives verbatim *inside* the literal — that is fine
    // and desirable. What must not exist is an UNescaped quote that closes the
    // literal and lets the injected clause become syntax.
    expect(query).not.toMatch(/[^\\]'\}\) CREATE/);
  });

  it('cannot add an extra property via the double-quote vector', () => {
    // Reproduced upstream as: CREATE (:User {name: "", role: "admin"}).
    const query = `CREATE ${nodePattern('n', 'Entity', { name: '", role: "admin' })}`;
    // Every double quote in the emitted query is escaped, so `role` stays part
    // of the name value rather than becoming a key.
    expect(query).not.toMatch(/[^\\]", role/);
    expect(query).toBe(`CREATE (n:Entity {name: '\\", role: \\"admin'})`);
  });

  it('never emits $-placeholder syntax, which SparrowDB silently ignores', () => {
    // `MATCH (n:Person {name: $name})` returns EVERY Person rather than
    // erroring, so a stray `$name` reaching the engine is an unfiltered result
    // set, not a failure. A `$` inside a value must stay inside the literal.
    const query = `MATCH ${nodePattern('n', 'Entity', { name: '$name' })} RETURN n.name`;
    expect(query).toBe("MATCH (n:Entity {name: '$name'}) RETURN n.name");
    // The only `$` in the query sits between the structural quotes.
    const firstQuote = query.indexOf("'");
    const lastQuote = query.lastIndexOf("'");
    expect(query.indexOf('$')).toBeGreaterThan(firstQuote);
    expect(query.indexOf('$')).toBeLessThan(lastQuote);
  });
});

describe('escapeNumber', () => {
  it('renders integers exactly', () => {
    expect(escapeNumber(0)).toBe('0');
    expect(escapeNumber(-5)).toBe('-5');
    expect(escapeNumber(1_700_000_000_000)).toBe('1700000000000');
  });

  it('renders non-integers without exponent notation', () => {
    expect(escapeNumber(1.5)).not.toContain('e');
    expect(escapeNumber(0.0000001)).not.toContain('e');
  });

  it('rejects NaN and Infinity', () => {
    expect(() => escapeNumber(NaN)).toThrow(CypherValidationError);
    expect(() => escapeNumber(Infinity)).toThrow(CypherValidationError);
    expect(() => escapeNumber(-Infinity)).toThrow(CypherValidationError);
  });

  it('rejects magnitudes that would render in exponent notation', () => {
    expect(() => escapeNumber(1e30)).toThrow(CypherValidationError);
  });

  it('rejects non-numbers', () => {
    expect(() => escapeNumber('1')).toThrow(CypherValidationError);
  });
});

describe('validateIdentifier', () => {
  it('accepts plain ASCII words', () => {
    expect(validateIdentifier('Entity', 'node label')).toBe('Entity');
    expect(validateIdentifier('_private')).toBe('_private');
    expect(validateIdentifier('RELATES_TO')).toBe('RELATES_TO');
  });

  it('rejects anything that could break out of an identifier position', () => {
    const hostile = [
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
    ];
    for (const value of hostile) {
      expect(() => validateIdentifier(value, 'node label')).toThrow(CypherValidationError);
    }
  });

  it('rejects non-strings', () => {
    expect(() => validateIdentifier(7)).toThrow(CypherValidationError);
  });
});

describe('formatPropertyMap', () => {
  it('returns an empty string when nothing survives', () => {
    expect(formatPropertyMap({})).toBe('');
    expect(formatPropertyMap({ a: undefined, b: null })).toBe('');
  });

  it('renders a map with a leading space, ready to splice into a pattern', () => {
    expect(formatPropertyMap({ name: 'alice', ts: 5 })).toBe(" {name: 'alice', ts: 5}");
  });

  it('validates property keys as identifiers', () => {
    expect(() => formatPropertyMap({ "a'}) CREATE (n:X {b": 'x' })).toThrow(CypherValidationError);
  });

  it('drops null and undefined entries', () => {
    expect(formatPropertyMap({ name: 'alice', kind: null, ts: undefined })).toBe(" {name: 'alice'}");
  });
});

describe('nodePattern', () => {
  it('renders a labelled pattern with properties', () => {
    expect(nodePattern('t', 'Task', { jobId: 'j1' })).toBe("(t:Task {jobId: 'j1'})");
  });

  it('renders an unlabelled pattern', () => {
    expect(nodePattern('n', null)).toBe('(n)');
  });

  it('validates the variable name', () => {
    expect(() => nodePattern('n:Task) CREATE (m', 'Task')).toThrow(CypherValidationError);
  });

  it('validates the label', () => {
    expect(() => nodePattern('n', 'Task {x:1}) CREATE (m:Y')).toThrow(CypherValidationError);
  });
});

describe('escapeValue', () => {
  it('dispatches on runtime type', () => {
    expect(escapeValue('a')).toBe("'a'");
    expect(escapeValue(3)).toBe('3');
  });
});
