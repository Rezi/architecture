---
sources:
  - title: 'RFC 9110: HTTP Semantics'
    url: https://www.rfc-editor.org/rfc/rfc9110.html
    publisher: IETF
  - title: Web API design best practices
    url: https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design
    publisher: Microsoft Learn, Azure Architecture Center
  - title: Designing robust and predictable APIs with idempotency
    url: https://stripe.com/blog/idempotency
    publisher: Stripe
  - title: Idempotent requests
    url: https://docs.stripe.com/api/idempotent_requests
    publisher: Stripe API docs
  - title: Pagination
    url: https://docs.stripe.com/api/pagination
    publisher: Stripe API docs
  - title: We need tool support for keyset pagination
    url: https://use-the-index-luke.com/no-offset
    publisher: Use The Index, Luke
---

## Why API design matters

The API is the one part of the backend that your frontend, and maybe other teams and customers, depend on directly. Internal code can be refactored any day; a published API is a promise. A badly shaped API forces every client to work around it, forever. REST ("representational state transfer") is the common style: the server exposes **resources** (things such as orders and users) at URLs, and clients act on them with standard HTTP methods. See also [API contracts](/common/api-contracts) for the FE/BE agreement side.

## Resources and methods

Name URLs after nouns, and let the HTTP method be the verb.

```text bad title="Verbs in URLs, everything is POST"
POST /getUser
POST /createOrder
POST /orders/cancelOrder?id=42
```

```text good title="Nouns in URLs, method carries the action"
GET    /users/42              read one user
GET    /users/42/orders       read the orders of a user
POST   /orders                create an order
PATCH  /orders/42             change some fields
DELETE /orders/42             remove it
POST   /orders/42/cancellation   an action that is not plain CRUD: model it as a sub-resource
```

Why it is better: caches, proxies, logs and browsers understand the methods. A `GET` can be cached and safely retried; a `POST /getUser` cannot. Your frontend tooling (`fetch`, TanStack Query, the browser cache) already treats them differently.

| Method | Meaning                    | Safe (no changes)? | Idempotent?    |
| ------ | -------------------------- | ------------------ | -------------- |
| GET    | Read                       | yes                | yes            |
| PUT    | Replace the whole resource | no                 | yes            |
| PATCH  | Change part of it          | no                 | not guaranteed |
| DELETE | Remove                     | no                 | yes            |
| POST   | Create or run an action    | no                 | no             |

**Idempotent** means: doing it twice has the same effect as doing it once. Deleting order 42 twice still leaves it deleted. Creating an order twice leaves you with two orders, which is exactly the problem discussed below.

## Status codes tell clients what to do

```ts bad title="Always 200, and the real result hidden in the body"
app.get('/users/:id', async (req, res) => {
	const user = await users.find(req.params.id);
	if (!user) return res.status(200).json({ success: false, error: 'not found' });
	res.status(200).json({ success: true, data: user });
});
```

Every client, cache and monitoring dashboard sees a "successful" request. Your frontend must remember to check `success` everywhere, and alerting on error rate shows nothing.

```ts good title="Let the status code carry the outcome"
app.get('/users/:id', async (req, res) => {
	const user = await users.find(req.params.id);
	if (!user) return res.status(404).json({ title: 'User not found', status: 404 });
	res.json(user);
});
```

The codes you need most:

- `200 OK`, `201 Created` (include a `Location` header), `204 No Content`
- `400` malformed request, `401` not logged in, `403` logged in but not allowed, `404` not found, `409` conflict with current state, `422` well-formed but invalid data, `429` too many requests
- `500` our bug, `503` temporarily unavailable

The body format for errors is covered in [validation and errors](/backend/validation-and-errors).

## Pagination: never return "all of them"

A list endpoint that returns every row works in development with 20 rows and takes the server down with 2 million. **Pagination** returns a page at a time. There are two styles.

```sql bad title="Offset pagination: the database must skip all earlier rows"
SELECT id, title FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 100000;
-- Reads and throws away 100,000 rows, and shifts when rows are inserted while the user pages.
```

```sql good title="Cursor (keyset) pagination: continue after the last row you saw"
SELECT id, title, created_at FROM posts
WHERE (created_at, id) < ($1, $2)   -- values from the last row of the previous page
ORDER BY created_at DESC, id DESC
LIMIT 20;
-- Fast with an index on (created_at, id), and stable while data changes.
```

The API hands the client an opaque `nextCursor` string (for instance base64 of the two values) and the client sends it back as `?cursor=...`. Trade-off: with cursors you cannot jump to "page 57". If users need page numbers (an admin table), offset is acceptable for small tables.

## Idempotency keys: making POST safe to retry

Picture the FE: the user clicks "Pay", the network drops, the request is retried. Did the server charge once or twice? Retries are essential for reliability, but `POST` is not idempotent. The standard fix, popularised by Stripe, is an **idempotency key**: the client generates a unique ID per intended action and sends it in a header; the server remembers the result and replays it for the same key.

```ts good title="Replaying the stored response for a repeated Idempotency-Key"
app.post('/payments', async (req, res) => {
	const key = req.header('Idempotency-Key');
	if (!key) return res.status(400).json({ title: 'Idempotency-Key header required', status: 400 });

	// A UNIQUE constraint on key makes this safe even with two simultaneous requests.
	const inserted = await pool.query(
		'INSERT INTO idempotency_keys (key, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
		[key, req.user.id]
	);
	if (inserted.rowCount === 0) {
		const { rows } = await pool.query('SELECT status, body FROM idempotency_keys WHERE key = $1', [
			key
		]);
		if (rows[0].body === null)
			return res.status(409).json({ title: 'Request still in progress', status: 409 });
		return res.status(rows[0].status).json(rows[0].body); // same answer as the first time
	}

	const payment = await payments.charge(req.user.id, req.body.amountCents);
	await pool.query('UPDATE idempotency_keys SET status = 201, body = $2 WHERE key = $1', [
		key,
		payment
	]);
	res.status(201).json(payment);
});
```

On the client, generate the key once when the user clicks, and reuse it for every retry of that click (`crypto.randomUUID()`). This is the server-side counterpart to disabling the submit button, which only protects against a double click in one tab.

## Versioning: change without breaking people

Once clients exist you cannot rename a field freely. Prefer **additive changes**: new optional fields and new endpoints break nobody. Removing or renaming a field, changing a type or making an optional parameter required are **breaking changes**.

- If you control all clients (a single FE deployed with the BE), you can often change both in one release and avoid versions entirely.
- For public or mobile clients (old app versions live for years), put a version in the URL (`/v2/orders`) or a header, and keep the old one running for a stated period.
- Document the contract in an OpenAPI file so clients can generate types; this catches drift early.

## Trade-offs and when NOT to do this

- REST is not always the best fit. Highly nested data needed by many different screens may be better served by GraphQL, and server-to-server calls with strict schemas by RPC. Pick consciously.
- Do not chase theoretical purity. `POST /orders/42/cancellation` is better than contorting a `DELETE`. Consistency inside your API matters more than matching a textbook.
- Idempotency keys cost a table and cleanup (expire after 24 hours). Use them for payments, orders and anything with side effects, not for every endpoint.

## Checklist

- Are URLs nouns, with the right HTTP method and status code for each outcome?
- Does every list endpoint have a maximum page size, and does the large one use cursors?
- Can a client safely retry any create or payment request?
- Are changes additive by default, with a plan for the day you must break something?
- Is the contract written down (OpenAPI) and checked in CI?
