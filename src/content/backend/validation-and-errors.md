---
sources:
  - title: 'RFC 9457: Problem Details for HTTP APIs'
    url: https://www.rfc-editor.org/rfc/rfc9457.html
    publisher: IETF
  - title: Input Validation Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
    publisher: OWASP
  - title: Error Handling Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
    publisher: OWASP
  - title: "Parse, don't validate"
    url: https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/
    publisher: Alexis King
  - title: Zod documentation
    url: https://zod.dev/
    publisher: Zod
---

## The problem: the client is not under your control

Your frontend validates forms, so the backend can relax, right? No. Anyone can call your API with `curl`, a script, or a modified browser request. The FE validation exists for the user's convenience; the BE validation exists for **correctness and security**. Treat every byte that crosses the network boundary as hostile or at least wrong until proven otherwise. In TypeScript this is doubly important: `req.body` is typed `any`, so the compiler will happily let you trust it.

## Validate once, at the boundary

The **boundary** is the place where outside data enters your program: the HTTP handler, a queue message, an environment variable, a webhook. Check it there, convert it into a trusted typed object, and everything inside can rely on it. The idea is often summarised as "parse, don't validate": do not just check and then keep passing the raw data around, produce a new value whose type proves it is valid.

```ts bad title="Trusting the body"
app.post('/users', async (req, res) => {
	const { email, age } = req.body; // typed any
	await pool.query('INSERT INTO users (email, age) VALUES ($1, $2)', [email, age]);
	res.status(201).end();
});
// Sending { "email": ["x"], "age": "abc" } causes a database error (a 500).
// Sending a 50 MB string for email is accepted. Extra fields slip through to code that spreads req.body.
```

```ts good title="Parse with a schema, reject early with a clear 422"
import { z } from 'zod';

const createUserSchema = z.object({
	email: z.string().trim().toLowerCase().email().max(254),
	age: z.number().int().min(13).max(120)
});
type CreateUserInput = z.infer<typeof createUserSchema>; // the TS type comes from the schema

app.post('/users', async (req, res) => {
	const result = createUserSchema.safeParse(req.body);
	if (!result.success) {
		return res
			.status(422)
			.type('application/problem+json')
			.json({
				type: 'https://api.example.com/problems/validation',
				title: 'Invalid request',
				status: 422,
				errors: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
			});
	}
	const input: CreateUserInput = result.data; // unknown fields stripped, types guaranteed
	await userService.register(input);
	res.status(201).end();
});
```

Why this is better: one schema gives you the runtime check **and** the TypeScript type, so they cannot drift apart. Unknown fields are dropped. The client gets a precise list of what is wrong instead of a generic failure. Libraries such as Zod, Valibot or Ajv with JSON Schema all do this; pick one and use it everywhere. If you share the schema with the frontend, the form and the API enforce the same rules (see [forms and validation](/frontend/forms-and-validation)), but the server still must run it itself.

### Two kinds of validation

| Kind             | Example                                                  | Where                             |
| ---------------- | -------------------------------------------------------- | --------------------------------- |
| Shape and format | Is `age` an integer from 13 to 120?                      | Boundary schema                   |
| Business rule    | Is this email already registered? Is there enough stock? | Service layer, using current data |

Do not push business rules into the schema; they need the database and belong in the [service layer](/backend/layered-architecture). And for rules that must hold even under simultaneous requests, back them with a database constraint (a UNIQUE index on email), because two requests can both pass a check-then-insert in your code.

## Model errors on purpose

Errors fall into two groups, and mixing them up causes most error-handling mess:

- **Expected errors** (the user typed a duplicate email, the product does not exist). These are part of normal operation. The caller can react to them.
- **Unexpected errors** (null pointer, database down, a bug). Nobody planned for them. The right response is to log everything and return a generic 500.

Give expected errors a type, throw them from the service, and translate them **in one place**.

```ts good title="errors.ts: domain errors carry meaning, not HTTP details"
export class AppError extends Error {
	constructor(
		public readonly code: string,
		public readonly status: number,
		message: string
	) {
		super(message);
	}
}
export class NotFoundError extends AppError {
	constructor(what: string) {
		super('not_found', 404, `${what} not found`);
	}
}
export class ConflictError extends AppError {
	constructor(message: string) {
		super('conflict', 409, message);
	}
}
```

```ts good title="One error handler turns errors into Problem Details responses"
import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
	if (err instanceof AppError) {
		return res
			.status(err.status)
			.type('application/problem+json')
			.json({
				type: `https://api.example.com/problems/${err.code}`,
				title: err.message,
				status: err.status,
				instance: req.originalUrl
			});
	}
	const errorId = crypto.randomUUID();
	logger.error({ err, errorId, path: req.originalUrl }); // full detail goes to the logs only
	res.status(500).type('application/problem+json').json({
		type: 'about:blank',
		title: 'Internal Server Error',
		status: 500,
		errorId // the user can quote this to support, and you can find the log line
	});
};
```

**Problem Details** (RFC 9457) is a standard JSON shape for HTTP errors: `type`, `title`, `status`, `detail`, `instance`, plus any extra fields you need. Using it means your frontend needs one error parser instead of one per endpoint, and the same shape works across teams. See [error handling in the frontend](/frontend/error-handling) for the consuming side.

Now the bad version, which is what most first drafts look like:

```ts bad title="Leaking internals, different shape on every route"
app.get('/orders/:id', async (req, res) => {
	try {
		const order = await orders.find(req.params.id);
		res.json(order);
	} catch (e) {
		res.status(500).json({ error: (e as Error).message });
		// "relation \"orders\" does not exist" or a connection string reaches the browser.
		// A missing order is also reported as 500, so monitoring cries wolf.
	}
});
```

Problems: internal messages reveal table names and library versions to attackers; "not found" and "database crashed" look identical to the client; every route reinvents the format. Note that Express 5 forwards rejected promises from async handlers to the error handler for you; on Express 4 you need a small wrapper or a package, otherwise an async error crashes the process or hangs the request.

## Exceptions or result values?

Throwing is simple and fine for most services. Some teams prefer returning a **result value** such as `{ ok: false, error }` so the compiler forces callers to handle each case. That is worth it for operations with several expected failure modes; for the rest, exceptions plus one central handler keep code shorter. Whichever you choose, be consistent, and never use exceptions for ordinary control flow in hot loops.

## Trade-offs and when NOT to do this

- Do not validate the same thing in three layers. Validate shape at the boundary, rules in the service, integrity in the database. Repeating shape checks everywhere is noise.
- Be strict about what you accept, but be careful with error detail: telling an attacker "no account with this email" on a login endpoint leaks which emails exist. See [authentication](/security/authentication).
- Field-level messages are for developers and form display; do not echo raw user input back into HTML (see [injection and XSS](/security/injection-and-xss)).

## Checklist

- Is every external input (body, query, params, headers, queue messages, env) parsed by a schema before use?
- Do you set maximum lengths and sizes, not only types?
- Do expected failures have their own error types, and is there exactly one place mapping errors to HTTP?
- Do 500 responses hide internals and include an ID that matches a log entry?
- Is the error response shape the same on every endpoint (Problem Details)?
