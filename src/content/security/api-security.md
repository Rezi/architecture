---
sources:
  - title: OWASP API Security Top 10 (2023)
    url: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
    publisher: OWASP
  - title: REST Security Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
    publisher: OWASP
  - title: Mass Assignment Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
    publisher: OWASP
  - title: Server-Side Request Forgery Prevention Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
    publisher: OWASP
---

## The core idea: the API is the real application

The UI is only one client. Anyone can call your API with curl, a script or a modified browser, sending any request they like. So every rule enforced only in the frontend (hidden buttons, form validation, disabled fields) is a convenience, not a defence. The API must enforce everything again, on its own. The OWASP API Security Top 10 is a list of the most common ways APIs fail; this page covers the ones frontend developers meet most often.

## Broken object-level authorization (IDOR)

**BOLA** (also called **IDOR**, insecure direct object reference) means the API checks that you are logged in but not that the object you asked for is _yours_. It tops the OWASP API list.

```ts bad title="Authenticated, but anyone can read anyone's order"
app.get('/api/orders/:id', requireLogin, async (req, res) => {
	const order = await db.orders.findById(req.params.id);
	res.json(order);
});
```

Exploit: a user opens their own order at `/api/orders/1041`, then changes the number to `1040` in the request. If the server returns it, they read another customer's data. Hard-to-guess IDs (UUIDs) only slow this down; they are not authorization.

```ts good title="Ownership is part of the query"
app.get('/api/orders/:id', requireLogin, async (req, res) => {
	const order = await db.orders.findOne({ id: req.params.id, userId: req.user.id });
	if (!order) return res.sendStatus(404); // same answer for "missing" and "not yours"
	res.json(order);
});
```

More on the model behind this in [authorization](/security/authorization).

## Mass assignment

**Mass assignment** is when the server copies all fields from the request body onto an object, including ones the client should never set.

```ts bad title="Spreading the body straight into the update"
app.patch('/api/users/me', requireLogin, async (req, res) => {
	await db.users.update(req.user.id, req.body); // body: { name, role, isAdmin ... }
	res.sendStatus(204);
});
```

Exploit: the profile form sends `{ "name": "Ana" }`. The attacker sends `{ "name": "Ana", "role": "admin" }` instead, and the server obediently writes it.

```ts good title="Validate against an explicit allow-list schema"
import { z } from 'zod';

const ProfilePatch = z.object({ name: z.string().min(1).max(100) }).strict();

app.patch('/api/users/me', requireLogin, async (req, res) => {
	const parsed = ProfilePatch.safeParse(req.body);
	if (!parsed.success) return res.status(400).json({ error: 'invalid body' });
	await db.users.update(req.user.id, parsed.data);
	res.sendStatus(204);
});
```

An allow-list (name the fields you accept) beats a deny-list (try to remember the dangerous ones). Validation is covered in [validation and errors](/backend/validation-and-errors); the contract side in [API contracts](/common/api-contracts).

## Excessive data exposure

The reverse problem: returning the whole database row and letting the frontend pick what to show. The password hash, internal flags and other users' emails are all visible in the network tab. Build explicit response shapes (DTOs) instead of serialising entities.

```ts good title="Respond with a chosen shape"
const toPublicUser = (u: User) => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl });
res.json(toPublicUser(user));
```

## Rate limiting and resource consumption

Without limits, one client can guess passwords, scrape everything or exhaust your database with a `?limit=1000000` query. Apply limits per user or IP on sensitive routes (login, password reset, search), cap page sizes and body sizes, and set timeouts.

```ts good title="Cap the page size no matter what the client asks for"
const limit = Math.min(Number(req.query.limit) || 20, 100);
const rows = await db.products.list({ limit, offset: Number(req.query.offset) || 0 });
```

Trade-off: in-memory counters break when you run several server instances; shared stores or a gateway are needed at scale (see [scalability](/backend/scalability)). Limits also need care so legitimate shared networks (an office behind one IP) are not locked out.

## Server-side request forgery (SSRF)

**SSRF** happens when your server fetches a URL supplied by the user (link previews, webhooks, image import). The attacker points it at addresses only the server can reach, such as an internal admin service or a cloud metadata endpoint.

```ts bad title="Fetching whatever URL the user gives"
app.post('/api/preview', async (req, res) => {
	const html = await fetch(req.body.url).then((r) => r.text());
	res.json({ title: extractTitle(html) });
});
```

Exploit: the user submits `http://localhost:8080/admin` or a link-local metadata address. The request originates from inside your network, bypassing the firewall that protects those services, and the response is returned to the attacker.

```ts good title="Allow-list scheme and host; do not follow redirects blindly"
const ALLOWED_HOSTS = new Set(['example.com', 'cdn.example.com']);

function assertSafeUrl(raw: string): URL {
	const url = new URL(raw);
	if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
		throw new Error('url not allowed');
	}
	return url;
}

const res = await fetch(assertSafeUrl(req.body.url), { redirect: 'manual' });
```

When an allow-list is impossible (arbitrary link previews), resolve the hostname and reject private and loopback ranges after resolution, run the fetcher in a network-isolated service, and apply timeouts and size caps. Defence in depth matters here because URL parsing tricks are numerous.

## Where the browser fits

The frontend's part: send credentials safely (see [CSRF, CORS and cookies](/security/csrf-cors-cookies)), never treat hidden UI as access control, and handle 401/403/429 responses gracefully. The server's part is everything above.

## Checklist

- Every endpoint checks both who you are and whether this object is yours.
- Request bodies are validated with an allow-list schema; unknown fields are rejected or dropped.
- Responses are explicit shapes, not raw database rows.
- Login and other sensitive routes are rate-limited; page and body sizes are capped.
- Server-side fetches of user-supplied URLs use an allow-list or network isolation.
- No security rule exists only in the frontend.
