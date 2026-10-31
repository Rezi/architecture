---
sources:
  - title: PresentationDomainDataLayering
    url: https://martinfowler.com/bliki/PresentationDomainDataLayering.html
    publisher: Martin Fowler
  - title: Service Layer
    url: https://martinfowler.com/eaaCatalog/serviceLayer.html
    publisher: Martin Fowler (Patterns of Enterprise Application Architecture)
  - title: Repository
    url: https://martinfowler.com/eaaCatalog/repository.html
    publisher: Martin Fowler (Patterns of Enterprise Application Architecture)
  - title: Hexagonal architecture (ports and adapters)
    url: https://alistair.cockburn.us/hexagonal-architecture/
    publisher: Alistair Cockburn
---

## The problem: one function that does everything

On the frontend you already know the feeling of a 600-line component that fetches data, formats it, validates a form and renders markup. It works, but you cannot test one part without all the others, and every change risks breaking something unrelated. Servers get the same disease, usually in the form of a single route handler.

Here is a realistic "create order" endpoint written the quick way.

```ts bad title="One handler: HTTP, business rules, SQL and email all tangled together"
app.post('/orders', async (req, res) => {
	const { userId, items } = req.body;
	let total = 0;
	for (const item of items) {
		const { rows } = await pool.query('SELECT price_cents FROM products WHERE id = $1', [
			item.productId
		]);
		total += rows[0].price_cents * item.qty;
	}
	if (total > 100_000) total = Math.round(total * 0.95); // 5% discount for big orders
	const { rows } = await pool.query(
		'INSERT INTO orders (user_id, total_cents) VALUES ($1, $2) RETURNING id',
		[userId, total]
	);
	await fetch('https://mail.example.com/send', {
		method: 'POST',
		body: JSON.stringify({ to: req.body.email, subject: `Order ${rows[0].id}` })
	});
	res.status(201).json({ id: rows[0].id, total });
});
```

What goes wrong with this version, concretely:

- **The discount rule is trapped inside HTTP.** To reuse it from a nightly import job or an admin tool you must copy it. Two copies drift apart.
- **You can only test it by faking an HTTP request and having a real database and mail server.** Tests are slow, so people stop writing them.
- **Changing the database (say, adding a `currency` column) means editing the route.** The person changing the table has to understand the web layer.

## The fix: three layers with one-way dependencies

A **layer** is a group of code with one job. The common backend split has three:

| Layer                                          | Job                                                                                                 | Knows about                  | Must NOT know about              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------- |
| Handler (also called controller or route)      | Translate HTTP into a function call and back: parse input, call the service, choose the status code | HTTP, the service            | SQL, business rules              |
| Service (also called use case or domain layer) | The business rules: "big orders get a discount", "stock cannot go negative"                         | Repositories, other services | HTTP objects (`req`, `res`), SQL |
| Repository                                     | Read and write the database. One place that contains SQL                                            | The database                 | Business rules, HTTP             |

Dependencies point **one way only**: handler calls service, service calls repository. A repository never calls a service. This is the same idea as the frontend rule that a presentational component should not know how data is fetched; see [layering and boundaries](/common/layering-and-boundaries) for the general version.

```text title="Suggested folder layout"
src/
  orders/
    orders.routes.ts      # handlers
    orders.service.ts     # business rules
    orders.repository.ts  # SQL
    orders.schema.ts      # input validation (see the validation page)
  users/
    ...
  main.ts                 # wires everything together
```

Group by feature (`orders/`, `users/`), not by layer (`controllers/`, `services/`). A change to orders then touches one folder, just like a feature folder in a frontend app.

## The same endpoint, layered

