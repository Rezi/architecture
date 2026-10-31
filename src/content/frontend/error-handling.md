---
sources:
  - title: Errors
    url: https://svelte.dev/docs/kit/errors
    publisher: SvelteKit docs
  - title: Timeouts, retries and backoff with jitter
    url: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
    publisher: Amazon Builders' Library
  - title: Retry-After header
    url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
    publisher: MDN
  - title: Narrowing
    url: https://www.typescriptlang.org/docs/handbook/2/narrowing.html
    publisher: TypeScript docs
  - title: Circuit Breaker
    url: https://martinfowler.com/bliki/CircuitBreaker.html
    publisher: Martin Fowler
---

## The problem: things will fail

Networks drop, servers return 500, a third-party script throws, a user opens your app on a train. The question is not whether errors happen but **what the user sees when they do**. Without a plan the answer is a blank white page or a spinner that never ends. **Resilience** means the app keeps being as useful as possible while something is broken.

Three layers of defence, from the inside out: model errors in types, contain them so one failure does not take down the page, and recover automatically where it is safe.

## Make errors typed and explicit

In JavaScript you can throw anything, and `catch (e)` gives you `unknown`. Code that treats every failure as the same "Something went wrong" cannot do the right thing for each case: a 401 means "log in again", a 404 means "not found page", a network failure means "retry".

```ts bad title="Every failure looks the same"
try {
	user = await getUser(id);
} catch {
	alert('Something went wrong');
}
```

The user cannot act on that message, and you cannot tell from logs whether it was a typo in the code or the server being down.

```ts good title="Distinguish failures you can act on"
import { HttpError } from '$lib/shared/http';

export type LoadResult<T> =
	| { ok: true; data: T }
	| { ok: false; reason: 'unauthenticated' | 'not-found' | 'offline' | 'unknown' };

export async function safely<T>(run: () => Promise<T>): Promise<LoadResult<T>> {
	try {
		return { ok: true, data: await run() };
	} catch (e) {
		if (e instanceof HttpError && e.status === 401) return { ok: false, reason: 'unauthenticated' };
		if (e instanceof HttpError && e.status === 404) return { ok: false, reason: 'not-found' };
		if (e instanceof TypeError) return { ok: false, reason: 'offline' }; // fetch network failure
		return { ok: false, reason: 'unknown' };
	}
}
```

Returning a result instead of throwing makes the compiler force each caller to deal with failure. Separate two kinds of error: **expected** ones (validation, not found, offline), which you handle in the UI, and **unexpected** ones (a bug), which you log and show a generic fallback for.

## Contain failures: error boundaries

An **error boundary** is a wrapper that catches errors thrown while rendering its children and shows a fallback instead, so one broken widget does not blank the whole app. React has them as class components (or the `react-error-boundary` library), Vue has `onErrorCaptured`, and Svelte 5 has `svelte:boundary`.

```svelte bad title="One widget crash takes down the page"
<Header />
<RecommendationsWidget />
<!-- throws on odd data: whole page is gone -->
<Checkout />
```

```svelte good title="Contain the optional part"
<Header />
<svelte:boundary onerror={(e) => report(e)}>
	<RecommendationsWidget />
	{#snippet failed(error, reset)}
		<p>Recommendations are unavailable. <button onclick={reset}>Try again</button></p>
	{/snippet}
</svelte:boundary>
<Checkout />
```

Place boundaries around independent pieces (a widget, a route), not around everything. A boundary around the whole app is a last resort, not a strategy. Note that boundaries catch rendering errors, not failures inside event handlers or async code, which you handle with `safely` above. SvelteKit adds route-level `+error.svelte` pages and a `handleError` hook for the unexpected ones, on server and client.

## Retries: only when safe, and with restraint

Retrying fixes short glitches. Done badly it makes outages worse: a thousand clients all retrying instantly are a self-inflicted attack on the struggling server.

```ts bad title="Immediate, endless retry"
async function load() {
	while (true) {
		try {
			return await fetchData();
		} catch {
			/* try again */
		}
	}
}
```

```ts good title="Limited retries with exponential backoff and jitter"
export async function withRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await run();
		} catch (e) {
			const retryable = e instanceof TypeError || (e instanceof HttpError && e.status >= 500);
			if (!retryable || i >= attempts - 1) throw e;
			const delay = 2 ** i * 500 * (0.5 + Math.random()); // 0.5s, 1s, 2s, randomised
			await new Promise((r) => setTimeout(r, delay));
		}
	}
}
```

**Backoff** means waiting longer after each failure. **Jitter** means adding randomness so clients do not retry in lockstep. Retry only errors that may pass by themselves (network, 5xx, and 429 respecting the `Retry-After` header), never 4xx such as validation errors, which will fail the same way again.

The most important rule: **retry only idempotent requests**, meaning ones that give the same result when repeated. Retrying a GET is harmless. Retrying "charge the card" may charge twice unless the server supports an idempotency key. See [REST API design](/backend/api-design) and [reliability](/backend/reliability).

## Graceful degradation

When a non-essential part fails, keep the essential part working:

- If recommendations fail to load, hide them and show the product.
- If the network is gone, show data already on screen and mark it as possibly outdated, instead of replacing it with an error.
- If a save fails, keep the user's input and offer "Try again"; never discard their work.

Decide in advance which parts are essential. That is a product decision, not just a technical one.

## Tell someone: logging

A user-facing fallback is only half the job. Report unexpected errors to a tracking service (Sentry or similar) with context such as route and release version, otherwise nobody finds out. Do not log secrets or personal data, and show users a friendly message rather than stack traces, which help attackers.

## When NOT to do this

- Do not wrap every function in try/catch. Catch where you can do something useful: show a message, retry, or fall back.
- Do not swallow errors silently (`catch {}`) so the console looks clean. That hides bugs.
- Do not build automatic retries for user-triggered writes; let the user press the button again.

## Checklist

- Do expected failures (401, 404, offline) lead to different, helpful UI?
- Is each independent piece of the page behind its own boundary?
- Are retries limited, backed off, jittered, and only for idempotent requests?
- Does the app keep working, at least partly, when a non-essential call fails?
- Are unexpected errors reported with enough context to debug them?
