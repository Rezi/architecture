---
sources:
  - title: Cross-Site Request Forgery Prevention Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
    publisher: OWASP
  - title: Cross-Origin Resource Sharing (CORS)
    url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
    publisher: MDN
  - title: Same-origin policy
    url: https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
    publisher: MDN
  - title: Using HTTP cookies
    url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies
    publisher: MDN
  - title: SameSite cookies explained
    url: https://web.dev/articles/samesite-cookies-explained
    publisher: web.dev
---

## Three things that get confused

These three topics are constantly mixed up because they all involve "requests between sites" and they all show up as confusing browser console errors. They are different tools that solve different problems.

|                  | Cookies (and their flags)                                  | CORS                                                             | CSRF defences                                          |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| What it is       | Small data the browser stores and sends back automatically | A set of headers that **relaxes** a browser restriction          | Techniques to stop forged requests                     |
| What it protects | Cookie confidentiality and when it is sent                 | Nothing by itself: it grants _reading_ of cross-origin responses | State-changing requests made without the user's intent |
| Who enforces it  | The browser                                                | The browser                                                      | The server (with browser help)                         |

First, an **origin** is the triple scheme + host + port, for example `https://app.example.com:443`. The **same-origin policy** is the browser rule that a page from one origin may not _read_ responses from another origin. It exists so that `evil.example` cannot open your bank in a hidden frame and read your balance.

Note the word _read_. The policy does not stop a page from _sending_ a request to another origin. That gap is the whole reason CSRF exists.

## The attack: CSRF

**Cross-Site Request Forgery (CSRF)** tricks a logged-in user's browser into sending a request the user never intended. It works because browsers attach cookies to a request automatically, based on the destination, not on who initiated it.

```ts bad title="Cookie session + state change on a plain GET or unprotected POST"
// Express-style handler. Authenticates ONLY by the session cookie.
app.post('/transfer', requireSession, async (req, res) => {
	const { to, amount } = req.body;
	await transfer(req.session.userId, to, amount);
	res.sendStatus(204);
});
```

How an attacker exploits it, step by step:

1. You are logged in to `bank.example`; your browser holds the session cookie.
2. You visit `evil.example` (a link in an email, an ad).
3. That page contains an invisible auto-submitting form whose `action` is `https://bank.example/transfer`.
4. Your browser sends the POST and, helpfully, attaches your bank cookie.
5. The server sees a valid session and performs the transfer. The attacker never saw the response and did not need to.

The attacker never needed to read anything, so the same-origin policy and CORS are irrelevant here.

## Defence 1: SameSite cookies

The `SameSite` cookie attribute tells the browser when _not_ to attach the cookie to cross-site requests. (A **site** is the registrable domain, such as `example.com`, so `app.example.com` and `api.example.com` are the same site but different origins.)

```ts good title="Session cookie with SameSite=Lax, HttpOnly and Secure"
res.cookie('session', sessionId, {
	httpOnly: true, // JavaScript cannot read it (limits damage from XSS)
	secure: true, // only sent over HTTPS
	sameSite: 'lax', // not sent on cross-site POSTs, fetches or iframes
	path: '/',
	maxAge: 1000 * 60 * 60 * 8
});
```

| Value    | Cookie sent on cross-site requests?                                                               |
| -------- | ------------------------------------------------------------------------------------------------- |
| `Strict` | Never, even when the user clicks a link to your site (they appear logged out on arrival)          |
| `Lax`    | Only on top-level navigations using safe methods (a link click), not on POSTs, fetches or iframes |
| `None`   | Always, but requires `Secure`; needed for embedded or truly cross-site use                        |

Why it works: the browser, not your server, decides to withhold the cookie, so the forged request arrives anonymous. Modern browsers treat a cookie with no `SameSite` as `Lax`, but do not rely on that default: set it explicitly.

**When this is not enough:** `SameSite` is a browser feature (old browsers may ignore it), same-site subdomains can still attack each other, and `Lax` still sends cookies on top-level GET navigations, so a state-changing GET remains exploitable. Treat it as a strong first layer, not the only one.

## Defence 2: CSRF tokens

A **CSRF token** is a random, per-session secret the server embeds in its own pages and requires back on every state-changing request. The attacker's page cannot read it (same-origin policy!), so it cannot forge a valid request.

