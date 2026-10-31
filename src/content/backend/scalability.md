---
sources:
  - title: The Twelve-Factor App, Processes
    url: https://12factor.net/processes
    publisher: 12factor.net
  - title: The Twelve-Factor App, Disposability
    url: https://12factor.net/disposability
    publisher: 12factor.net
  - title: Don't Block the Event Loop (or the Worker Pool)
    url: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop
    publisher: Node.js
  - title: Using load shedding to avoid overload
    url: https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/
    publisher: Amazon Builders' Library
  - title: MonolithFirst
    url: https://martinfowler.com/bliki/MonolithFirst.html
    publisher: Martin Fowler
  - title: Rate limiters
    url: https://stripe.com/blog/rate-limiters
    publisher: Stripe
---

## What "scalable" means

A system **scales** if it can handle more load (more users, more data, more requests per second) by adding resources, without a rewrite. There are two ways to add them:

- **Vertical scaling**: a bigger machine. Simple, works until you hit the biggest machine available, and one server is still a single point of failure.
- **Horizontal scaling**: more machines behind a **load balancer**, a component that spreads incoming requests across them. It has a higher ceiling and gives you redundancy, but your code must be ready for it.

Being ready is mostly one property: being **stateless**.

## Stateless servers

A **stateless** server keeps nothing between requests that a later request depends on. Everything it needs arrives with the request or comes from a shared store (database, Redis, object storage). Then any instance can serve any request, and you can add, remove or restart instances freely. It is like a pure function: same input and shared data, same output, no hidden memory.

```ts bad title="State held in this one process's memory"
const sessions = new Map<string, User>(); // login sessions
const requestCounts = new Map<string, number>(); // rate limiting

app.post('/login', async (req, res) => {
	const user = await auth.verify(req.body);
	const id = crypto.randomUUID();
	sessions.set(id, user); // only THIS instance knows the session
	res.cookie('sid', id, { httpOnly: true }).end();
});

app.post('/upload', upload.single('file'), (req, res) => {
	// saved to the local disk of this instance; another instance cannot serve it
	res.json({ url: `/files/${req.file!.filename}` });
});
```

With one server this works. With two, the user logs in on instance A, the next request lands on instance B, and they appear logged out. The rate limit allows twice the intended traffic. Uploaded files 404 half the time. Restarting or deploying wipes all sessions. And you only discover this once you scale, which is the worst time.

```ts good title="State lives in shared stores"
app.post('/login', async (req, res) => {
	const user = await auth.verify(req.body);
	const id = crypto.randomUUID();
	await redis.set(`session:${id}`, JSON.stringify(user), { EX: 60 * 60 * 8 });
	res.cookie('sid', id, { httpOnly: true, secure: true, sameSite: 'lax' }).end();
});

app.post('/upload', upload.single('file'), async (req, res) => {
	const key = `uploads/${crypto.randomUUID()}`;
	await objectStorage.put(key, req.file!.buffer); // S3-compatible storage
	res.json({ url: await objectStorage.signedUrl(key) });
});
```

Signed tokens (such as a JWT) are another way to keep session data out of the server; see [authentication](/security/authentication) for the trade-offs. The same reasoning applies to scheduled tasks (run them in one place or make them idempotent), in-memory caches (see [caching](/backend/caching)) and WebSocket connections (which need shared pub/sub to broadcast across instances).

## Node specifics: do not block the event loop

Node runs your JavaScript on essentially one thread, switching between requests while they wait for I/O. That is efficient for waiting on databases, but any long synchronous computation freezes **every** request on that instance, as if one slow function froze your whole browser tab.

```ts bad title="Synchronous CPU work inside a handler"
app.post('/register', (req, res) => {
	const hash = pbkdf2Sync(req.body.password, salt, 600_000, 64, 'sha512'); // blocks ~300 ms
	// during this time the instance answers nobody else
	res.json({ hash: hash.toString('hex') });
});
```

