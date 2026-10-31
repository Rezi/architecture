---
sources:
  - title: Presentation Domain Data Layering
    url: https://martinfowler.com/bliki/PresentationDomainDataLayering.html
    publisher: Martin Fowler
  - title: Hexagonal architecture (Ports and Adapters)
    url: https://alistair.cockburn.us/hexagonal-architecture/
    publisher: Alistair Cockburn
  - title: The Clean Architecture
    url: https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
    publisher: Robert C. Martin
  - title: Inversion of Control Containers and the Dependency Injection pattern
    url: https://martinfowler.com/articles/injection.html
    publisher: Martin Fowler
---

## The problem: the business depends on the tools

Suppose your order logic calls `pg.query(...)` directly and reads `req.headers`. Now the rule "an order needs stock" cannot run without PostgreSQL and Express. Upgrading the ORM, moving to a queue worker, or writing a fast test all become big jobs, because the _important_ code depends on the _replaceable_ code.

The fix is **layering** plus one rule about direction.

## Layers in one picture

```text
UI / HTTP handlers      (presentation: translate the outside world)
        |
        v
Application / domain    (business rules: what the product does)
        |
        v
Data access / external  (database, payment API, e-mail: details)
```

The classic reading is "each layer calls the one below". That is fine, but it still makes your rules depend on the database. The more useful rule is:

> **Dependencies point toward the business rules.** Rules never import the database driver, the web framework or the UI library. The outer, volatile code imports the rules.

You will see this under many names: **ports and adapters** (also "hexagonal architecture") and **clean architecture**. Both mean the same thing in practice: the rules define a small interface (a **port**) for what they need, and outer code supplies an implementation (an **adapter**). Handing the rules their dependencies from outside is called **dependency injection**; in practice it is just "pass it as a parameter".

## Before: rules reach down into details

```ts bad title="Business rule imports the database and the framework"
import { pool } from './db'; // concrete PostgreSQL pool
import type { Request } from 'express';

export async function placeOrder(req: Request) {
	const { itemId, qty } = req.body;
	const { rows } = await pool.query('select stock from items where id = $1', [itemId]);
	if (rows[0].stock < qty) throw new Error('Out of stock');
	await pool.query('update items set stock = stock - $1 where id = $2', [qty, itemId]);
}
```

Concrete problems:

- A unit test needs a real database (slow, flaky) or a fragile module mock.
- Calling it from a queue worker means faking an Express `Request`.
- Changing the table or the ORM means editing business code.

## After: rules own the interface, details implement it

```ts good title="order-service.ts: depends only on a port it defines"
export interface StockRepository {
	getStock(itemId: string): Promise<number>;
	decrease(itemId: string, qty: number): Promise<void>;
}

export class OutOfStockError extends Error {}

export async function placeOrder(
	stock: StockRepository,
	input: { itemId: string; qty: number }
): Promise<void> {
	if ((await stock.getStock(input.itemId)) < input.qty) throw new OutOfStockError();
	await stock.decrease(input.itemId, input.qty);
}
```

```ts good title="pg-stock-repository.ts: adapter (the detail)"
import type { Pool } from 'pg';
import type { StockRepository } from './order-service';

export const pgStockRepository = (pool: Pool): StockRepository => ({
	async getStock(id) {
		const { rows } = await pool.query('select stock from items where id = $1', [id]);
		return rows[0]?.stock ?? 0;
	},
	async decrease(id, qty) {
		await pool.query('update items set stock = stock - $1 where id = $2', [qty, id]);
	}
});
```

```ts good title="http handler: translates HTTP, calls the rule"
app.post('/orders', async (req, res) => {
	try {
		await placeOrder(pgStockRepository(pool), req.body);
		res.status(201).end();
	} catch (e) {
		if (e instanceof OutOfStockError) return res.status(409).json({ code: 'OUT_OF_STOCK' });
		throw e;
	}
});
```

Test with an in-memory fake, no database:

```ts good title="order-service.test.ts"
const fake: StockRepository = {
	getStock: async () => 1,
	decrease: async () => {}
};
await expect(placeOrder(fake, { itemId: 'a', qty: 2 })).rejects.toThrow(OutOfStockError);
```

(Production note: the check-then-update above has a race; real code would do the decrease atomically. The layering point stands.)

## The same boundary on the frontend

A component should not know the shape of the HTTP response or the URL. Put a boundary around the API (a small module), return your own types, and let the UI depend on that.

```ts good title="src/lib/users.ts: boundary between UI and the server's wire format"
type UserDto = { id: number; first_name: string; last_name: string };
export type User = { id: string; fullName: string };

export async function getUser(id: string): Promise<User> {
	const dto: UserDto = await (await fetch(`/api/users/${id}`)).json();
	return { id: String(dto.id), fullName: `${dto.first_name} ${dto.last_name}` };
}
```

When the backend renames `first_name`, one file changes, not forty components. See also [API contracts](/common/api-contracts).

## When NOT to do this

- **CRUD apps.** If the "rule" is "save this form to a table", a port in between is ceremony. Call the data layer from the handler.
- **Tiny services and prototypes.** Start flat; extract a port when a second implementation or a painful test appears.
- **One interface per class "just in case".** An interface with exactly one implementation and no test fake is noise.

A pragmatic test: _would I need to fake this in a test, or could it plausibly change?_ If yes, draw a boundary. If no, do not.

## Checklist

- Do your business rules import any framework, driver or UI package? They should not.
- Does every arrow of dependency point toward the rules?
- Can you run the core rules in a test with no network, database or browser?
- Does the UI use your own types instead of raw server responses?
- Is each boundary justified by a real test or change need?
