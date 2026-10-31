---
sources:
  - title: Monolith First
    url: https://martinfowler.com/bliki/MonolithFirst.html
    publisher: Martin Fowler
  - title: Microservices
    url: https://martinfowler.com/articles/microservices.html
    publisher: Martin Fowler and James Lewis
  - title: Microservice Trade-Offs
    url: https://martinfowler.com/articles/microservice-trade-offs.html
    publisher: Martin Fowler
  - title: Microservices architecture style
    url: https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices
    publisher: Microsoft Learn, Azure Architecture Center
  - title: Deconstructing the Monolith
    url: https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity
    publisher: Shopify Engineering
---

## The question behind the buzzwords

How many separately deployed programs should your backend be? Three common answers:

- **Monolith**: one codebase, one deployable program, usually one database. Parts talk by ordinary function calls.
- **Modular monolith**: still one deployable program, but internally split into modules with strict, enforced boundaries (each module exposes a small public API and hides its tables and internals).
- **Microservices**: many small programs, each deployed on its own, usually each owning its data, talking over the network (HTTP or message queues).

None of these is "the modern one". They trade different problems against each other.

## What the network costs you

The key insight: replacing a function call with a network call turns a certain thing into an uncertain one.

```ts bad title="Treating a remote call like a local one"
// In a monolith this was: const user = users.getById(id)
async function showOrder(orderId: string) {
	const order = await (await fetch(`http://orders/orders/${orderId}`)).json();
	const user = await (await fetch(`http://users/users/${order.userId}`)).json();
	const items = await Promise.all(
		order.itemIds.map((i: string) => fetch(`http://catalog/items/${i}`).then((r) => r.json()))
	);
	return { order, user, items };
}
```

What goes wrong:

- Any of the three services can be down, slow or return garbage. Nothing here handles that.
- Latency adds up: 1 + 1 + N requests per page view.
- There is no transaction across services: you cannot "update order and reduce stock" atomically, so you need to handle half-finished states.

Defensive version for the calls that remain:

```ts good title="Timeout, status check and a fallback for a non-critical dependency"
async function getJson<T>(url: string, ms = 800): Promise<T> {
	const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
	if (!res.ok) throw new Error(`${url} responded ${res.status}`);
	return res.json();
}

const user = await getJson<User>(`http://users/users/${order.userId}`).catch(() => null);
// Page still renders (without the name) if the users service is down.
```

## Side-by-side

|                    | Monolith        | Modular monolith | Microservices                                       |
| ------------------ | --------------- | ---------------- | --------------------------------------------------- |
| Deploy             | One unit        | One unit         | Many, independent                                   |
| Local dev          | Easy            | Easy             | Needs many services running                         |
| Debugging          | One stack trace | One stack trace  | Distributed (needs [traces](/common/observability)) |
| Data consistency   | One transaction | One transaction  | Hard; handled by hand                               |
| Team independence  | Low             | Medium           | High                                                |
| Scale one hot part | No (scale all)  | No               | Yes                                                 |
| Operational load   | Low             | Low              | High (CI, monitoring, versions, networking)         |

The real reason to choose microservices is **organisational**: many teams that must release without waiting for each other. The technical reasons (scaling one part, different tech stacks) are real but rarer than people think.

## "Eventual consistency" in plain words

Once data lives in separate services, they cannot all be updated in one transaction. Often one service announces "order placed" and others update a little later. For a short time, parts of the system disagree. That is **eventual consistency**: the data will agree, just not instantly. The frontend feels this: after "Place order" the order list may not show it yet, so you need optimistic UI or a "processing" status. This is a cost you accept only when you get something worthwhile back.

## How to choose

Fowler's "monolith first" observation: nearly every successful microservice system started as a monolith that grew too big, and many systems built as microservices from day one got the boundaries wrong. Splitting wrongly is costly, because moving a boundary across a network is far harder than moving a function between folders.

A practical path:

1. Start with a monolith.
2. Keep it modular: modules own their data, talk through a small public interface, and do not import each other's internals.
3. Extract a service only for a concrete pain: a part with very different scaling needs, a team that is blocked by shared releases, or a risky component that needs isolation.

```ts good title="Module boundary inside a monolith: other modules import only index.ts"
// src/modules/billing/index.ts  (public surface)
export { createInvoice } from './create-invoice';
export type { Invoice } from './types';
// Internals (./db, ./pdf-renderer) are not exported.
// Enforce this with a lint rule (for example eslint-plugin-boundaries) so it does not rot.
```

If a module's boundary is clean, extracting it later is mostly replacing a function call with a network call at one seam.

## The frontend angle

The same question exists in the FE: **micro-frontends** split one UI into independently deployed pieces. They bring the same trade-offs (duplicated dependencies, inconsistent UX, integration testing) and make sense mainly for very large organisations. A **backend-for-frontend** (BFF), a thin server built for one UI that aggregates calls to other services, often solves the "1 + 1 + N requests" problem from above without more services on the client.

## When NOT to use microservices

- A team of fewer than about 10 to 15 developers.
- A new product whose domain you do not understand yet.
- No automated deployment, no monitoring: you cannot operate many services blind.

## Checklist

- Can you name the concrete problem that a split would solve?
- Are the module boundaries clean enough to extract later, even if you do not?
- If you call other services, are there timeouts, retries and fallbacks?
- Do you know which operations need a single transaction? Keep those together.
- Do you have monitoring and automated deployment before you add services?
