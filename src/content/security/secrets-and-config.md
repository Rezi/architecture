---
sources:
  - title: Secrets Management Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
    publisher: OWASP
  - title: 'The Twelve-Factor App: III. Config'
    url: https://12factor.net/config
    publisher: 12factor.net
  - title: 'Modules: $env/static/private'
    url: https://svelte.dev/docs/kit/$env-static-private
    publisher: SvelteKit docs
  - title: 'Modules: $env/static/public'
    url: https://svelte.dev/docs/kit/$env-static-public
    publisher: SvelteKit docs
---

## What counts as a secret

A **secret** is any value that grants access if someone else learns it: database passwords, API keys for paid services, signing keys for tokens, webhook signing secrets, cloud credentials. **Config** is everything else that differs between environments (API base URL, feature flags). The twelve-factor methodology says config belongs in the environment, not in code, so one build can run in dev, staging and production.

The key FE-specific fact: **anything shipped to the browser is public.** Minified is not hidden. Anyone can open DevTools and read your bundle.

## The problem: secrets in the repo and in the bundle

```ts bad title="Hard-coded key, committed to git"
// src/lib/stripe.ts
export const stripe = new Stripe('sk_live_51Hxxxxxxxxxxxxxxxxxxxx');
```

How this goes wrong, step by step:

1. The key is committed. Git history is permanent: deleting the line later does not remove it from old commits.
2. The repo is cloned by every developer, CI runner and (maybe) a public mirror.
3. Automated scanners crawl public repositories for key patterns within minutes of a push.
4. The attacker uses the key to charge, read customers or run up a cloud bill.

The frontend version of the same mistake:

```ts bad title="Server secret exposed to the browser via a PUBLIC_ variable"
// .env contains: PUBLIC_OPENAI_KEY=sk-...
import { PUBLIC_OPENAI_KEY } from '$env/static/public';

const res = await fetch('https://api.openai.com/v1/chat/completions', {
	headers: { Authorization: `Bearer ${PUBLIC_OPENAI_KEY}` }
});
```

In SvelteKit, only variables starting with `PUBLIC_` can be imported by client code, and they are inlined into the bundle on purpose. Vite-based tools work the same way with the `VITE_` prefix. The prefix is a loud label meaning "this will be shown to every visitor". Putting a real secret behind it publishes it.

## The fix: secrets stay on the server

```ts good title="src/routes/api/chat/+server.ts: server-only import"
import { OPENAI_API_KEY } from '$env/static/private';
import { error, json } from '@sveltejs/kit';

export async function POST({ request, locals }) {
	if (!locals.user) throw error(401);
	const { prompt } = await request.json();
	const res = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'content-type': 'application/json' },
		body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] })
	});
	return json(await res.json());
}
```

Why it works: SvelteKit refuses to build if `$env/static/private` (or `$env/dynamic/private`) is imported from code that reaches the browser, so the leak becomes a build error instead of a production incident. The browser calls _your_ endpoint, which holds the key and can apply your own limits and [authorization](/security/authorization).

The two flavours:

| Module                                      | Resolved                          | Use when                                                |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| `$env/static/private`                       | At build time, inlined            | Value is known when you build; allows dead code removal |
| `$env/dynamic/private`                      | At runtime, read from the process | Same build image runs in several environments           |
| `$env/static/public`, `$env/dynamic/public` | Visible to everyone               | Non-secret config such as `PUBLIC_API_URL`              |

Note that a static private value is still baked into the _server_ build output, so do not publish server build artifacts.

## Backend: validate config at startup

Missing config should crash the process on boot, not fail halfway through a request.

```ts good title="config.ts: fail fast, one place that reads process.env"
function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var ${name}`);
	return value;
}

export const config = {
	databaseUrl: required('DATABASE_URL'),
	jwtSecret: required('JWT_SECRET'),
	port: Number(process.env.PORT ?? 3000)
} as const;
```

Reading `process.env` from one module also keeps the rest of the code easy to test (see [dependency injection](/backend/dependency-injection)).

## Where the values live

```bash title=".gitignore and a safe template"
# .gitignore
.env
.env.*
!.env.example

# .env.example (committed: names only, no real values)
DATABASE_URL=
JWT_SECRET=
PUBLIC_API_URL=https://api.example.com
```

- **Local development:** an untracked `.env` file, with separate throwaway keys that are not production keys.
- **CI/CD:** the platform's secret store, injected as environment variables, masked in logs.
- **Production:** a secrets manager (cloud provider's, HashiCorp Vault, etc.) or the platform's encrypted variables. Prefer it when you need **rotation** (replacing a secret on a schedule or after a leak), audit logs, or per-service access.

Trade-off: environment variables are simple and good enough for many teams, but they can leak through crash dumps, debug endpoints and child processes. A secrets manager adds operational cost; adopt it when the number of secrets or the audit requirements justify it.

## If a secret leaks

1. **Revoke and rotate first.** Assume it is already compromised.
2. Then clean git history (tools like `git filter-repo`), knowing this does not undo exposure.
3. Check provider logs for use of the key.
4. Add a pre-commit or CI secret scanner so it is caught next time.

## Checklist

- No secret is in git, in a `PUBLIC_` variable, or in client code.
- `.env` is ignored; `.env.example` documents the names.
- The server validates required config on startup and fails fast.
- Each environment has its own credentials with least privilege.
- You know how to rotate each secret, and a scanner runs in CI.
