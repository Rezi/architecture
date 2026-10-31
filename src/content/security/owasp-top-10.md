---
sources:
  - title: OWASP Top 10 Web Application Security Risks
    url: https://owasp.org/www-project-top-ten/
    publisher: OWASP
  - title: OWASP Cheat Sheet Series
    url: https://cheatsheetseries.owasp.org/
    publisher: OWASP
  - title: Web security
    url: https://developer.mozilla.org/en-US/docs/Web/Security
    publisher: MDN Web Docs
  - title: Web Security Academy
    url: https://portswigger.net/web-security
    publisher: PortSwigger
---

## What the list is

The **OWASP Top 10** is a regularly updated list of the most common and damaging categories of web application weakness, built from real vulnerability data and expert surveys by the Open Worldwide Application Security Project (OWASP), a non-profit. It is an awareness tool, not a complete checklist: a category is a family of problems, not a single bug.

This page follows the 2025 edition. The order and names change between editions (the 2021 edition, for example, had Server-Side Request Forgery as its own entry; in 2025 it is folded into access control), so check [owasp.org/Top10](https://owasp.org/www-project-top-ten/) for the current list before quoting numbers.

## The ten categories for a web developer

| #   | Category                               | What it means in practice                                                                                                | Read more                                                                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| A01 | Broken Access Control                  | A user can read or change things they should not: another user's order, an admin endpoint. The most common serious flaw. | [Authorization](/security/authorization)                                                            |
| A02 | Security Misconfiguration              | Defaults left on, debug mode in production, missing headers, open cloud buckets, verbose errors.                         | [Headers](/security/transport-and-headers), [secrets and config](/security/secrets-and-config)      |
| A03 | Software Supply Chain Failures         | A dependency, build tool or CI pipeline you trust is compromised or outdated.                                            | [Supply chain](/security/supply-chain)                                                              |
| A04 | Cryptographic Failures                 | Sensitive data sent or stored unprotected, weak algorithms, homemade crypto.                                             | [Transport](/security/transport-and-headers), [authentication](/security/authentication)            |
| A05 | Injection                              | Untrusted input is run as code or a query: SQL injection, and cross-site scripting (XSS).                                | [Injection and XSS](/security/injection-and-xss)                                                    |
| A06 | Insecure Design                        | The flaw is in the plan, not the code: no rate limit on password reset, a business rule that can be abused.              | [Principles](/security/principles)                                                                  |
| A07 | Authentication Failures                | Weak passwords allowed, no brute-force protection, broken sessions, predictable tokens.                                  | [Authentication](/security/authentication)                                                          |
| A08 | Software or Data Integrity Failures    | Code or data accepted without checking it is genuine: unsigned updates, scripts from a CDN with no integrity check.      | [Supply chain](/security/supply-chain)                                                              |
| A09 | Security Logging and Alerting Failures | Attacks happen and nobody notices because nothing was logged or alerted.                                                 | [Observability](/common/observability)                                                              |
| A10 | Mishandling of Exceptional Conditions  | Errors that fail open, leak internals, or leave the system in a bad state.                                               | [Error handling](/frontend/error-handling), [validation and errors](/backend/validation-and-errors) |

## Where the FE developer is on the hook

Not every category is "backend". Mapping ownership:

| Category         | Browser side                               | Server side                 |
| ---------------- | ------------------------------------------ | --------------------------- |
| Access control   | Hide UI for UX only                        | Enforce on every request    |
| Injection        | Do not render untrusted HTML; avoid `eval` | Parameterised queries       |
| Misconfiguration | Build config, no secrets in bundle         | Headers, CORS, error output |
| Supply chain     | `npm` dependencies ship to every user      | Server dependencies, CI     |
| Logging          | Report client errors                       | Audit log, alerting         |

## Bad and good: one vulnerability, three categories

A single flawed endpoint often touches several categories at once.

```ts bad title="A01 + A05 + A10 in one handler"
app.get('/api/invoices/:id', async (req, res) => {
	try {
		const rows = await db.query(`SELECT * FROM invoices WHERE id = ${req.params.id}`); // A05
		res.json(rows.rows[0]); // A01: no check that this invoice belongs to the caller
	} catch (e) {
		res.status(500).send(String(e)); // A10: leaks SQL and table names
	}
});
```

An attacker logged in as themselves requests `/api/invoices/1`, `/2`, `/3` and reads other customers' invoices (A01). Sending `1 OR 1=1` changes the query (A05). A malformed id returns a database error that reveals the schema (A10).

```ts good title="Scoped, parameterised, quiet errors"
app.get('/api/invoices/:id', requireUser, async (req, res) => {
	const id = z.string().uuid().safeParse(req.params.id);
	if (!id.success) return res.status(404).json({ error: 'not_found' });
	try {
		const { rows } = await db.query(
			'SELECT id, total_cents, issued_at FROM invoices WHERE id = $1 AND owner_id = $2',
			[id.data, req.user.id]
		);
		if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
		res.json(rows[0]);
	} catch (err) {
		logger.error({ err, route: 'invoice' }); // A09: kept server-side for the team
		res.status(500).json({ error: 'internal' });
	}
});
```

Each fix is small, but each belongs to a different category. That is why the list is a map of _where to look_, not a task list.

## Trade-offs and limits

- Passing a scanner or "fixing the Top 10" does not make an app secure. The list ignores risks specific to your product, such as business-logic abuse.
- Rankings are based on data that skews towards what tools can find. Insecure design is hard to detect automatically but costly.
- Do not treat the list as dogma: use it to structure code reviews and threat models ([principles](/security/principles)), then add your own risks.

## Checklist

- Can you name the category of each bug your team fixed this quarter?
- Is there at least one automated or reviewed control per category (tests, linters, dependency audit, logging)?
- Does code review ask "who is allowed to call this?" for every new endpoint?
- Do you know which of the ten are mainly the frontend's job in your project?