```ts good title="orders.repository.ts: only SQL"
export const ordersRepository = {
	async getPrices(productIds: string[]): Promise<Map<string, number>> {
		const { rows } = await pool.query('SELECT id, price_cents FROM products WHERE id = ANY($1)', [
			productIds
		]);
		return new Map(rows.map((r) => [r.id, r.price_cents]));
	},
	async insert(userId: string, totalCents: number): Promise<{ id: string }> {
		const { rows } = await pool.query(
			'INSERT INTO orders (user_id, total_cents) VALUES ($1, $2) RETURNING id',
			[userId, totalCents]
		);
		return rows[0];
	}
};
```

```ts good title="orders.service.ts: only business rules, no HTTP and no SQL"
export function calculateTotal(lines: { priceCents: number; qty: number }[]): number {
	const subtotal = lines.reduce((sum, l) => sum + l.priceCents * l.qty, 0);
	return subtotal > 100_000 ? Math.round(subtotal * 0.95) : subtotal;
}

export async function placeOrder(userId: string, items: { productId: string; qty: number }[]) {
	const prices = await ordersRepository.getPrices(items.map((i) => i.productId));
	const lines = items.map((i) => {
		const priceCents = prices.get(i.productId);
		if (priceCents === undefined) throw new NotFoundError(`Product ${i.productId}`);
		return { priceCents, qty: i.qty };
	});
	const total = calculateTotal(lines);
	const order = await ordersRepository.insert(userId, total);
	return { id: order.id, total };
}
```

```ts good title="orders.routes.ts: only HTTP"
app.post('/orders', async (req, res) => {
	const input = createOrderSchema.parse(req.body); // validation: see next pages
	const order = await placeOrder(req.user.id, input.items);
	res.status(201).json(order);
});
```

Now `calculateTotal` is a plain function: you can test the discount rule with three lines and no database. The other thing the quick version did, sending the email, is deliberately left out here. Slow side effects belong in a [background job](/backend/background-jobs), not in the request.

Notice also that the repository fetches all prices in **one** query instead of one per item. Keeping SQL in one place makes that kind of fix easy; the [database page](/backend/database) explains why it matters.

## Where does a rule belong?

A useful test: _would this rule still be true if we replaced HTTP with a command-line tool?_ "Big orders get 5% off" is, so it belongs in the service. "Return 404 when the product is missing" is an HTTP concern, so the service throws a domain error (`NotFoundError`) and a single piece of error-handling code turns it into a 404. That mapping is covered in [validation and errors](/backend/validation-and-errors).

Two related ideas you will meet, briefly:

- **Hexagonal architecture / ports and adapters** takes the same idea further: the business rules sit in the middle and talk to the outside world (HTTP, database, mail) only through small interfaces. The [next page](/backend/dependency-injection) shows how to do that without a framework.
- **Domain model**: when rules get complex you move them into objects or modules that know nothing about storage. Start with plain functions like `calculateTotal`; do not build a "domain model" on day one.

## Trade-offs and when NOT to do this

- **Do not create layers that only forward calls.** If `getUser` in the service just calls `getUser` in the repository, for a simple read, the service adds a file and no value. For plain CRUD (create, read, update, delete with no rules) a handler calling a repository is fine. Add the service when the first real rule appears.
- **More layers mean more files to open for each change.** A prototype or a script with one endpoint does not need this.
- **Do not leak between layers to save time.** Returning raw database rows from the repository straight to the client couples your public API to your table columns; renaming a column becomes a breaking API change. Map to a deliberate response shape.
- **Layers are not microservices.** All of this lives in one deployable program. See [monolith vs distributed](/common/monolith-vs-distributed) for when splitting further makes sense.

> Key takeaway: handlers speak HTTP, services speak business, repositories speak SQL. Each layer is allowed to know only the one below it.

## Checklist

- Can you test your most important business rule without HTTP and without a database?
- Does any file import both `express` (or your web framework) and a database client?
- Is all SQL in repositories, and do repositories contain no business decisions?
- Does the service throw domain errors rather than set HTTP status codes?
- Did you add each layer because it earns its place, not because a template had it?