```ts good title="Server: verify a token header against the session"
import { timingSafeEqual } from 'node:crypto';

function csrfGuard(req: Request, res: Response, next: NextFunction) {
	if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
	const sent = Buffer.from(String(req.get('x-csrf-token') ?? ''));
	const expected = Buffer.from(req.session.csrfToken);
	if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
		return res.status(403).json({ error: 'bad csrf token' });
	}
	next();
}
```

```ts good title="Browser: send the token your page was given"
const csrf = document.querySelector<HTMLMetaElement>('meta[name=csrf-token]')!.content;

await fetch('/transfer', {
	method: 'POST',
	credentials: 'same-origin',
	headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
	body: JSON.stringify({ to, amount })
});
```

SvelteKit note: form actions have a built-in origin check that rejects cross-origin form POSTs (`csrf.checkOrigin`, on by default). Do not switch it off to "fix" an error; read why it fired first.

Also useful: require `Content-Type: application/json` and reject others, because an HTML form cannot send that type without triggering the CORS preflight described next. Also check the `Origin` header on state-changing requests.

## CORS: what it actually does

**CORS (Cross-Origin Resource Sharing)** is a set of response headers a server sends to tell the browser: "pages from origin X are allowed to _read_ my responses". Without it, the browser's same-origin policy hides cross-origin responses from your script.

Some requests are risky enough that the browser first asks permission with a **preflight**: an automatic `OPTIONS` request that asks "may this origin send this method and these headers?". Only if the answer is yes does the real request go out.

```http title="What a cross-origin API call looks like on the wire"
OPTIONS /api/orders HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: content-type
Access-Control-Allow-Credentials: true
```

### The common misconception

> CORS is **not** a server-side security feature that blocks attackers. It is the opposite: a way to _loosen_ a browser restriction. It is enforced only by browsers, protecting the _user_, and has no effect on curl, scripts, or an attacker's server.

An attacker can call your API directly from their own machine and CORS never enters the picture. A "simple" cross-origin POST (such as a form) is also _sent_ regardless of CORS; CORS only hides the response. So never use CORS as authentication or CSRF protection.

```ts bad title="Reflecting any origin while allowing credentials"
app.use((req, res, next) => {
	// Echoes whatever origin asked, and lets it use the user's cookies.
	res.set('Access-Control-Allow-Origin', req.get('origin') ?? '*');
	res.set('Access-Control-Allow-Credentials', 'true');
	next();
});
```

Exploit: `evil.example` runs `fetch('https://api.example.com/me', { credentials: 'include' })`. The browser attaches the victim's cookie, the server reflects `evil.example` as allowed, and now the attacker's script can _read_ the private response. (The wildcard `*` is refused by browsers together with credentials, which is why people write the reflecting version.)

```ts good title="Explicit allow-list of origins"
const allowed = new Set(['https://app.example.com']);

app.use((req, res, next) => {
	const origin = req.get('origin');
	if (origin && allowed.has(origin)) {
		res.set('Access-Control-Allow-Origin', origin);
		res.set('Access-Control-Allow-Credentials', 'true');
		res.append('Vary', 'Origin'); // caches must not mix up origins
	}
	if (req.method === 'OPTIONS') return res.sendStatus(204);
	next();
});
```

Simplest of all: serve the API from the same origin as the app (reverse proxy `/api`) and you need no CORS at all.

## Who is responsible for what

- **Browser:** enforces the same-origin policy, CORS, `SameSite`, `HttpOnly`, `Secure`.
- **Server:** decides what to put in those headers, and verifies CSRF tokens and `Origin`.
- **Not applicable:** if you authenticate with an `Authorization: Bearer` header instead of cookies, the browser does not add it automatically, so classic CSRF does not apply. The price is that the token lives in JavaScript, which raises the stakes of [XSS](/security/injection-and-xss). See [authentication](/security/authentication) for that trade-off.

## Checklist

- Session cookies are `HttpOnly`, `Secure` and have an explicit `SameSite` (usually `Lax`).
- State-changing actions are never GET.
- Cookie-authenticated endpoints verify a CSRF token or at least the `Origin` header.
- CORS origins are an explicit allow-list; never reflect the request origin with credentials.
- Nobody on the team believes CORS stops non-browser clients.
