---
sources:
  - title: Thinking in React
    url: https://react.dev/learn/thinking-in-react
    publisher: react.dev
  - title: Passing props to a component
    url: https://svelte.dev/docs/svelte/$props
    publisher: Svelte docs
  - title: Snippets
    url: https://svelte.dev/docs/svelte/snippet
    publisher: Svelte docs
  - title: Props
    url: https://vuejs.org/guide/components/props.html
    publisher: Vue.js docs
  - title: Presentation Domain Data Layering
    url: https://martinfowler.com/bliki/PresentationDomainDataLayering.html
    publisher: Martin Fowler
---

## The problem: components that do everything

A component is a unit of UI you can reuse and reason about on its own. It stays that way only if it has a clear job and a clear interface. The usual failure is the "god component": it fetches data, holds state, formats it, renders it and handles every click. It cannot be reused, is painful to test, and every change risks breaking something unrelated.

Good component design comes down to three habits: **composition** over configuration, **props down, events up**, and **separating data-aware from display-only components**.

## Props down, events up

Data flows into a component through **props** (inputs the parent passes). Changes flow out through **events or callbacks** (the child announces "something happened" and the parent decides what to do). This is called one-way data flow, and its benefit is predictability: to find out why a value changed, you only look at its owner.

```svelte bad title="Child mutates data it does not own"
<script lang="ts">
	let { cart } = $props();
</script>

<button onclick={() => cart.items.push({ id: 1, qty: 1 })}>Add</button>
```

The child reaches into an object owned by someone else and changes it. Now the cart can change from any component that has a reference, and a bug means searching all of them. (Svelte even warns about mutating props for this reason.)

```svelte good title="Child reports, owner decides"
<script lang="ts">
	let { onadd }: { onadd: (productId: number) => void } = $props();
</script>

<button onclick={() => onadd(1)}>Add</button>
```

The owner implements `onadd` and is the only place that changes the cart. In React this is a callback prop (`onAdd`), in Vue an emitted event (`emit('add', id)`).

## Smart and presentational components

Split by _knowledge_:

- **Presentational** components know only how to display what they are given. No fetching, no global state. Easy to test and to reuse.
- **Container** (smart) components know where data comes from and wire it to presentational ones.

```ts good title="A presentational contract is just a type"
export type ProductCardProps = {
	name: string;
	priceCents: number;
	onadd: () => void;
};
// ProductCard renders these three things. It has never heard of the API.
```

```svelte good title="Container fetches, card displays"
<script lang="ts">
	import ProductCard from './ProductCard.svelte';
	import { addToCart } from '$lib/features/cart';
	let { product } = $props();
</script>

<ProductCard name={product.name} priceCents={product.price} onadd={() => addToCart(product.id)} />
```

Do not treat this as a law. In a small app a single component that fetches and renders is fine. Split when you want to reuse the display, test it without a network, or when the file grows past what you can read in one screen.

## Composition: slots and snippets instead of option flags

A common trap is a component that grows a new boolean for every use case.

```svelte bad title="Configuration explosion"
<Card
	title="Orders"
	showFooter
	footerButtonText="Save"
	footerButtonVariant="primary"
	showIcon
	iconName="box"
	iconPosition="left"
	collapsible
	defaultCollapsed
/>
```

Each flag is a promise the component must keep forever, and still the next team needs something the flags do not allow. Prefer **composition**: the component provides the frame and the caller provides the content. In Svelte 5 content is passed as **snippets** (named blocks of markup); Vue calls them slots, React uses `children` or render props.

```svelte good title="Card.svelte: the caller supplies the parts"
<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		header,
		children,
		footer
	}: {
		header: Snippet;
		children: Snippet;
		footer?: Snippet;
	} = $props();
</script>

<section class="card">
	<header>{@render header()}</header>
	{@render children()}
	{#if footer}<footer>{@render footer()}</footer>{/if}
</section>
```

Usage then reads naturally, and any markup fits: icons, buttons, even other components. Card never needs a new flag.

```ts good title="A union makes invalid combinations unrepresentable"
type ActionProps =
	| { kind: 'link'; href: string; label: string }
	| { kind: 'button'; onclick: () => void; label: string };
// { kind: 'link', onclick } is now a compile error, not a runtime surprise.
```

## Keep the interface small

- Name props by what they mean (`status`), not how they look (`redText`).
- Make invalid combinations impossible with types: a union such as `{ kind: 'link'; href: string } | { kind: 'button'; onclick: () => void }` beats two optional props that must not both be set.
- Avoid **prop drilling** (passing a value through five layers that do not use it) by composition first (pass the finished child down as a snippet), and by context or shared state only when composition does not fit. See [state management](/frontend/state-management).

## When NOT to abstract

- Do not extract a component after seeing one use. Wait for the second or third, then you can see what really varies.
- Do not build a generic "DataTable" with 40 props for three different tables. Copying 20 lines is often cheaper than the wrong abstraction.
- A component that is only used once and is 30 lines does not need its own file just for neatness.

> Key takeaway: each component owns its state, takes inputs as props, reports changes as events, and takes content as snippets or slots instead of flags.

## Checklist

- Can you describe each component's job in one sentence without the word "and"?
- Does data flow down through props and changes flow up through callbacks?
- Can the display part be rendered in a test with plain props and no network?
- Are you using snippets or slots where you were tempted to add a boolean prop?
- Are invalid prop combinations ruled out by the type?
