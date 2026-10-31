---
sources:
  - title: State Management
    url: https://svelte.dev/docs/kit/state-management
    publisher: SvelteKit docs
  - title: React Query as a State Manager
    url: https://tkdodo.eu/blog/react-query-as-a-state-manager
    publisher: TkDodo's blog
  - title: State Colocation will make your React app faster
    url: https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster
    publisher: Kent C. Dodds
  - title: Choosing the State Structure
    url: https://react.dev/learn/choosing-the-state-structure
    publisher: react.dev
  - title: State Management
    url: https://vuejs.org/guide/scaling-up/state-management.html
    publisher: Vue.js docs
---

## The problem: "state" is four different things

Most state management pain comes from treating all state the same way, usually by putting everything in one global store. In fact there are four kinds, with different owners and different needs:

| Kind                    | Example                                  | Who owns the truth           | Best home                                                                        |
| ----------------------- | ---------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| **Local UI state**      | Is the dropdown open? Text in an input   | The component                | A variable inside the component                                                  |
| **Shared client state** | Theme, open cart drawer, wizard progress | The browser app              | A small module or context shared by a few components                             |
| **Server state**        | The product list, the user profile       | The server (you hold a copy) | A data-fetching layer with caching, see [data fetching](/frontend/data-fetching) |
| **URL state**           | Search query, page number, selected tab  | The address bar              | The URL itself                                                                   |

Ask first "who owns the truth?" and the home follows.

## Start local, lift only when needed

Keep state as close as possible to where it is used. This is called **colocation**. A value only one component reads should never be global. Move it up only when a second component truly needs it.

```svelte bad title="A global store for state only one component uses"
<script lang="ts">
	import { appStore } from '$lib/store';
</script>

<button onclick={() => (appStore.menuOpen = !appStore.menuOpen)}>Menu</button>
```

Why this hurts: `menuOpen` is now visible to the whole app, anyone can change it, and you cannot tell which parts of the screen depend on it. In React, a global value that changes often also re-renders every consumer.

```svelte good title="Local state, owned by the one component that needs it"
<script lang="ts">
	let open = $state(false);
</script>

<button onclick={() => (open = !open)}>Menu</button>
```

In Svelte, `$state` declares a reactive variable. React uses `useState`, Vue uses `ref`.

## Do not store what you can compute

**Derived state** means a value that can be calculated from other state. Storing it separately creates two sources of truth that drift apart.

```ts bad title="Duplicated state that must be kept in sync by hand"
let items: { price: number; qty: number }[] = [];
let total = 0; // must be updated in every place items change

function addItem(i: { price: number; qty: number }) {
	items.push(i);
	total += i.price * i.qty; // forget this line once and the total is wrong
}
```

```ts good title="One source of truth, everything else computed"
type Line = { price: number; qty: number };
export const totalOf = (items: Line[]) => items.reduce((sum, i) => sum + i.price * i.qty, 0);
```

In a Svelte component you would write `let total = $derived(totalOf(items))`; React computes it during render, Vue uses `computed`. The total can never be stale because it is not stored.

## Shared client state: a small module

When two distant components need the same client-side value, put it in a module that owns the data and exposes functions to change it.

```ts good title="cart.svelte.ts"
export type CartLine = { productId: number; qty: number };

let lines = $state<CartLine[]>([]);

export const cart = {
	get lines() {
		return lines;
	},
	get count() {
		return lines.reduce((n, l) => n + l.qty, 0);
	},
	add(productId: number) {
		const line = lines.find((l) => l.productId === productId);
		if (line) line.qty += 1;
		else lines.push({ productId, qty: 1 });
	}
};
```

Others call `cart.add(7)` instead of editing the array, so every change goes through one place. This is the same idea as "events up" on the [components page](/frontend/components).

A warning for server rendering: a module-level variable like this lives once per _server process_, so on the server it is shared between all users. Keep per-user state out of module scope there; the SvelteKit docs on state management explain this, and in SvelteKit you would use context or the URL instead.

## Server state is not client state

A list fetched from an API is a _cache of someone else's data_. It can go stale, needs reloading, and may fail. Copying it into your own store makes you responsible for all of that by hand.

```ts bad title="Server data copied into a global store"
// Every page must remember to call this, and to refresh it
let products: Product[] = [];
export async function loadProducts() {
	products = await (await fetch('/api/products')).json();
}
```

Use a layer built for it (SvelteKit `load` functions, TanStack Query, SWR). It handles caching, refetching and loading flags for you.

## URL state: free sharing and a working back button

Filters, search text and pagination belong in the URL. The user can bookmark and share the page, the back button works, and a refresh keeps their place.

```ts good title="Read and write filters through the URL"
export function withFilter(url: URL, key: string, value: string): string {
	const next = new URL(url);
	if (value) next.searchParams.set(key, value);
	else next.searchParams.delete(key);
	return next.pathname + next.search;
}
```

## When NOT to add a state library

Most apps need less than they think: local state, the URL and a data layer cover the majority. Reach for a dedicated store only when many unrelated components share complex client state and the module approach above becomes awkward.

> Key takeaway: decide who owns the truth. Local first, the URL for anything shareable, a data layer for server data, and a small module for the rest.

## Checklist

- For each piece of state, can you name its owner (component, browser, server, URL)?
- Is each value stored in exactly one place, with the rest computed?
- Is server data handled by a caching layer rather than copied into a store?
- Would a user expect a filter or tab to survive a refresh? Then it is in the URL.
- Is per-user state kept out of module scope on the server?
