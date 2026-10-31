---
sources:
  - title: Inversion of Control Containers and the Dependency Injection pattern
    url: https://martinfowler.com/articles/injection.html
    publisher: Martin Fowler
  - title: Mocks Aren't Stubs
    url: https://martinfowler.com/articles/mocksArentStubs.html
    publisher: Martin Fowler
  - title: Hexagonal architecture (ports and adapters)
    url: https://alistair.cockburn.us/hexagonal-architecture/
    publisher: Alistair Cockburn
  - title: The Twelve-Factor App, Backing services
    url: https://12factor.net/backing-services
    publisher: 12factor.net
---

## The problem: code that creates its own tools

A **dependency** is anything your code needs in order to do its job: a database connection, an email sender, the current clock, a payment API. There are two ways to get one. You can reach out and grab it (import a global), or you can be handed it.

```ts bad title="The service grabs its own dependencies"
import { pool } from './db';
import { sendEmail } from './mailer';

export async function registerUser(email: string) {
	const { rows } = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
	if (rows.length > 0) throw new Error('Email already registered');
	const created = await pool.query('INSERT INTO users (email) VALUES ($1) RETURNING id', [email]);
	await sendEmail(email, 'Welcome!');
	return created.rows[0].id;
}
```

This looks innocent, but to test "registering the same email twice is rejected" you now need a running database, and the test would send a real welcome email. People work around it with module-mocking tricks that depend on how the test runner rewrites imports. Those tricks break when you rename or move a file, and they hide what the code really depends on.

The FE analogy: a component that calls `fetch('/api/user')` directly is hard to test; a component that receives the data (or a `fetchUser` function) as a prop is easy.

## The fix: ask for dependencies as parameters

**Dependency injection** (DI) is a fancy name for a simple move: instead of importing your dependencies, receive them from the caller. No framework, no decorators.

```ts good title="user.service.ts: dependencies come in through a factory function"
export interface UserStore {
	existsByEmail(email: string): Promise<boolean>;
	insert(email: string): Promise<string>;
}
export interface Mailer {
	send(to: string, subject: string): Promise<void>;
}

export function createUserService(deps: { users: UserStore; mailer: Mailer }) {
	return {
		async register(email: string): Promise<string> {
			if (await deps.users.existsByEmail(email))
				throw new ConflictError('Email already registered');
			const id = await deps.users.insert(email);
			await deps.mailer.send(email, 'Welcome!');
			return id;
		}
	};
}
```

The service now says exactly what it needs, as two small interfaces. It does not know whether the store is Postgres, SQLite or an array.

### The test becomes trivial

```ts good title="user.service.test.ts: fakes instead of a database and a mail server"
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('rejects an email that is already registered', async () => {
	const sent: string[] = [];
	const service = createUserService({
		users: { existsByEmail: async () => true, insert: async () => 'u1' },
		mailer: { send: async (to) => void sent.push(to) }
	});

	await assert.rejects(() => service.register('a@example.com'), ConflictError);
	assert.equal(sent.length, 0); // no welcome email for a rejected signup
});
```

This runs in milliseconds, needs nothing installed, and fails only when the rule breaks. These hand-written stand-ins are called **fakes** (working but simplified versions) or **stubs** (return canned answers). A **mock** is a stand-in that also records how it was called so you can assert on it. Fakes are usually less brittle than mocks, because they test the outcome rather than the exact sequence of calls.

## Wiring it together: the composition root

Someone has to create the real objects and pass them in. Do this in **one place**, at program start, called the **composition root**.

```ts title="main.ts: the only file that knows which real implementations are used"
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const users: UserStore = {
	existsByEmail: async (email) =>
		(await pool.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount! > 0,
	insert: async (email) =>
		(await pool.query('INSERT INTO users (email) VALUES ($1) RETURNING id', [email])).rows[0].id
};
const mailer: Mailer = new SmtpMailer(process.env.SMTP_URL!);

const userService = createUserService({ users, mailer });
registerUserRoutes(app, userService);
```

Everything else just receives what it needs. Swapping the mail provider, or running with an in-memory store in local development, is a one-file change. The twelve-factor guideline of treating databases and mail services as "attached resources" that you can swap through configuration is the same idea at deployment level.

## Design tips

- **Define the interface from the consumer's side.** `UserStore` has only the two methods the service uses, not every method the database client offers. Small interfaces make fakes short.
- **Inject the nondeterministic things too**: the clock and random IDs. A rule like "links expire after 24 hours" is untestable if the code calls `new Date()` itself.

```ts good title="Injecting the clock makes time-based rules testable"
export function createInviteService(deps: { now: () => Date; invites: InviteStore }) {
	return {
		async isValid(token: string): Promise<boolean> {
			const invite = await deps.invites.find(token);
			return !!invite && deps.now().getTime() < invite.expiresAt.getTime();
		}
	};
}
// In a test: now: () => new Date('2030-01-01T00:00:00Z')
```

- **Inject, do not construct, inside the business layer.** `new SmtpMailer()` belongs in the composition root, not in the service.

## Trade-offs and when NOT to do this

- **Not everything needs injecting.** Pure functions (`calculateTotal`, a date formatter) have no dependencies; just import and call them. Injecting a logger or a library like `lodash` adds ceremony for no benefit.
- **DI containers and decorators (NestJS, tsyringe, InversifyJS) are optional.** They automate the wiring and are useful in big codebases with many services, but they add magic and a learning curve. Start with factory functions as above; adopt a container when manual wiring in `main.ts` genuinely hurts.
- **Do not create an interface for every class "just in case".** One interface with one implementation and no test that needs a fake is noise. Introduce it at boundaries that touch the outside world (database, network, time) or where you need a fake.
- **Fakes can lie.** A fake store that does not enforce a unique constraint will let a bug through that the real database would catch. Cover repositories with a few tests against a real database; see the [testing strategy](/common/testing-strategy).

> Key takeaway: dependency injection means "do not create your tools, ask for them". Its biggest payoff is not flexibility, it is cheap, fast tests.

## Checklist

- Do your services receive their database, mailer, clock and HTTP clients as parameters rather than importing them?
- Is there exactly one place (the composition root) that builds real implementations?
- Can your main business rules be tested with no network, no database and no real time?
- Are your interfaces small and defined by what the consumer needs?
- Did you avoid a DI framework until manual wiring became a real problem?
