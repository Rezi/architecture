---
sources:
  - title: 'RFC 9111: HTTP Caching'
    url: https://www.rfc-editor.org/rfc/rfc9111.html
    publisher: IETF
  - title: HTTP caching
    url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
    publisher: MDN Web Docs
  - title: Cache-Aside pattern
    url: https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside
    publisher: Microsoft Learn, Azure Architecture Center
  - title: Caching challenges and strategies
    url: https://aws.amazon.com/builders-library/caching-challenges-and-strategies/
    publisher: Amazon Builders' Library
  - title: Redis documentation
    url: https://redis.io/docs/latest/
    publisher: Redis
---

## The problem and the price

A **cache** is a stored copy of an answer, kept somewhere faster or closer than the original source, so the next request does not repeat the work. Computing a popular product list from the database on every request is wasteful when it changes once an hour. Caching makes things faster and cheaper and protects the database from load.

The price is **staleness**: the copy can be out of date. There is an old joke that the two hard things in computing are naming and cache invalidation (deciding when a copy is no longer valid). Every caching decision is a decision about how stale is acceptable for this particular data; see the performance versus freshness trade-off on [what is architecture](/common/what-is-architecture).

Caching happens in layers. Start with the cheapest, outermost one.

## Layer 1: HTTP caching (the browser and CDN do the work)

You already know this layer from the frontend. The server sends headers and browsers, proxies and CDNs (content delivery networks that cache copies near users) obey them. It costs almost no code.

```http title="Public, rarely changing data: cache for 5 minutes, then revalidate"
HTTP/1.1 200 OK
Cache-Control: public, max-age=300
ETag: "v42"
```

`max-age` is the number of seconds the copy counts as fresh. After that the client can **revalidate**: it asks "I have version `v42`, is it still current?" by sending `If-None-Match: "v42"`, and the server answers `304 Not Modified` with no body if so. That saves bandwidth and work but still costs a round trip.

```ts good title="Conditional GET with an ETag"
app.get('/products/:id', async (req, res) => {
	const product = await products.find(req.params.id);
	if (!product) return res.status(404).end();
	const etag = `"${product.version}"`;
	res.set({ ETag: etag, 'Cache-Control': 'public, max-age=60' });
	if (req.header('If-None-Match') === etag) return res.status(304).end();
	res.json(product);
});
```

The dangerous mistake is caching personal data in a shared cache.

```ts bad title="A personalised response marked public"
app.get('/me', async (req, res) => {
	res.set('Cache-Control', 'public, max-age=3600'); // a CDN may now serve YOUR profile to other users
	res.json(await users.find(req.user.id));
});
```

```ts good title="Private data: private (browser only) or no-store"
app.get('/me', async (req, res) => {
	res.set('Cache-Control', 'private, no-store');
	res.json(await users.find(req.user.id));
});
```

Use `public` only for responses identical for everyone. If a response differs by header (for example language), add `Vary: Accept-Language` so the cache keeps separate copies. See [data fetching](/frontend/data-fetching) for how the frontend benefits.

## Layer 2: an application cache (Redis, in-process memory)

When you cannot use HTTP caching (the data is per-user, or the expensive part is a query used by many endpoints), cache inside the backend. The standard recipe is **cache-aside**: look in the cache first; on a miss, load from the database and store it.

```ts good title="Cache-aside with a time to live (TTL)"
async function getProduct(id: string): Promise<Product | null> {
	const key = `product:${id}`;
	const hit = await redis.get(key);
	if (hit) return JSON.parse(hit);

	const product = await productsRepository.find(id);
	if (product) await redis.set(key, JSON.stringify(product), { EX: 300 }); // expires in 300 s
	return product;
}

async function updateProduct(id: string, patch: ProductPatch) {
	await productsRepository.update(id, patch);
	await redis.del(`product:${id}`); // invalidate: the next read reloads fresh data
}
```

Two rules keep this safe. Every entry gets a **TTL** (time to live), so a missed invalidation heals itself instead of staying wrong forever. And the **key must include everything that changes the answer**.

```ts bad title="The key forgets who is asking and which options were used"
const key = 'dashboard'; // user A's numbers are served to user B
const key2 = `products:${category}`; // ignores ?sort= and ?page=, so page 2 returns page 1
```

```ts good title="Key contains every input to the result"
const key = `dashboard:user:${userId}:range:${range}`;
const key2 = `products:cat:${category}:sort:${sort}:page:${page}`;
```

### Invalidation strategies

| Strategy        | How                                                    | Freshness           | Complexity                             |
| --------------- | ------------------------------------------------------ | ------------------- | -------------------------------------- |
| TTL only        | Let entries expire                                     | Stale up to the TTL | Lowest                                 |
| Delete on write | `del` the key when data changes (as above)             | Good                | Medium: every write path must remember |
| Write-through   | Update the cache in the same code path as the database | Good                | Higher, risk of mismatch               |

Start with TTL plus delete-on-write for the few things that must be fresh. Note a subtle race: between your database update and the `del`, a concurrent reader can re-cache the old value. The TTL bounds how long that survives.

## The stampede problem

A **cache stampede** (or thundering herd) happens when a popular entry expires and many requests miss at the same instant. All of them go to the database to recompute the same value, and the sudden spike can take the database down, which then makes everything slower, which causes more misses.

```ts bad title="1,000 simultaneous misses mean 1,000 identical expensive queries"
const cached = await redis.get('homepage');
if (!cached) {
	const data = await expensiveHomepageQuery(); // all concurrent requests run this
	await redis.set('homepage', JSON.stringify(data), { EX: 60 });
}
```

```ts good title="Single-flight: concurrent misses share one in-flight load"
const inFlight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
	const hit = await redis.get(key);
	if (hit) return JSON.parse(hit);
	let p = inFlight.get(key) as Promise<T> | undefined;
	if (!p) {
		p = load()
			.then(async (v) => {
				await redis.set(key, JSON.stringify(v), { EX: ttlSec });
				return v;
			})
			.finally(() => inFlight.delete(key));
		inFlight.set(key, p);
	}
	return p;
}
```

This coalesces requests within one server process. With ten servers you still get ten loads, which is usually fine. Other tools: add random jitter to TTLs (so keys created together do not expire together), refresh popular keys in the background before they expire, or serve the stale value while one request refreshes it.

## Trade-offs and when NOT to cache

- **Fix the slow query first.** A missing index (see [databases](/backend/database)) is cheaper and safer than a cache hiding it.
- **Do not cache what must be exact**: balances, stock at checkout, permissions. A stale "allowed" is a security bug (see [authorization](/security/authorization)).
- **A cache is more moving parts**: another server to run, monitor and secure, and a new class of "why is this old?" bugs. Measure the hit rate; a cache with a 10% hit rate is mostly cost.
- **In-process memory caches are per instance**, so different servers can disagree, and they vanish on restart. Fine for small immutable lookups (country lists), wrong for anything that must be consistent.
- Make the system work when the cache is down: treat a Redis error as a miss, not a failure.

## Checklist

- For each cached item, have you decided how stale it may be and set a TTL to match?
- Does the cache key include every input (user, filters, language, page)?
- Is anything personal or permission-dependent marked `public` or stored under a shared key?
- Do you know which writes must invalidate which keys?
- Are popular keys protected against stampedes, and does the app survive a cache outage?
