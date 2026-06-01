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
