---
sources:
  - title: Background jobs
    url: https://learn.microsoft.com/en-us/azure/architecture/best-practices/background-jobs
    publisher: Microsoft Learn, Azure Architecture Center
  - title: Queue-Based Load Leveling pattern
    url: https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling
    publisher: Microsoft Learn, Azure Architecture Center
  - title: Making retries safe with idempotent APIs
    url: https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
    publisher: Amazon Builders' Library
  - title: Transactional outbox
    url: https://microservices.io/patterns/data/transactional-outbox.html
    publisher: microservices.io (Chris Richardson)
  - title: The Twelve-Factor App, Concurrency
    url: https://12factor.net/concurrency
    publisher: 12factor.net
---

## The problem: slow work inside a request

A user places an order. The server must save it (10 ms), send a confirmation email (800 ms, sometimes 30 s when the mail provider is having a bad day), generate a PDF invoice (2 s) and notify a warehouse system. If the handler does all this before responding, the user stares at a spinner, and the request can hit a timeout (a limit after which the proxy or browser gives up) even though half the work succeeded.

```ts bad title="Everything inside the request"
app.post('/orders', async (req, res) => {
	const order = await ordersService.place(req.user.id, req.body.items);
	await mailer.sendReceipt(order.id); // slow, and fails when the provider is down
	await invoices.generatePdf(order.id); // CPU heavy, blocks this connection
	res.status(201).json(order); // user waits for ALL of it
});
```

What goes wrong: the response time is the sum of everything. If the mail provider is down, the user gets a 500 even though the order was saved, so they retry and create a duplicate. Under heavy traffic, slow requests pile up and occupy all your server's capacity.

A tempting half-fix is also bad:

```ts bad title="Fire and forget: the work is lost if the process dies"
const order = await ordersService.place(req.user.id, req.body.items);
mailer.sendReceipt(order.id).catch(console.error); // no await
res.status(201).json(order);
// A deploy, crash or restart right now silently drops the email. Nothing retries it.
```

## The fix: put a note in a queue and answer immediately

A **queue** is a durable list of tasks. The web server (the **producer**) writes a small job description to it and responds. Separate **worker** processes read jobs and do the slow work, retrying if it fails. The frontend equivalent is moving heavy work off the main thread into a Web Worker, except here the work also survives crashes.

```ts good title="The handler only records the intent"
app.post('/orders', async (req, res) => {
	const order = await ordersService.place(req.user.id, req.body.items);
	await queue.add(
		'send-receipt',
		{ orderId: order.id },
		{ attempts: 5, backoff: { type: 'exponential', delay: 2000 } }
	);
	await queue.add('generate-invoice', { orderId: order.id });
	res.status(201).json(order); // done in milliseconds
});
```

```ts good title="worker.ts: a separate process consumes jobs"
worker('send-receipt', async ({ orderId }: { orderId: string }) => {
	const order = await ordersRepository.get(orderId);
	if (order.receiptSentAt) return; // already done: safe to run twice
	await mailer.sendReceipt(order);
	await ordersRepository.markReceiptSent(orderId);
});
```

Libraries differ (BullMQ on Redis, pg-boss on PostgreSQL, a managed queue such as AWS SQS) but the shape is identical: `add` a job, register a handler, configure retries. If you already run PostgreSQL, a Postgres-based queue means one less system to operate. Because workers are separate from web servers, you can scale them independently, one of the twelve-factor ideas ("scale out via the process model").

Queues also smooth traffic: a sudden spike of 10,000 signups becomes 10,000 queued jobs that workers drain at a steady pace instead of overwhelming the mail provider. This is called load leveling.

## Jobs run at least once, so handlers must be idempotent

Most queues promise **at-least-once delivery**: every job will be delivered, but possibly more than once (a worker crashes after sending the email but before confirming completion, so the queue hands the job to someone else). Exactly-once is not realistic in general.

So a handler must be **idempotent**: running it twice has the same effect as running it once (the same idea as in [API design](/backend/api-design)). The `receiptSentAt` check above does this. Other techniques:

- Use a unique key in the database: `INSERT ... ON CONFLICT DO NOTHING` keyed by the job's identifier.
- Pass an idempotency key to the external API (payment providers support this) built from the job ID.
- Prefer "set status to shipped" over "add 1 to counter".

```ts bad title="Not idempotent: a retry charges the customer twice"
worker('charge-order', async ({ orderId }) => {
	const order = await ordersRepository.get(orderId);
	await paymentProvider.charge(order.customerId, order.totalCents);
	await ordersRepository.markPaid(orderId); // crash before this line, and the retry charges again
});
```

```ts good title="Idempotency key derived from the job makes the retry harmless"
worker('charge-order', async ({ orderId }) => {
	const order = await ordersRepository.get(orderId);
	if (order.status === 'paid') return;
	await paymentProvider.charge(order.customerId, order.totalCents, {
		idempotencyKey: `charge-${orderId}`
	});
	await ordersRepository.markPaid(orderId);
});
```

## Retries, backoff and dead letters

Failures are normal: the provider is down, the network blips. Retry with **exponential backoff** (waits grow: 2 s, 4 s, 8 s, ...) so you do not hammer something that is struggling; [reliability](/backend/reliability) explains why. Distinguish failures: a timeout is worth retrying; "invalid email address" never will succeed, so fail it immediately.

After the maximum attempts, move the job to a **dead-letter queue**: a holding area for jobs that keep failing. Without one, poison jobs either loop forever or disappear. Alert on dead-letter size and make it possible to inspect and replay jobs after fixing the bug.

## One more trap: the job that is lost between two systems

In the good handler above, if the process crashes after saving the order but before `queue.add`, the order exists and no receipt is ever sent. The fix is the **transactional outbox**: in the same database transaction that saves the order, insert a row into an `outbox` table; a small relay reads the table and pushes to the queue, marking rows done. Saving the order and recording the intent now succeed or fail together. If you use a Postgres-backed queue, you can enqueue inside your transaction directly.

## What the user sees

The client needs to know the work is not finished. Return `202 Accepted` with a status URL for long operations (an export, a report) and let the frontend poll or listen; see [data fetching](/frontend/data-fetching).

```http title="Accepted, not yet done"
HTTP/1.1 202 Accepted
Location: /exports/8f2c

GET /exports/8f2c  ->  { "status": "running" }   later   { "status": "done", "downloadUrl": "..." }
```

## Trade-offs and when NOT to do this

- A queue is infrastructure to run, monitor and secure, and adds eventual consistency: the email arrives after the response. For a hobby app, doing one short task inline is fine.
- Do not queue work whose result the user needs in the response (the order total). Queue what can happen later.
- Debugging gets harder: add the request or order ID to each job and log it so you can trace a request across the web server and workers ([observability](/common/observability)).
- Scheduled work (nightly cleanup) is also a job, but make sure only one instance runs it, or make it idempotent.

## Checklist

- Is every slow or flaky side effect (email, PDF, webhook) outside the request path?
- Is each job handler safe to run twice?
- Do retries use backoff, a maximum attempt count and a dead-letter queue you actually monitor?
- Can a crash between "save data" and "enqueue job" lose work? (Use an outbox or an in-transaction queue.)
- Do jobs carry an ID for tracing, and can you replay failed ones?
