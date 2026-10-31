---
sources:
  - title: Software Architecture Guide
    url: https://martinfowler.com/architecture/
    publisher: Martin Fowler
  - title: Architecture Decision Record
    url: https://martinfowler.com/bliki/ArchitectureDecisionRecord.html
    publisher: Martin Fowler
  - title: Documenting Architecture Decisions
    url: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
    publisher: Michael Nygard, Cognitect
  - title: Yagni (You Aren't Gonna Need It)
    url: https://martinfowler.com/bliki/Yagni.html
    publisher: Martin Fowler
  - title: ISO/IEC 25010 product quality model
    url: https://iso25000.com/index.php/en/iso-25000-standards/iso-25010
    publisher: ISO 25000
---

## The working definition

Software architecture is the set of **decisions that are expensive to change later**. That is all. It is not a diagram, not a job title, and not a particular style such as "microservices".

Martin Fowler's often-quoted version is "the important stuff, whatever that is". What counts as important depends on the project, but you can recognise it by one test: _if we got this wrong, how painful would it be to fix?_

| Decision                                                         | Cost to change later |
| ---------------------------------------------------------------- | -------------------- |
| Name of a button                                                 | Minutes              |
| Which CSS approach a component uses                              | Hours                |
| How the frontend gets its data (REST, GraphQL, server rendering) | Weeks                |
| Which database holds the source of truth                         | Months               |
| Whether users' data is split per tenant                          | Possibly a rewrite   |

Spend your design effort at the bottom of that table, and be relaxed at the top.

## Quality attributes: what "good" means

"Good architecture" is meaningless until you say _good for what_. The usual answer is a short list of **quality attributes** (sometimes called non-functional requirements). The ISO 25010 standard lists them; these are the ones you will argue about most:

- **Performance**: how fast it responds, and how much it can handle.
- **Security**: who can do what, and how well data is protected.
- **Reliability**: does it keep working when parts fail?
- **Maintainability**: how quickly can a new person change it safely?
- **Usability and accessibility**: can everyone actually use it?
- **Cost**: build cost, running cost, and the cost of the team's time.

The key insight is that **they conflict**. You cannot maximise all of them at once.

- Aggressive caching improves performance but hurts _freshness_ (users may see old data).
- Strong validation and encryption improve security but add latency and code.
- Splitting into many services improves independent deployment but hurts simplicity and debuggability.

Architecture is choosing which attribute wins in which place, on purpose.

## A concrete trade-off

Imagine a product list page. Two options for loading it:

```ts title="Option A: always ask the server"
async function loadProducts(): Promise<Product[]> {
	const res = await fetch('/api/products');
	return res.json();
}
// + always fresh
// - every visit pays a network round trip; the page is blank while waiting
```

```ts title="Option B: show cached data, refresh in the background"
const cache = new Map<string, Product[]>();

async function loadProducts(onUpdate: (p: Product[]) => void): Promise<Product[]> {
	const cached = cache.get('products');
	// Refresh in the background; update the UI when it arrives.
	const fresh = fetch('/api/products')
		.then((r) => r.json() as Promise<Product[]>)
		.then((p) => {
			cache.set('products', p);
			onUpdate(p);
			return p;
		});
	return cached ?? fresh;
}
// + instant on repeat visits
// - the user may briefly see an outdated price
```

Neither is "right". For a blog, Option B is a great default. For a checkout total, showing a stale price is a bug, so you would choose A. The decision follows from the quality attribute that matters in that place. This is architectural thinking, even though it is only twenty lines.

## Write decisions down: ADRs

Teams forget _why_ things were decided, and then either cargo-cult the decision or reverse it without understanding the original constraint. An **Architecture Decision Record (ADR)** is a short text file, one per decision, kept in the repository (for example `docs/adr/0007-use-postgres.md`).

```md title="docs/adr/0007-use-server-side-rendering.md"
# 7. Render public pages on the server

Status: accepted (2026-03-02)

## Context

Marketing pages must rank in search and show content within 2 seconds on slow phones.
The team already knows TypeScript but has no Node ops experience.

## Decision

Use SvelteKit with server-side rendering for public pages, client-side rendering for the dashboard.

## Consequences

- Faster first paint, content visible to crawlers.

* We need a Node runtime in production instead of only static hosting.
* Dashboard and public pages now use two rendering modes; document which route uses which.
```

Notice what a good ADR contains: the **context** (constraints at the time), the **decision**, and the **consequences including the downsides**. A record with no downsides is advertising, not engineering.

## Bad habits to avoid

```ts bad title="Designing for imaginary futures"
// "We might switch databases / add plugins / support 50 payment providers someday."
interface PaymentProviderFactoryRegistry {
	register(name: string, factory: AbstractPaymentProviderFactory): void;
}
// There is exactly one payment provider, and it is Stripe.
```

This is the opposite failure to ignoring architecture: building flexibility nobody asked for, which makes everyday changes harder. The principle that counters it is **YAGNI** ("you aren't gonna need it"). The balance is: _keep options open cheaply_ (clear boundaries, covered on the [layers page](/common/layering-and-boundaries)) _but do not build the options until you need them_.

```ts good title="Simple now, with a boundary that keeps change cheap"
export async function charge(amountCents: number, customerId: string) {
	return stripe.paymentIntents.create({
		amount: amountCents,
		currency: 'eur',
		customer: customerId
	});
}
// Only this one file knows about Stripe. Switching later means editing one file.
```

## Checklist

- Can you name the two or three quality attributes that matter most for this product?
- For each hard-to-change decision, do you know the alternatives and why you did not pick them?
- Are the decisions written down where the next developer will find them?
- Are you building anything "for the future" that no current requirement needs?