```ts good title="Use the asynchronous version, which runs on the thread pool"
import { pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';
const pbkdf2Async = promisify(pbkdf2);

app.post('/register', async (req, res) => {
	const hash = await pbkdf2Async(req.body.password, salt, 600_000, 64, 'sha512');
	res.json({ hash: hash.toString('hex') });
});
```

For heavy work with no async version (image resizing, big JSON transformations, PDF generation) use `worker_threads` or push it to a [background job](/backend/background-jobs). Also watch for unbounded work such as `JSON.parse` of huge bodies or regexes with catastrophic backtracking.

## Where the bottleneck really is

Adding web servers fixes web server limits. Usually the database gives out first, because all the instances share it. Work through these in order:

1. **Fix queries and indexes** ([databases](/backend/database)). Cheapest, biggest win.
2. **Cache** repeated reads ([caching](/backend/caching)).
3. **Connection pooling.** The database accepts only a limited number of connections (PostgreSQL defaults to about 100). Ten instances with a pool of 20 each want 200. Size pools deliberately, or put a pooler such as PgBouncer in front.
4. **Read replicas**: extra copies of the database that serve reads. Replication is slightly delayed, so a user who just saved something and immediately reads from a replica may not see it (**replication lag**). Route read-your-own-write requests to the primary.
5. **Move slow work out of requests** ([background jobs](/backend/background-jobs)).
6. **Partition or shard** the data (split tables across databases) only when a single database truly cannot cope. It is expensive and permanent.

## Protect yourself when load exceeds capacity

Some day traffic will exceed what you can serve, from a viral post, a buggy client in a retry loop, or abuse. Decide how to fail rather than slowing down for everyone.

```ts good title="A rate limit per client, in a shared store so all instances agree"
async function rateLimit(req: Request, res: Response, next: NextFunction) {
	const key = `rl:${req.ip}:${Math.floor(Date.now() / 60_000)}`; // one counter per minute
	const count = await redis.incr(key);
	if (count === 1) await redis.expire(key, 60);
	if (count > 100) {
		res.set('Retry-After', '30');
		return res.status(429).json({ title: 'Too many requests', status: 429 });
	}
	next();
}
```

**Rate limiting** caps what one client may do. **Load shedding** goes further: when the whole server is overloaded, quickly reject low-priority requests with `503` instead of accepting everything and timing out on all of it. Serving 80% of users well beats serving 100% badly. The frontend's part is to honour `Retry-After` and back off.

## Graceful shutdown

Scaling in means instances are stopped regularly, as do deployments. On `SIGTERM`, stop accepting new connections, let in-flight requests finish, close the database pool, then exit. Without it, every deploy cuts requests off mid-flight (the twelve-factor "disposability" idea: fast start, clean stop).

```ts good title="Finish current work before exiting"
process.on('SIGTERM', () => {
	server.close(async () => {
		// stops accepting, waits for open requests
		await pool.end();
		process.exit(0);
	});
	setTimeout(() => process.exit(1), 25_000).unref(); // hard limit if something hangs
});
```

## Trade-offs and when NOT to do this

- **Do not scale prematurely.** One modest server plus a managed database handles far more than most products ever see. Measure first (load test, watch CPU, latency and database metrics) and fix the real bottleneck.
- **A well-structured single application scales surprisingly far.** Splitting into microservices to "be scalable" mostly adds network failures and operations work; Fowler's advice is to start with a monolith. See [monolith vs distributed](/common/monolith-vs-distributed).
- Stateless design costs extra network hops (Redis for sessions). It is worth it as soon as you plan a second instance, even for redundancy.
- Autoscaling reacts in minutes; sudden spikes still need caching, queues and shedding to survive in the meantime.

## Checklist

- Could you start a second instance today without logins, uploads, rate limits or jobs breaking?
- Does any handler do synchronous CPU-heavy work?
- Do pool sizes times instance count stay under the database's connection limit?
- Have you measured where the bottleneck is before adding hardware or complexity?
- Is there a rate limit, a defined overload behaviour (429/503) and a graceful shutdown?
