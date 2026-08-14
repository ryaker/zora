/**
 * Cypher literal escaping and identifier validation (MEM-30).
 *
 * SparrowDB's N-API surface accepts a single Cypher *string* — there is no
 * parameter binding (`$param` / `{param}`) in 0.1.x. Every value we send is
 * therefore textually interpolated, which makes this module the entire
 * security boundary for the graph tier.
 *
 * That matters because the values we interpolate are hostile by default:
 * entity names and task summaries are LLM-generated from tool output, which
 * may itself come from a web page, a file, or a shell command. A summary
 * reading `'}) CREATE (admin:Entity {name:'x'}) //` must not be able to break
 * out of its literal.
 *
 * The rules enforced here:
 *   - Strings are emitted as single-quoted literals with `\`, `'` and `"`
 *     backslash-escaped and CR/LF/TAB emitted as escape sequences. Every other
 *     C0/C1 control character (including NUL, which the tokenizer treats as a
 *     terminator) is replaced with a space.
 *   - Strings are length-capped. An unbounded summary would otherwise let a
 *     caller build a multi-megabyte query string.
 *   - Numbers must be finite and within a range that never renders in
 *     exponent notation (which the tokenizer does not accept).
 *   - Labels, relationship types and property keys are *not* escapable in
 *     Cypher, so they are validated against a strict allowlist pattern and
 *     must come from the code's own ontology, never from user input.
 */

/** Thrown when a value or identifier cannot be safely rendered into Cypher. */
export class CypherValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CypherValidationError';
  }
}

/** Values that may be stored as node or edge properties. */
export type PropertyValue = string | number;

/** Maximum length of an interpolated string literal, in UTF-16 code units. */
export const MAX_STRING_LENGTH = 4000;

/**
 * Largest magnitude we will render as a numeric literal. Beyond ~1e21 the
 * JavaScript number formatter switches to exponent notation, which SparrowDB's
 * tokenizer does not accept.
 */
const MAX_NUMBER_MAGNITUDE = 1e15;

/**
 * Identifiers (labels, relationship types, property keys) must be plain ASCII
 * words. Cypher has no escape syntax for these, so anything outside this set
 * is rejected rather than sanitized.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Validate a Cypher identifier (label / relationship type / property key).
 *
 * Identifiers are never escapable, so this is an allowlist: reject anything
 * that is not a plain ASCII word. Callers must only pass identifiers that
 * originate in the ontology, never values derived from user or model input.
 *
 * @param value The identifier to validate.
 * @param kind Human-readable role, used in the error message.
 * @returns The identifier unchanged, if valid.
 */
export function validateIdentifier(value: unknown, kind = 'identifier'): string {
  if (typeof value !== 'string') {
    throw new CypherValidationError(`Invalid ${kind}: expected a string, got ${typeof value}`);
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new CypherValidationError(
      `Invalid ${kind} ${JSON.stringify(value)}: must match [A-Za-z_][A-Za-z0-9_]{0,63}`,
    );
  }
  return value;
}

/**
 * Render a string as a safe single-quoted Cypher literal.
 *
 * The return value *includes* the surrounding quotes. Over-long input is
 * truncated rather than rejected, because the common source is an LLM summary
 * and dropping the whole write would lose more information than trimming it.
 *
 * @param value The raw string.
 * @param maxLength Truncation threshold (defaults to {@link MAX_STRING_LENGTH}).
 */
export function escapeString(value: unknown, maxLength: number = MAX_STRING_LENGTH): string {
  if (typeof value !== 'string') {
    throw new CypherValidationError(`Cannot escape non-string value of type ${typeof value}`);
  }

  const truncated = value.length > maxLength ? value.slice(0, maxLength) : value;

  let out = "'";
  for (let i = 0; i < truncated.length; i++) {
    const ch = truncated[i] as string;
    switch (ch) {
      case '\\':
        out += '\\\\';
        break;
      case "'":
        out += "\\'";
        break;
      case '"':
        out += '\\"';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default: {
        const code = ch.charCodeAt(0);
        // Strip C0 controls (incl. NUL, which terminates the tokenizer's view
        // of the string), DEL, and C1 controls. Replacing rather than dropping
        // keeps word boundaries intact for later lexical search.
        if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
          out += ' ';
        } else {
          out += ch;
        }
      }
    }
  }
  return out + "'";
}

/**
 * Render a number as a safe Cypher numeric literal.
 *
 * Rejects NaN, Infinity and magnitudes large enough to render in exponent
 * notation, which the SparrowDB tokenizer does not accept.
 */
export function escapeNumber(value: unknown): string {
  if (typeof value !== 'number') {
    throw new CypherValidationError(`Cannot escape non-number value of type ${typeof value}`);
  }
  if (!Number.isFinite(value)) {
    throw new CypherValidationError(`Cannot escape non-finite number ${String(value)}`);
  }
  if (Math.abs(value) > MAX_NUMBER_MAGNITUDE) {
    throw new CypherValidationError(`Numeric value out of supported range: ${value}`);
  }
  // Integers render exactly; non-integers get a fixed decimal form so we never
  // emit exponent notation for very small magnitudes either.
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '0');
}

/** Render any supported property value as a Cypher literal. */
export function escapeValue(value: PropertyValue, maxLength: number = MAX_STRING_LENGTH): string {
  if (typeof value === 'number') return escapeNumber(value);
  return escapeString(value, maxLength);
}

/**
 * Render a property map as a Cypher inline map, including the braces.
 *
 * `undefined` and `null` entries are dropped — SparrowDB stores absent
 * properties as null on read anyway, so writing them adds nothing.
 *
 * Returns an empty string when no properties survive, so callers can splice it
 * directly into a pattern: `` `(:${label}${formatPropertyMap(props)})` ``.
 */
export function formatPropertyMap(
  props: Record<string, PropertyValue | null | undefined>,
  maxLength: number = MAX_STRING_LENGTH,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    parts.push(`${validateIdentifier(key, 'property key')}: ${escapeValue(value, maxLength)}`);
  }
  return parts.length === 0 ? '' : ` {${parts.join(', ')}}`;
}

/**
 * Render a node pattern, e.g. `(t:Task {jobId: 'j1'})`.
 *
 * @param variable Pattern variable name (validated as an identifier).
 * @param label Node label, or null for an unlabelled pattern.
 * @param props Inline property filter / initializer.
 */
export function nodePattern(
  variable: string,
  label: string | null,
  props: Record<string, PropertyValue | null | undefined> = {},
): string {
  const v = validateIdentifier(variable, 'pattern variable');
  const l = label === null ? '' : `:${validateIdentifier(label, 'node label')}`;
  return `(${v}${l}${formatPropertyMap(props)})`;
}
