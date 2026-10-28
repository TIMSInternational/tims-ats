import { TRPCError } from '@trpc/server';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  name: string;
  threshold: number;       // failures before opening
  resetTimeoutMs: number;  // how long to stay open
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
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: `${this.name} is temporarily unavailable`,
        });
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

// Pre-configured circuit breakers for external services
export const bedrockCircuit = new CircuitBreaker({
  name: 'AWS Bedrock',
  threshold: 5,
  resetTimeoutMs: 30_000, // 30 seconds
});

export const sesCircuit = new CircuitBreaker({
  name: 'AWS SES',
  threshold: 3,
  resetTimeoutMs: 60_000, // 60 seconds
});

// Offer emails get their OWN failure budget (#322 review, L3). generateSigningLink awaits the send under a
// 4s abort; before that bound an offer send could hang but never FAIL, so it never counted against
// sesCircuit. Now a slow SES region turns offer sends into timeouts, and on the shared breaker three of
// them would suppress invitations and reminders for a minute. Isolated here, a run of slow offer sends
// only pauses offer sends (which the recruiter sees as "delivery unconfirmed" and can retry).
export const sesOfferCircuit = new CircuitBreaker({
  name: 'AWS SES (offers)',
  threshold: 3,
  resetTimeoutMs: 60_000,
});

// Raw (MIME, .ics) sends get their OWN failure budget: a raw-only problem must never open the shared SES
// breaker and suppress every other email (offers, application-received, …) plus the plain fallback.
export const sesRawCircuit = new CircuitBreaker({
  name: 'AWS SES (raw)',
  threshold: 3,
  resetTimeoutMs: 60_000,
});
