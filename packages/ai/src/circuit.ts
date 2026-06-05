// ---------------------------------------------------------------------------
// Circuit breaker for the Bedrock client.
//
// Lives in @tims/ai (not @tims/api) because the dependency direction is
// shared → db → api → web: packages/ai cannot import from packages/api, so the
// `bedrockCircuit` that guards Bedrock calls is owned here. (packages/api keeps
// its own sesCircuit for SES.) Mirrors the api breaker's behavior: 5 failures
// open the circuit for 30s; while open, calls short-circuit to the fallback (or
// throw if none), so a Bedrock outage degrades gracefully instead of hanging
// every request behind a slow timeout. CLAUDE.md §8.
// ---------------------------------------------------------------------------

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  name: string;
  threshold: number;
  resetTimeoutMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailure = 0;
  private readonly name: string;
  private readonly threshold: number;
  private readonly resetTimeout: number;

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.threshold = opts.threshold;
    this.resetTimeout = opts.resetTimeoutMs;
  }

  async execute<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        if (fallback) return fallback();
        throw new Error(`${this.name} is temporarily unavailable (circuit open)`);
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= this.threshold) {
        this.state = 'open';
      }
      throw error;
    }
  }

  getState(): { state: CircuitState; failures: number } {
    return { state: this.state, failures: this.failures };
  }
}

export const bedrockCircuit = new CircuitBreaker({
  name: 'AWS Bedrock',
  threshold: 5,
  resetTimeoutMs: 30_000,
});
