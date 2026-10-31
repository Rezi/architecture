---
sources:
  - title: Using the Fetch API
    url: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
    publisher: MDN
  - title: AbortController
    url: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
    publisher: MDN
  - title: Practical React Query
    url: https://tkdodo.eu/blog/practical-react-query
    publisher: TkDodo's blog
  - title: Effective React Query Keys
    url: https://tkdodo.eu/blog/effective-react-query-keys
    publisher: TkDodo's blog
  - title: Loading data
    url: https://svelte.dev/docs/kit/load
    publisher: SvelteKit docs
---

## The problem: fetch calls scattered everywhere

The first version of data loading is usually a `fetch('/api/...')` inside a component. It works, and then the API adds an auth header, the base URL changes per environment, errors need a consistent shape, and you must edit 40 files. The browser's `fetch` is also surprisingly easy to misuse, so there are four things to get right: a single **API layer**, **typed results**, **loading and error states**, and **stale or out-of-order responses**.

## One API layer

Put every HTTP detail in one module. Components call functions with meaningful names and never see URLs.

```ts bad title="Raw fetch in a component"
const res = await fetch('https://api.example.com/users/' + id);
const user = await res.json(); // any
console.log(user.name);
```

Problems: `fetch` only rejects on network failure, so a 404 or 500 still gives you a response with an error body and you happily parse it. The result is `any`, so a renamed field is a runtime surprise. The URL is hard-coded, and no timeout exists.

```ts good title="lib/http.ts"
export class HttpError extends Error {
	constructor(
		public status: number,
		public body: unknown
	) {
		super(`HTTP ${status}`);
	}
}

export async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(import.meta.env.VITE_API_URL + path, {
		...init,
		headers: { accept: 'application/json', ...init.headers },
		signal: init.signal ?? AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new HttpError(res.status, await res.json().catch(() => null));
	return (await res.json()) as T;
}
```

```ts good title="features/users/usersApi.ts"
import { http } from '$lib/shared/http';

export type User = { id: string; name: string; email: string };

export const getUser = (id: string, signal?: AbortSignal) =>
	http<User>(`/users/${encodeURIComponent(id)}`, { signal });
```

Now status checking, base URL, timeout and (later) auth live in one place. The `as T` is a promise, not a proof: the server might send something else. For data you do not control, validate it at the edge with a schema (see [forms and validation](/frontend/forms-and-validation)).

## The three states of every request

Every request is in one of: loading, failed, or succeeded (and "succeeded with nothing" is its own case). A UI that only handles success shows a blank screen on slow networks and a frozen one on errors.

```ts good title="Model the states explicitly"
export type Remote<T> =
	{ status: 'loading' } | { status: 'error'; error: Error } | { status: 'ready'; data: T };
```

With a union like this, TypeScript forces you to handle each case before you touch `data`. Compare with three loose booleans (`loading`, `error`, `data`) where `loading: true` and `error: set` can both be true at once.

## Out-of-order responses (race conditions)

A **race condition** is when the result depends on which of two things finishes first. Classic case: a search box. The user types "ca", then "car". Two requests are in flight. If "ca" returns _after_ "car", the screen shows results for the wrong query.

```ts bad title="Last response wins, not last request"
async function onInput(q: string) {
	results = await searchProducts(q); // slow earlier answers overwrite newer ones
}
```

```ts good title="Cancel the previous request"
let controller: AbortController | undefined;

async function onInput(q: string) {
	controller?.abort(); // the old request is cancelled
	controller = new AbortController();
	try {
		results = await searchProducts(q, controller.signal);
	} catch (e) {
		if (e instanceof DOMException && e.name === 'AbortError') return; // expected
		throw e;
	}
}
```

`AbortController` is the standard browser way to cancel a request. Add a short delay (debounce) before sending, so you do not fire a request per keystroke.

## Caching: do not ask twice

Fetching the same user on every page visit wastes time and bandwidth. A data layer keeps a cache keyed by the request, so a second ask is instant and a background refresh brings the newest version (the "stale while revalidate" pattern from the [what is architecture](/common/what-is-architecture) example). Libraries such as TanStack Query (React, Vue, Svelte, Solid) and SWR do this, plus de-duplication of simultaneous identical requests, retries and refetch on focus.

```ts title="Cache key = everything the result depends on"
// If the result changes when a value changes, that value belongs in the key.
const key = ['products', { category, page, sort }];
```

In SvelteKit, `load` functions fetch before the page renders, and you control caching with HTTP headers and `invalidate`. Choose between them by [rendering strategy](/frontend/rendering-strategies).

## When NOT to add a caching library

- A page that loads one thing once needs only the API layer.
- If the server already sets proper cache headers, the browser does part of the job for free.
- A library is worth it once you hand-write your second "loading flag plus refetch plus dedupe" helper.

> Key takeaway: one typed API module, explicit loading/error/ready states, and cancellation for anything the user can trigger repeatedly.

## Checklist

- Is every URL, header and timeout in a single module?
- Does a 404 or 500 become an error instead of parsed data?
- Does each screen show loading, error and empty states?
- Are requests cancelled or ignored when the input changes?
- Does the cache key include every value the result depends on?
