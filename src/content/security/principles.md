---
sources:
  - title: Threat Modeling Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
    publisher: OWASP
  - title: Threats - Microsoft Threat Modeling Tool (STRIDE)
    url: https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats
    publisher: Microsoft
  - title: OWASP Developer Guide
    url: https://owasp.org/www-project-developer-guide/
    publisher: OWASP
  - title: Web security
    url: https://developer.mozilla.org/en-US/docs/Web/Security
    publisher: MDN Web Docs
---

## Security is a property of the whole system

Security is not a feature you add at the end, and it is not something the "security person" does. It is a quality attribute (see [what is architecture](/common/what-is-architecture)) that every layer either supports or undermines. The system is only as strong as its weakest layer, and attackers choose which layer to hit.

The most important fact for a frontend developer:

> **Anything running in the browser is controlled by the user.** They can edit your JavaScript, skip your form, replay your requests with `curl`, and change any value in DevTools. Client-side checks are user experience. Only the server can enforce rules.

## Trust boundaries

A **trust boundary** is a line where data passes from a place you control to a place you do not, or the other way round. Everything that crosses into your server from outside (request body, query string, headers, cookies, uploaded files, webhooks, even data from your own frontend) is **untrusted input** until the server has checked it.

```text title="Where the boundaries are"
Browser (user controls it)  ==[ boundary 1 ]==>  API server (you control it)
API server                  ==[ boundary 2 ]==>  Database, other services
Third-party scripts / npm   ==[ boundary 3 ]==>  Your page (runs with your privileges)
```

Each boundary needs its own checks. Passing boundary 1 does not make data safe for boundary 2.

## Threat modelling in 30 minutes

A **threat model** is a structured answer to four questions: what are we building, what can go wrong, what will we do about it, and did we do a good job? You do not need a special tool; a whiteboard and the data flow of one feature is enough.

A handy checklist for "what can go wrong" is **STRIDE** (developed at Microsoft), six kinds of threat:

| Letter | Threat                 | Plain meaning                     | Typical defence                                                        |
| ------ | ---------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| S      | Spoofing               | Pretending to be someone else     | [Authentication](/security/authentication)                             |
| T      | Tampering              | Changing data you should not      | Validation, integrity checks, [authorization](/security/authorization) |
| R      | Repudiation            | Denying you did something         | Audit logs ([observability](/common/observability))                    |
| I      | Information disclosure | Reading data you should not       | Access control, encryption                                             |
| D      | Denial of service      | Making it unavailable             | Rate limits, quotas                                                    |
| E      | Elevation of privilege | Gaining rights you were not given | Server-side [authorization](/security/authorization)                   |

Example: a "change email" feature. Spoofing: someone with a stolen session changes the email, then resets the password. Tampering: the request contains a `userId` field they edit. Information disclosure: the error message says whether an email is already registered. Each finding becomes a concrete task, for example "require the current password to change email".

## Core principles

- **Least privilege**: give every user, service and token only the access it needs for its job and nothing more. If it is compromised, the damage is limited to that small area.
- **Defence in depth**: use several independent layers, so one failure is not fatal. Input validation, parameterised queries and a restricted database account each stop SQL injection at a different point.
- **Fail closed (secure by default)**: when something is unclear or broken, deny. An authorization check that throws an error must not let the request through.
- **Never trust the client**: repeat every important check on the server.
- **Keep it simple**: complex code hides bugs, and use well-reviewed libraries instead of inventing cryptography or session handling.

## Bad and good: trusting the client

```ts bad title="Server trusts a price sent by the browser"
app.post('/api/orders', async (req, res) => {
	const { productId, price } = req.body; // price came from the client
	await db.query('INSERT INTO orders (product_id, total_cents) VALUES ($1, $2)', [
		productId,
		price
	]);
	res.status(201).end();
});
```

The attacker opens DevTools, edits the request (or just sends it with `curl`), and sets `price` to `1`. Your UI never offered that, but the server never asked. The front-end hiding a field or disabling a button prevents nothing.

```ts good title="Server looks up the price itself"
app.post('/api/orders', requireUser, async (req, res) => {
	const productId = z.string().uuid().parse(req.body.productId);
	const { rows } = await db.query('SELECT price_cents FROM products WHERE id = $1', [productId]);
	if (rows.length === 0) return res.status(404).end();
	await db.query('INSERT INTO orders (user_id, product_id, total_cents) VALUES ($1, $2, $3)', [
		req.user.id,
		productId,
		rows[0].price_cents
	]);
	res.status(201).end();
});
```

The client only says _what_ it wants. The server decides the price, takes the user from the session (not the body), and validates the shape of the input. More on that in [validation and errors](/backend/validation-and-errors) and [forms and validation](/frontend/forms-and-validation).

## Trade-offs

- Every control costs something: friction for users (MFA), latency (extra checks), development time. Spend effort where the impact is highest: login, payments, personal data, admin functions.
- A threat model is a living note, not a document to finish. Redo a small one when a feature changes who can see or change data.
- Perfect security does not exist. The goal is to make attacks expensive enough, and to detect and limit them when they happen.

## Checklist

- Can you point to the trust boundaries in your system and say what is validated at each?
- Does the server re-check every rule that the UI enforces?
- Have you asked "what can go wrong" (STRIDE) for your riskiest feature?
- Does each service, token and database account have only the access it needs?
- When a check fails or errors, does the code deny by default?
