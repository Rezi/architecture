---
sources:
  - title: HTTP Security Response Headers Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
    publisher: OWASP
  - title: Transport Layer Security Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html
    publisher: OWASP
  - title: Strict-Transport-Security
    url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
    publisher: MDN
  - title: Content Security Policy (CSP)
    url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP
    publisher: MDN
  - title: HTTP Strict Transport Security
    url: https://datatracker.ietf.org/doc/html/rfc6797
    publisher: IETF (RFC 6797)
---

## Two jobs: protect the wire, then instruct the browser

Security at this layer does two different things:

1. **Transport security (TLS/HTTPS):** encrypts and authenticates the connection between browser and server, so people on the network path cannot read or alter traffic.
2. **Security headers:** response headers that switch on extra browser protections for your page, such as refusing to run unexpected scripts.

Both are mostly configuration, which makes them cheap defences with a high return.

## The problem with plain HTTP

Over HTTP, every router between the user and you (a cafe Wi-Fi, a hotel network) can read and modify the traffic.

1. The user connects to public Wi-Fi.
2. The attacker on that network sees the session cookie in an HTTP request and copies it, or injects a script into the HTML in transit.
3. The attacker is now logged in as the user.

**TLS** (the protocol behind HTTPS) fixes this by encrypting traffic and proving the server's identity with a certificate. Use it everywhere, including internal APIs and development-like staging environments, and get certificates automatically (for example Let's Encrypt) so expiry never causes an outage.

## HSTS: do not let users start on HTTP

Even with HTTPS available, a user typing `example.com` first requests `http://example.com`, which an attacker can intercept before the redirect. **HSTS (HTTP Strict Transport Security)** is a response header telling the browser: "for the next N seconds, only ever use HTTPS for this host, and refuse certificate errors."

```http title="HSTS response header"
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Why it works: after the first visit, the browser upgrades the request itself before anything leaves the machine, so there is no plain-HTTP moment to attack. Trade-offs: it is a commitment (if you later need HTTP on a subdomain, browsers will refuse), so start with a short `max-age`, confirm everything works, then raise it. It only protects after one successful visit; the browser preload list closes even that gap but is hard to undo.

## Writing the headers by hand

Libraries such as helmet set these for you. Setting them manually once shows what each does:

```ts good title="Express middleware: baseline security headers"
app.use((_req, res, next) => {
	res.set({
		'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'strict-origin-when-cross-origin',
		'Content-Security-Policy':
			"default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
		'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
	});
	res.removeHeader('X-Powered-By'); // do not advertise the framework
	next();
});
```

| Header                            | What it does                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Content-Type-Options: nosniff` | Browser must trust the declared content type. Stops an uploaded file being "sniffed" and run as a script                                             |
| `Referrer-Policy`                 | Limits how much of the page URL is sent to other sites in the `Referer` header (URLs can contain tokens or IDs)                                      |
| `Permissions-Policy`              | Turns off powerful browser features you do not use                                                                                                   |
| `frame-ancestors` (inside CSP)    | Which sites may embed yours in an iframe. Stops **clickjacking**: an attacker frames your page invisibly and tricks users into clicking your buttons |

## CSP: the strongest header, and the hardest

A **Content Security Policy (CSP)** is a header listing where the page may load scripts, styles, images and so on from. If an attacker manages to inject markup (see [XSS](/security/injection-and-xss)), the browser still refuses to run a script that the policy does not allow. It is a safety net behind correct output escaping, not a replacement.

```http bad title="A policy that looks safe and protects nothing"
Content-Security-Policy: default-src *; script-src * 'unsafe-inline' 'unsafe-eval'
```

This allows any origin and inline scripts, which is exactly what an injected script is. A CSP with `'unsafe-inline'` in `script-src` gives almost no XSS protection.

The robust approach is a **nonce**: a random value generated per response and attached to your own script tags, so only those run. SvelteKit supports this in its config:

```ts good title="svelte.config.js: SvelteKit adds nonces/hashes to its own scripts"
const config = {
	kit: {
		csp: {
			mode: 'auto', // nonces for dynamic pages, hashes for prerendered ones
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['none'],
				'frame-ancestors': ['none']
			}
		}
	}
};
export default config;
```

Rollout advice: begin with the `Content-Security-Policy-Report-Only` header, which logs violations without blocking, fix what it reports (analytics snippets, inline handlers), and only then enforce. Expect friction with third-party scripts; see [supply chain](/security/supply-chain).

## Cookies and CORS also live here

Cookie flags and cross-origin rules are covered on the [CSRF, CORS and cookies](/security/csrf-cors-cookies) page. Remember: HTTPS plus `Secure` cookies is what keeps session cookies off the wire in the clear.

## Check your work

Run your public site through Mozilla Observatory (headers) and Qualys SSL Labs (TLS configuration). They give a graded report, but treat the grade as a hint, not a goal: a CSP you do not understand scores well and still breaks the site.

## Checklist

- All traffic is HTTPS; certificates renew automatically.
- HSTS is on, started with a short `max-age`.
- `nosniff`, a `Referrer-Policy` and `frame-ancestors` are set.
- A CSP exists, avoids `unsafe-inline` for scripts, and was rolled out in report-only mode first.
- The server does not advertise its framework or version.
