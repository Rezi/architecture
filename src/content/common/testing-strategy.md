---
sources:
  - title: The Practical Test Pyramid
    url: https://martinfowler.com/articles/practical-test-pyramid.html
    publisher: Martin Fowler (Ham Vocke)
  - title: The Testing Trophy and Testing Classifications
    url: https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
    publisher: Kent C. Dodds
  - title: Guiding Principles
    url: https://testing-library.com/docs/guiding-principles/
    publisher: Testing Library
  - title: Mocks Aren't Stubs
    url: https://martinfowler.com/articles/mocksArentStubs.html
    publisher: Martin Fowler
  - title: Node.js test runner
    url: https://nodejs.org/api/test.html
    publisher: Node.js
---

## The problem: tests that cost more than they protect

Tests exist to let you change code without fear. Two failure modes ruin that:

- **Too few tests**, or only at the wrong level: every release is a gamble.
- **Too many of the wrong tests**: a suite of 2,000 tests that break on every refactor, take 25 minutes, and fail randomly. People stop trusting and then stop running them.

The goal is not "more tests" or a coverage number. It is _confidence per minute of maintenance_. A test is worth it if its failure tells you about a real bug and its upkeep is cheap.

## Test levels

| Level                | What runs                                                          | Speed        | Catches                                    |
| -------------------- | ------------------------------------------------------------------ | ------------ | ------------------------------------------ |
| **Unit**             | One function or module, in isolation                               | Milliseconds | Logic errors in rules                      |
| **Integration**      | Several parts together (handler + real DB, component + real store) | Seconds      | Wiring errors, SQL mistakes, serialisation |
| **End-to-end (E2E)** | Real browser against a running system                              | Slow         | Whole-journey breakage                     |

Fowler's **test pyramid**: many fast unit tests, fewer integration tests, very few E2E tests, because higher levels are slower and flakier. Kent C. Dodds' **testing trophy** argues for putting more weight on integration tests, since they resemble real use more. Both agree on the principle: the higher the level, the fewer tests, and the more each must justify itself.

## Test behaviour, not implementation

```ts bad title="Test coupled to internals"
test('adds item', () => {
	const cart = new Cart();
	const spy = vi.spyOn(cart as any, 'recalculate');
	cart.add({ id: 'a', priceCents: 500 });
	expect(spy).toHaveBeenCalledTimes(1); // how, not what
	expect((cart as any).items.length).toBe(1); // private state
});
```

Rename `recalculate` or store items in a Map and this test fails although the cart works perfectly. A refactor-breaking test punishes exactly the cleanup you want people to do.

```ts good title="Test the observable result"
test('adding an item increases the total', () => {
	const cart = new Cart();
	cart.add({ id: 'a', priceCents: 500 });
	cart.add({ id: 'b', priceCents: 250 });
	expect(cart.totalCents()).toBe(750);
});
```

The same on the UI, following Testing Library's principle "the more your tests resemble the way your software is used, the more confidence they give":

```ts bad title="Testing a component by its internals"
expect(wrapper.vm.isOpen).toBe(false);
expect(wrapper.find('.btn-3a').exists()).toBe(true);
```

```ts good title="Testing what the user sees (Testing Library; works for Svelte, React, Vue)"
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Dialog from './Dialog.svelte';

test('opens the dialog from the button', async () => {
	render(Dialog);
	await userEvent.click(screen.getByRole('button', { name: /settings/i }));
	expect(screen.getByRole('dialog')).toBeVisible();
});
```

Querying by role and name also nudges you toward accessible markup.

## Mocks: use sparingly

A **mock** or **fake** replaces a real dependency (database, HTTP) in a test. Useful, but each one is a lie about reality.

```ts bad title="Mock returns whatever makes the test pass"
vi.mock('./api', () => ({ getUser: () => ({ name: 'Ann' }) }));
// The real API now returns { fullName }. The test stays green, production breaks.
```

Guidance:

- Prefer **in-memory fakes** with real behaviour over per-test mock setups (see the `StockRepository` fake on the [layers page](/common/layering-and-boundaries)).
- Mock at the edge of your system (network, clock, e-mail), not between your own modules.
- For the FE-BE seam, test against the shared schema or a **contract test** (a test that both sides run against the same agreed shape, see [API contracts](/common/api-contracts)) so a mock cannot drift from the real server.
- Use a real database in integration tests (a throwaway container) for code that contains SQL; mocking the database proves nothing about your queries.

## A backend integration test

```ts good title="orders.test.ts: real HTTP handler, test database"
import test from 'node:test';
import assert from 'node:assert/strict';

test('POST /orders returns 409 when out of stock', async () => {
	await db.query("insert into items (id, stock) values ('a', 1)");

	const res = await fetch(`${baseUrl}/orders`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ itemId: 'a', qty: 2 })
	});

	assert.equal(res.status, 409);
	assert.equal((await res.json()).code, 'OUT_OF_STOCK');
});
```

This one test covers routing, validation, the rule, SQL and the error shape. That breadth is why a few such tests are very valuable.

## E2E tests: a handful, for the money paths

Write E2E tests (Playwright, Cypress) only for journeys whose failure is expensive: sign-up, login, checkout. Keep them few, give each independent data, and wait for conditions rather than fixed sleeps. **Flaky tests** (sometimes pass, sometimes fail with no code change) must be fixed or deleted quickly; a suite people re-run "until green" has stopped protecting you.

## What to test where

- Pure business rules, formatting, parsing: **unit tests**, plentiful.
- Handler plus database, component plus its real children: **integration tests**, the backbone.
- Login, checkout, payment: **E2E**, a few.
- Plain markup or one-line pass-through code: usually nothing.
- A bug found in production: **first write a test that reproduces it**, then fix.

## When NOT to chase numbers

100 percent coverage means every line ran, not that behaviour was checked; a test with no assertion raises coverage and proves nothing. Use coverage to find _untested areas_, not as a target. Low-risk code (a static page, a prototype you may delete) may deserve no tests at all.

## Checklist

- Does each test fail only when behaviour breaks, not when code is reorganised?
- Is most of the suite fast enough to run on every save or commit?
- Are mocks limited to system edges, with contracts or fakes that cannot drift?
- Are E2E tests limited to the few journeys that must never break?
- Is every production bug followed by a regression test?
- Do you fix or delete flaky tests immediately?
