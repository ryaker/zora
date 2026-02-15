/**
 * CircuitBreaker — protects providers from repeated failures.
 *
 * States:
 *   CLOSED   — normal operation, requests pass through.
 *   OPEN     — too many failures, requests are rejected immediately.
 *   HALF_OPEN — cooldown expired, one test request is allowed through.
 *
 * Transitions:
 *   CLOSED → OPEN:      After `failureThreshold` failures within `failureWindow` ms.
 *   OPEN → HALF_OPEN:   After `cooldownMs` has elapsed since opening.
 *   HALF_OPEN → CLOSED: On the first success.
 *   HALF_OPEN → OPEN:   On the first failure (resets cooldown timer).
 *
 * PROV-02: No external dependencies. Standalone class.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of failures within the window to trip the circuit. Default: 3 */
  failureThreshold?: number;
  /** Time window (ms) in which failures are counted. Default: 60_000 (60s) */
  failureWindowMs?: number;
  /** Time (ms) to wait in OPEN state before transitioning to HALF_OPEN. Default: 30_000 (30s) */
  cooldownMs?: number;
}

export class CircuitBreaker {
  private _state: CircuitState = 'CLOSED';
  private readonly _failureThreshold: number;
  private readonly _failureWindowMs: number;
  private readonly _cooldownMs: number;

  /** Timestamps of recent failures (within the window) */
  private _failureTimestamps: number[] = [];

  /** When the circuit was last opened (used for cooldown calculation) */
  private _openedAt: number = 0;

  /** Total counters for observability */
  private _totalSuccesses = 0;
  private _totalFailures = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this._failureThreshold = options.failureThreshold ?? 3;
    this._failureWindowMs = options.failureWindowMs ?? 60_000;
    this._cooldownMs = options.cooldownMs ?? 30_000;
  }

  /**
   * Returns the current effective state.
   * Automatically transitions OPEN → HALF_OPEN if cooldown has elapsed.
   */
  getState(): CircuitState {
    if (this._state === 'OPEN' && this._cooldownElapsed()) {
      this._state = 'HALF_OPEN';
    }
    return this._state;
  }

  /**
   * Returns true if the circuit is OPEN (requests should be rejected).
   * Returns false for CLOSED and HALF_OPEN (requests may proceed).
   */
  isOpen(): boolean {
    return this.getState() === 'OPEN';
  }

  /**
   * Record a successful request.
   * In HALF_OPEN state, transitions back to CLOSED.
   */
  recordSuccess(): void {
    this._totalSuccesses++;
    const state = this.getState();
    if (state === 'HALF_OPEN') {
      this._state = 'CLOSED';
      this._failureTimestamps = [];
    }
  }

  /**
   * Record a failed request.
   * In CLOSED state, may transition to OPEN if threshold is reached.
   * In HALF_OPEN state, transitions back to OPEN immediately.
   */
  recordFailure(): void {
    this._totalFailures++;
    const state = this.getState();

    if (state === 'HALF_OPEN') {
      this._trip();
      return;
    }

    if (state === 'CLOSED') {
      const now = Date.now();
      this._failureTimestamps.push(now);

      // Prune failures outside the window
      const windowStart = now - this._failureWindowMs;
      this._failureTimestamps = this._failureTimestamps.filter((t) => t >= windowStart);

      if (this._failureTimestamps.length >= this._failureThreshold) {
        this._trip();
      }
    }
    // If already OPEN, nothing changes (cooldown timer keeps running)
  }

  /**
   * Manually reset the circuit breaker to CLOSED state.
   */
  reset(): void {
    this._state = 'CLOSED';
    this._failureTimestamps = [];
    this._openedAt = 0;
  }

  /**
   * Returns a health score derived from circuit state:
   *   CLOSED    = 1.0
   *   HALF_OPEN = 0.5
   *   OPEN      = 0.0
   */
  get healthScore(): number {
    const state = this.getState();
    switch (state) {
      case 'CLOSED':
        return 1.0;
      case 'HALF_OPEN':
        return 0.5;
      case 'OPEN':
        return 0.0;
    }
  }

  /** Total successful requests recorded */
  get totalSuccesses(): number {
    return this._totalSuccesses;
  }

  /** Total failed requests recorded */
  get totalFailures(): number {
    return this._totalFailures;
  }

  // ─── Internal ────────────────────────────────────────────────────

  private _trip(): void {
    this._state = 'OPEN';
    this._openedAt = Date.now();
  }

  private _cooldownElapsed(): boolean {
    return Date.now() - this._openedAt >= this._cooldownMs;
  }
}
