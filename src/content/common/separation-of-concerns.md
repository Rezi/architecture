---
sources:
  - title: On the role of scientific thought (EWD447)
    url: https://www.cs.utexas.edu/~EWD/transcriptions/EWD04xx/EWD447.html
    publisher: Edsger W. Dijkstra
  - title: Presentation Domain Data Layering
    url: https://martinfowler.com/bliki/PresentationDomainDataLayering.html
    publisher: Martin Fowler
  - title: AHA Programming
    url: https://kentcdodds.com/blog/aha-programming
    publisher: Kent C. Dodds
  - title: Writing Resilient Components
    url: https://overreacted.io/writing-resilient-components/
    publisher: Dan Abramov
---

## The problem: one place that knows everything

Open a component that fetches data, applies pricing rules, formats currency, handles errors and renders HTML, all in one 400-line file. Changing the VAT rate means reading the markup. Changing the markup risks breaking the VAT rate. Nobody can test the pricing rule without rendering a component.

**Separation of concerns** (SoC) means: each piece of code deals with one _concern_ (one reason to change), and knows as little as possible about the others. Dijkstra coined the phrase in 1974: study one aspect of a problem at a time, ignoring the others.

Why it is good, concretely:

- **Smaller blast radius.** A change to one concern touches one place.
- **Testable.** Pure rules can be tested with plain function calls.
- **Replaceable.** You can swap the UI library or the HTTP client without rewriting the rules.
- **Readable.** A new teammate finds "where is the discount calculated?" in seconds.

## Two measuring sticks: cohesion and coupling

Two plain-word definitions you will see everywhere:

- **Cohesion**: how closely the things _inside_ one module belong together. High cohesion: everything in `pricing.ts` is about prices.
- **Coupling**: how much one module _depends on the internals_ of another. Low coupling: you can change module A without touching B.

You want **high cohesion and low coupling**. A file called `utils.ts` with 60 unrelated functions has low cohesion. A component that reaches into another component's private state has high coupling.

## Before: everything in one component

```svelte bad title="Fetching, business rules, formatting and UI mixed together"
<script lang="ts">
	let cart = $state<{ price: number; qty: number; type: string }[]>([]);

	$effect(() => {
		fetch('/api/cart')
			.then((r) => r.json())
			.then((d) => (cart = d.items));
	});

	// business rule hidden in the view
	let total = $derived(
		cart.reduce((sum, i) => sum + i.price * i.qty * (i.type === 'book' ? 1.1 : 1.21), 0)
	);
</script>

<p>Total: {new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(total)}</p>
```

What goes wrong concretely:

- The VAT rule (10 percent for books, 21 percent otherwise) exists only here. The checkout page and the invoice e-mail will each copy it, and one copy will be wrong after the next law change.
- To test the rule you must mount a component and mock `fetch`.
- Prices are floating-point numbers; money bugs hide in the middle of the view.

## After: one concern per piece

```ts good title="src/lib/pricing.ts: pure business rule, no framework, no network"
export type CartItem = { priceCents: number; qty: number; category: 'book' | 'other' };

const VAT_RATE = { book: 0.1, other: 0.21 } as const;

export function totalCents(items: CartItem[]): number {
	return Math.round(
		items.reduce((sum, i) => sum + i.priceCents * i.qty * (1 + VAT_RATE[i.category]), 0)
	);
}
```

```ts good title="src/lib/cart-api.ts: data access only"
import type { CartItem } from './pricing';

export async function fetchCart(): Promise<CartItem[]> {
	const res = await fetch('/api/cart');
	if (!res.ok) throw new Error(`Cart request failed: ${res.status}`);
	return (await res.json()).items;
}
```

```svelte good title="Cart.svelte: presentation only"
<script lang="ts">
	import { fetchCart } from '$lib/cart-api';
	import { totalCents } from '$lib/pricing';
	import { formatEur } from '$lib/format';

	let cart = $state<Awaited<ReturnType<typeof fetchCart>>>([]);
	$effect(() => {
		fetchCart().then((items) => (cart = items));
	});
	let total = $derived(totalCents(cart));
</script>

<p>Total: {formatEur(total)}</p>
```

The same idea applies in React (a hook for data, a pure function for rules, a component for markup) and Vue (a composable). The framework is just the "presentation" slot.

And the rule is now testable in two lines:

```ts good title="pricing.test.ts"
import { expect, test } from 'vitest';
import { totalCents } from './pricing';

test('books get 10% VAT', () => {
	expect(totalCents([{ priceCents: 1000, qty: 2, category: 'book' }])).toBe(2200);
});
```

## The same on the backend

The same split appears in a request handler. A handler should translate HTTP into a function call and back, nothing more.

```ts bad title="Handler that talks HTTP, SQL and business rules at once"
app.post('/orders', async (req, res) => {
	const { rows } = await db.query('select stock from items where id = $1', [req.body.itemId]);
	if (rows[0].stock < req.body.qty) return res.status(409).send('no stock');
	await db.query('update items set stock = stock - $1 where id = $2', [
		req.body.qty,
		req.body.itemId
	]);
	res.status(201).send('ok');
});
```

Here the stock rule cannot be reused by a CLI import job or a queue worker, and it cannot be tested without a database and an HTTP server. More on the right shape on the [layers page](/common/layering-and-boundaries).

## When NOT to split

SoC has a price: more files, more indirection, more names to learn.

- A 30-line component used once does not need a service, a repository and a mapper. Splitting before there is a second use or a real rule is the "imaginary future" trap from [what is architecture](/common/what-is-architecture).
- Duplicating three lines is often cheaper than a wrong shared abstraction. Kent C. Dodds' "AHA" (avoid hasty abstractions) advice: wait until you see the pattern a few times.
- Do not split by _technical kind_ only (`components/`, `hooks/`, `utils/` for everything). Prefer grouping by feature (`cart/`, `checkout/`) and separating concerns _inside_ each.

## Checklist

- Can you change a business rule without opening a UI file?
- Can you test that rule without a browser, a network or a database?
- Does each module have one reason to change you could state in a sentence?
- Is there a `utils` or `helpers` file that has become a dumping ground?
- Are you splitting because a real second use or test need exists, not because it looks tidy?
