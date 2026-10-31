---
sources:
  - title: Timeouts, retries and backoff with jitter
    url: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
    publisher: Amazon Builders' Library
  - title: Addressing Cascading Failures
    url: https://sre.google/sre-book/addressing-cascading-failures/
    publisher: Google SRE Book
  - title: CircuitBreaker
    url: https://martinfowler.com/bliki/CircuitBreaker.html
    publisher: Martin Fowler
  - title: Retry pattern
    url: https://learn.microsoft.com/en-us/azure/architecture/patterns/retry
    publisher: Microsoft Learn, Azure Architecture Center
  - title: AbortSignal.timeout()
    url: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static
    publisher: MDN Web Docs
---

## The problem: other people's servers fail

Your backend rarely works alone. It calls a payment provider, a mail API, another internal service, a database. Each can be slow, return errors, or simply stop answering. If one of them has a bad minute, the question is whether you have a bad minute too, or a bad hour.

Slowness is more dangerous than outright failure. A failed call returns instantly; a slow call holds a connection, memory and a pending request while waiting, and many of those pile up until your own server runs out of capacity and stops answering everyone. This is a **cascading failure**: one sick dependency makes its callers sick, and so on up the chain. The three tools below (timeouts, retries, circuit breakers) exist to stop that.

## Timeouts: never wait forever

A **timeout** is the longest you are willing to wait. Node's `fetch` has no timeout by default, so a hung server holds your request open until the OS gives up, which can take minutes.

```ts bad title="No timeout: one stuck dependency freezes every request that touches it"
async function getShippingQuote(orderId: string) {
	const res = await fetch(`https://shipping.example.com/quote?order=${orderId}`);
	return res.json();
}
```

```ts good title="A deadline on every outgoing call"
async function getShippingQuote(orderId: string) {
	const res = await fetch(`https://shipping.example.com/quote?order=${orderId}`, {
		signal: AbortSignal.timeout(2_000) // abort after 2 seconds
	});
	if (!res.ok) throw new UpstreamError(`shipping responded ${res.status}`);
	return res.json();
}
```

Choose the number from data, not hope: look at the dependency's normal latency (for instance its 99th percentile, the time 99 out of 100 requests beat) and set the timeout a little above it. Also set timeouts on database queries and on your own incoming requests. A timeout in front of the user should be longer than the sum of the timeouts behind it; otherwise the user gives up while you are still working.

## Retries: useful, and dangerous

Many failures are brief (a dropped connection, a restarting instance), so trying again often works. But naive retries make outages worse.

```ts bad title="Immediate retries: a retry storm"
async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
	for (let i = 0; i < 5; i++) {
		try {
			return await fn();
		} catch {
			/* try again right away */
		}
	}
	throw new Error('failed');
}
```

If the dependency is overloaded and 1,000 requests each retry 5 times at once, it now receives up to 5,000 requests: you have turned a wobble into a collapse. Also, retrying a request that can never succeed (a 400 Bad Request) is wasted effort.

```ts good title="Retry only what can succeed, with exponential backoff and jitter"
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			if (attempt >= maxAttempts || !isRetryable(err)) throw err;
			const backoff = Math.min(100 * 2 ** attempt, 2_000); // 200, 400, 800 ms ... capped
			const jitter = Math.random() * backoff; // spread retries out in time
			await new Promise((r) => setTimeout(r, jitter));
		}
	}
}

function isRetryable(err: unknown): boolean {
	return (
		(err instanceof UpstreamError && (err.status >= 500 || err.status === 429)) ||
		(err as Error).name === 'TimeoutError'
	);
}
```

**Backoff** means waiting longer after each failure. **Jitter** is randomness added to the wait so that a thousand clients that failed together do not all retry at the same instant. Both come from the AWS guidance linked above.

Rules for retries:

- **Only retry idempotent operations**, or ones carrying an idempotency key (see [API design](/backend/api-design)). Retrying "charge the card" without a key can charge twice. Reads are safe.
- **Retry at one layer only.** If three layers each retry 3 times, one failure becomes 27 attempts.
- **Cap the total**: a few attempts, and a limit on total time. Some systems also keep a "retry budget" such as at most 10% extra traffic from retries.

## Circuit breakers: stop calling something that is down

If the shipping service has been failing for the last 30 seconds, sending it more requests helps nobody. A **circuit breaker** (named after the electrical device) watches calls and, after enough failures, "opens": for a while it fails immediately without calling the dependency at all, then lets a trial request through to test recovery. The failure is fast, the dependency gets breathing room, and your threads are not tied up waiting.

```ts good title="A small circuit breaker: closed, open, then a trial call"
class CircuitBreaker {
	private failures = 0;
	private openedAt = 0;
	constructor(
		private maxFailures = 5,
		private resetMs = 10_000
	) {}

	async call<T>(fn: () => Promise<T>): Promise<T> {
		const open = this.failures >= this.maxFailures;
		if (open && Date.now() - this.openedAt < this.resetMs) {
			throw new Error('Circuit open: failing fast'); // do not even try
		}
		try {
			const result = await fn(); // closed, or the trial call after resetMs
			this.failures = 0; // success closes the circuit
			return result;
		} catch (err) {
			this.failures++;
			if (this.failures >= this.maxFailures) this.openedAt = Date.now();
			throw err;
		}
	}
}

const shippingBreaker = new CircuitBreaker();
const quote = await shippingBreaker.call(() => withRetry(() => getShippingQuote(orderId)));
```

This sketch is for understanding. In production use a maintained library (for example `opossum` for Node) which handles concurrency, rolling error rates and metrics properly.

## Plan the fallback: degrade, do not die

When a dependency is unavailable, decide in advance what the user sees. This is **graceful degradation**: lose a feature, not the whole page.

| Dependency down         | Possible degradation                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| Recommendations service | Show a static "popular items" list                                            |
| Shipping quote          | Show "calculated at checkout", still allow adding to cart                     |
| Email provider          | Queue the email and retry later ([background jobs](/backend/background-jobs)) |
| Payment provider        | Honest error with a retry button; do not fake success                         |

Be careful: a fallback that is rarely exercised is a fallback that is probably broken. Test it by actually switching the dependency off in staging. Make sure the frontend handles partial data (see [frontend error handling](/frontend/error-handling)).

## Know when it is broken

Reliability you cannot see is luck. Expose a **health endpoint** (for example `/healthz` returning 200 when the process can serve traffic) so the platform can restart or stop routing to a sick instance, and track error rate and latency per dependency ([observability](/common/observability)). Keep the health check cheap; if it calls every dependency, a slow dependency will make the platform kill healthy servers.

## Trade-offs and when NOT to do this

- Every layer of protection adds code, configuration and new failure modes (a breaker that opens too eagerly causes an outage by itself). Add them for dependencies that are remote and non-critical to start with, not for local function calls.
- Timeouts that are too short turn slow successes into failures. Tune with real latency numbers.
- Retries multiply load; backoff and caps are not optional.
- A single-instance internal tool with one dependency may need nothing beyond a timeout.

## Checklist

- Does every outgoing HTTP call and database query have a timeout?
- Are retries limited, backed off with jitter, applied only to retryable errors and only to idempotent operations?
- Is retrying done in one layer, not stacked?
- Is there a circuit breaker (or equivalent) around important remote dependencies?
- For each dependency, do you know what the user sees when it is down, and have you tested it?
