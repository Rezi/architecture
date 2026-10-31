---
sources:
  - title: OpenAPI Specification
    url: https://spec.openapis.org/oas/latest.html
    publisher: OpenAPI Initiative
  - title: Problem Details for HTTP APIs (RFC 9457)
    url: https://www.rfc-editor.org/rfc/rfc9457
    publisher: IETF
  - title: APIs as infrastructure, future-proofing Stripe with versioning
    url: https://stripe.com/blog/api-versioning
    publisher: Stripe
  - title: Tolerant Reader
    url: https://martinfowler.com/bliki/TolerantReader.html
    publisher: Martin Fowler
  - title: Zod documentation
    url: https://zod.dev
    publisher: Zod
---

## The problem: two teams guessing at each other

The frontend and backend are separate programs that only meet over HTTP. If the shape of that conversation lives in two heads, it will drift: the backend renames `price` to `priceCents`, the FE keeps reading `price`, and the page shows `NaN` in production. TypeScript cannot save you, because the type on the FE was only ever a _guess_ about JSON that arrives at runtime.

An **API contract** is the written, checkable agreement: which URLs exist, what goes in, what comes out, and which errors can occur. Why it is good: both sides can build in parallel, and a mismatch is found by a tool instead of by a user.

## Contract-first

**Contract-first** means you write the contract before the code, then both sides conform to it. The usual format is an **OpenAPI** document (a YAML or JSON description of endpoints and schemas).

```yaml title="openapi.yaml (excerpt)"
paths:
  /products/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Product' }
        '404':
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
components:
  schemas:
    Product:
      type: object
      required: [id, name, priceCents]
      properties:
        id: { type: string }
        name: { type: string }
        priceCents: { type: integer }
```

Types and clients can be generated from it, so the FE and BE cannot silently disagree. If a full spec feels heavy, a shared TypeScript package with schemas (next section) gives you most of the value in a monorepo.

## Types are not enough: validate at the boundary

```ts bad title="Trusting a cast"
type Product = { id: string; name: string; priceCents: number };

const product = (await (await fetch('/api/products/1')).json()) as Product;
// If the server sends { price: 12 }, product.priceCents is undefined.
// The compiler is happy; the UI renders NaN.
```

`as Product` only silences the compiler. Fix it by checking the data when it enters your program. A schema library such as Zod defines the shape once and gives you both the runtime check and the TypeScript type.

```ts good title="packages/contracts/product.ts: one schema, shared by FE and BE"
import { z } from 'zod';

export const ProductSchema = z.object({
	id: z.string(),
	name: z.string(),
	priceCents: z.number().int()
});
export type Product = z.infer<typeof ProductSchema>;
```

```ts good title="FE: parse what arrives"
import { ProductSchema } from '@acme/contracts/product';

export async function getProduct(id: string) {
	const res = await fetch(`/api/products/${id}`);
	if (!res.ok) throw await res.json();
	return ProductSchema.parse(await res.json()); // throws a clear error if the shape is wrong
}
```

The BE uses the same schema to validate **incoming** requests, which is also a security requirement (see [validation and errors](/backend/validation-and-errors)).

## One error shape

```ts bad title="Every endpoint invents its own errors"
res.status(400).send('bad'); // endpoint A: plain text
res.status(400).json({ error: 'Name too short' }); // endpoint B
res.status(422).json({ errors: [{ msg: '...' }] }); // endpoint C
```

The FE needs a special case per endpoint, and cannot show a message next to the right form field. Agree on one shape. RFC 9457 ("problem details") defines a standard one:

```ts good title="A single error shape, with a machine-readable code"
type Problem = {
	type: string; // e.g. 'https://example.com/problems/validation'
	title: string; // short, human-readable
	status: number;
	code: string; // stable value the FE can switch on, e.g. 'NAME_TOO_SHORT'
	errors?: { field: string; message: string }[];
};

res
	.status(422)
	.type('application/problem+json')
	.json({
		type: 'https://example.com/problems/validation',
		title: 'Validation failed',
		status: 422,
		code: 'VALIDATION_FAILED',
		errors: [{ field: 'name', message: 'At least 3 characters' }]
	} satisfies Problem);
```

The FE switches on `code`, never on the English text of `title`.

## Evolving without breaking people

A **breaking change** is one that makes existing clients fail. Web apps can be cached or open in old tabs; mobile apps can be months old. Rules of thumb:

| Change                                  | Safe?                                 |
| --------------------------------------- | ------------------------------------- |
| Add an optional response field          | Yes, if clients ignore unknown fields |
| Add a new endpoint                      | Yes                                   |
| Remove or rename a field                | No                                    |
| Change a field's type or meaning        | No                                    |
| Make an optional request field required | No                                    |

Be a **tolerant reader**: the client uses only the fields it needs and ignores the rest. For breaking changes, use the expand-and-contract path: add the new field, migrate clients, then remove the old field after you can see (in logs) that nobody uses it. Stripe's approach of dated API versions is the heavyweight option for public APIs.

## Idempotency in one paragraph

An operation is **idempotent** if doing it twice has the same effect as doing it once. A network retry of "charge the card" must not charge twice. The common fix is a client-generated key sent in a header (for example `Idempotency-Key`); the server stores the result per key and returns it again on repeats. Use it for any non-idempotent POST that costs money or sends messages.

## When NOT to go heavy

For one app with one team in one repository, a shared Zod package and the error shape above is enough. Full OpenAPI, versioning and generated SDKs pay off when there are several consumers you do not control.

## Checklist

- Is there one written source of truth for request and response shapes?
- Is incoming data validated at runtime on both sides, not just cast?
- Do all endpoints return errors in one shape with a stable `code`?
- Do you know which of your changes are breaking before you ship them?
- Do retried non-idempotent requests have a protection?
