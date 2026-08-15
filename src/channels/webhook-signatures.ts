/**
 * Per-platform webhook signature validation — INVARIANT-10.
 *
 * "Webhook server validates platform signatures before processing" is a
 * property of the *server*, not of any adapter: nothing reaches an adapter, a
 * JSON parser, or the ChannelManager pipeline until a validator for that
 * platform says the request is authentic.
 *
 * Registration is the authorisation. A platform with no registered validator is
 * refused outright rather than defaulted to "no signature required" — the
 * failure mode of a signature layer is that some path skips it, so the only
 * safe default for an unknown platform is refusal.
 *
 * On HMAC: this file deliberately implements what each platform actually sends
 * rather than a uniform HMAC scheme. Telegram — the only platform in this
 * codebase with an inbound webhook path — does not sign its payloads. Its
 * documented mechanism is a shared secret echoed in a header:
 *
 *   "A secret token to be sent in a header 'X-Telegram-Bot-Api-Secret-Token' in
 *    every webhook request, 1-256 characters. Only characters A-Z, a-z, 0-9, _
 *    and - are allowed. The header is useful to ensure that the request comes
 *    from a webhook set by you."
 *      — https://core.telegram.org/bots/api#setwebhook
 *
 * Verifying an HMAC over Telegram's body would reject every genuine Telegram
 * request, because Telegram never computes one. A body-signature platform
 * (Slack- or Stripe-style) would add its own validator here and use `rawBody`,
 * which is why the context carries the unparsed bytes.
 */

import crypto from 'node:crypto';

/**
 * What a validator gets to inspect.
 *
 * `rawBody` is the bytes exactly as received. A body-signature validator must
 * use these and never a re-serialised object: `JSON.parse` followed by
 * `JSON.stringify` reorders keys and drops whitespace, so the digest would be
 * computed over something the sender never signed.
 */
export interface WebhookRequestContext {
  /** Header names lowercased, as Node delivers them. */
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
}

export type SignatureVerdict = { valid: true } | { valid: false; reason: string };

export interface WebhookSignatureValidator {
  /** Platform name, matching the `:platform` route segment and the adapter name. */
  readonly platform: string;
  validate(ctx: WebhookRequestContext): SignatureVerdict;
}

/** The header Telegram echoes the configured secret token in. */
export const TELEGRAM_SECRET_TOKEN_HEADER = 'x-telegram-bot-api-secret-token';

/** Telegram's documented constraint on secret_token: 1-256 chars from this set. */
const TELEGRAM_SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Compares two strings without leaking their contents through timing.
 *
 * `a !== b` — which is what `@chat-adapter/telegram` does internally — returns
 * as soon as two bytes differ, so response time correlates with how long a
 * guessed prefix was. That is a practical oracle against a token an attacker
 * can retry against.
 *
 * The digests exist to make the comparison length-independent:
 * `crypto.timingSafeEqual` throws on inputs of different lengths, so comparing
 * the raw strings would turn "wrong length" into an exception and leak the
 * secret's length. Hashing first makes both sides 32 bytes whatever was sent.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/**
 * Validator for Telegram's `X-Telegram-Bot-Api-Secret-Token` header.
 *
 * The secret is validated against Telegram's documented charset at construction
 * rather than at request time. A secret Telegram would refuse to accept in
 * `setWebhook` can never appear in a genuine request, so every webhook would be
 * rejected — a misconfiguration that presents as "Telegram silently stopped
 * working". Failing at boot names the real problem.
 */
export function createTelegramValidator(secretToken: string): WebhookSignatureValidator {
  if (!TELEGRAM_SECRET_TOKEN_PATTERN.test(secretToken)) {
    throw new Error(
      'Telegram webhook secret token must be 1-256 characters of A-Z, a-z, 0-9, _ or - ' +
        '(https://core.telegram.org/bots/api#setwebhook). Telegram will not accept this ' +
        'value in setWebhook, so no genuine webhook could ever match it.',
    );
  }

  return {
    platform: 'telegram',
    validate(ctx: WebhookRequestContext): SignatureVerdict {
      const presented = ctx.headers[TELEGRAM_SECRET_TOKEN_HEADER];
      if (presented === undefined) {
        return { valid: false, reason: `missing ${TELEGRAM_SECRET_TOKEN_HEADER} header` };
      }
      if (!timingSafeEqualString(presented, secretToken)) {
        return { valid: false, reason: 'secret token mismatch' };
      }
      return { valid: true };
    },
  };
}

/**
 * The set of platforms whose webhooks this server will accept.
 *
 * A plain Map would answer `undefined` for an unregistered platform, which
 * reads the same as "no validation needed" at the call site. This type exists
 * so the caller has to handle the absent case explicitly.
 */
export class WebhookValidatorRegistry {
  private readonly _validators = new Map<string, WebhookSignatureValidator>();

  register(validator: WebhookSignatureValidator): void {
    if (this._validators.has(validator.platform)) {
      throw new Error(`Webhook validator for platform '${validator.platform}' already registered`);
    }
    this._validators.set(validator.platform, validator);
  }

  /**
   * Validates a request for `platform`.
   *
   * An unregistered platform is `unconfigured`, never `valid`. That is the
   * fail-closed default INVARIANT-10 rests on: adding an adapter does not
   * silently open an unauthenticated webhook route for it.
   */
  validate(
    platform: string,
    ctx: WebhookRequestContext,
  ): SignatureVerdict | { valid: false; unconfigured: true; reason: string } {
    const validator = this._validators.get(platform);
    if (!validator) {
      return {
        valid: false,
        unconfigured: true,
        reason: `no signature validator registered for platform '${platform}'`,
      };
    }
    return validator.validate(ctx);
  }

  /** Platforms with a registered validator, for logging at boot. */
  platforms(): string[] {
    return [...this._validators.keys()];
  }
}
