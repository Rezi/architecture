---
sources:
  - title: Project structure
    url: https://svelte.dev/docs/kit/project-structure
    publisher: Svelte / SvelteKit docs
  - title: Presentation Domain Data Layering
    url: https://martinfowler.com/bliki/PresentationDomainDataLayering.html
    publisher: Martin Fowler
  - title: State Colocation will make your React app faster
    url: https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster
    publisher: Kent C. Dodds
  - title: Yagni (You Aren't Gonna Need It)
    url: https://martinfowler.com/bliki/Yagni.html
    publisher: Martin Fowler
---

## The problem: where does this file go?

Every new file forces a small decision: where should it live? If the answer is unclear, different developers decide differently, and within a year nobody can find anything. A project structure is a **shared answer to "where does this go, and where do I look for it?"**

The structure is architecture in the sense of the [definition page](/common/what-is-architecture): moving folders is cheap on day one and painful at 500 files, because every import path changes and every pull request conflicts.

## Two ways to group files

**Type folders** group by what a file _is_:

```text bad title="Grouped by type: one feature is scattered across the tree"
src/
  components/   CartItem.svelte  ProductCard.svelte  LoginForm.svelte
  stores/       cart.ts  user.ts
  api/          cart.ts  products.ts  auth.ts
  utils/        formatPrice.ts  validateEmail.ts  cartTotal.ts
  types/        cart.ts  product.ts  user.ts
```

To change "the cart" you open five folders. Deleting the cart feature means hunting for leftovers. Worse, nothing tells you which files are used only by the cart and which are shared, so `utils/` slowly becomes a dumping ground that everything imports.

**Feature folders** group by what the code is _for_:

```text good title="Grouped by feature: change one thing, touch one folder"
src/
  features/
    cart/       CartItem.svelte  cart.svelte.ts  cartApi.ts  cartTotal.ts  index.ts
    products/   ProductCard.svelte  productsApi.ts  index.ts
    auth/       LoginForm.svelte  authApi.ts  index.ts
  shared/       Button.svelte  formatPrice.ts  http.ts
```

This follows a general rule called **colocation**: keep things that change together close together. When you change how the cart works, the component, state, API call and tests are all in one folder.

## Give each feature a public surface

Folders alone are not enough. If any file can import any other file, the folders are decoration. The fix is a **public surface** (also called a barrel or entry point): one `index.ts` per feature that exports only what other features may use.

```ts good title="features/cart/index.ts"
// Public surface of the cart feature. Everything else is private.
export { default as CartButton } from './CartButton.svelte';
export { cartCount } from './cart.svelte';
export type { CartItem } from './types';
```

```ts bad title="Reaching into another feature's internals"
// features/checkout/Summary.svelte (script)
import { calcDiscount } from '../cart/internal/discounts';
```

The bad import couples checkout to a private detail. When the cart team renames `discounts.ts`, checkout breaks, and nobody knew they depended on it. Importing only from `../cart` (the index) makes the dependency visible and lets the cart team change its insides freely.

You can enforce this instead of hoping: an ESLint rule such as `no-restricted-imports` with a pattern like `features/*/*` blocks deep imports. A rule that tooling enforces survives staff changes; a rule in a wiki does not.

## Dependencies point one way

A tidy tree still fails if imports form a web. Use a simple direction:

```text
routes / pages  ->  features  ->  shared
```

- `shared` knows nothing about features (a `Button` must not import the cart).
- A feature may use `shared`, but should avoid importing another feature's internals.
- Pages assemble features; features do not know which page hosts them.

If feature A and feature B need each other, that is a signal. Either they are really one feature, or the shared piece belongs in `shared`. This is the same idea as the [layers and boundaries](/common/layering-and-boundaries) page, applied to folders.

## In SvelteKit

SvelteKit already fixes some places for you: `src/routes` for pages and endpoints, `src/lib` for reusable code (imported as `$lib`), and `src/lib/server` for code that must never reach the browser; SvelteKit refuses to bundle it into client code. A common layout:

```text
src/
  routes/            thin: load data, compose features
  lib/
    features/        cart, products, auth ...
    shared/          ui primitives, http client, formatters
    server/          database, secrets (server only)
```

In React or Vue the idea is identical; only the file extensions change. `index.ts` public surfaces work the same everywhere.

## When NOT to do this

- **Tiny apps.** Under about 20 files, type folders are fine. Feature folders with barrels for a to-do list are overhead (see YAGNI).
- **Barrels can hurt.** Re-exporting everything from one `index.ts` can make bundlers and test runners load more than needed, and can create circular imports. Keep them small and explicit, as in the example above, and avoid `export *` chains.
- **Do not split too early.** Start with a feature folder when the second file for a feature appears, and promote code to `shared` only when a _second_ feature needs it. Premature sharing creates generic code that fits nobody.

> Key takeaway: group by feature, expose a small public surface, and keep imports flowing in one direction. Enforce it with a lint rule.

## Checklist

- Can a new developer find "everything about the cart" in one folder?
- Does each feature have an `index.ts` that lists what others may use?
- Is deep importing into another feature blocked by a lint rule?
- Does `shared` avoid importing from features?
- Did code move to `shared` only after a second real user appeared?
