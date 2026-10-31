---
sources:
  - title: Authentication Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
    publisher: OWASP
  - title: Password Storage Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
    publisher: OWASP
  - title: Session Management Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
    publisher: OWASP
  - title: Digital Identity Guidelines, Authentication and Lifecycle Management (SP 800-63B)
    url: https://pages.nist.gov/800-63-3/sp800-63b.html
    publisher: NIST
  - title: JSON Web Token Best Current Practices (RFC 8725)
    url: https://www.rfc-editor.org/rfc/rfc8725
    publisher: IETF
---

## Authentication is not authorization

**Authentication** (authn) answers "who are you?". **Authorization** (authz) answers "what may you do?" and is covered on the [next page](/security/authorization). Mixing them up is a classic source of bugs: being logged in proves identity, not permission.

Authentication is a hard, well-studied problem. The practical advice is: use a mature library or an identity provider rather than writing it yourself, and understand the pieces well enough to configure them correctly.

## Storing passwords

If an attacker steals your database, the passwords must be useless to them. So you never store the password, only a **hash**: the output of a one-way function. To check a login you hash the submitted password and compare.

Not every hash function is suitable. MD5, SHA-1 and plain SHA-256 are designed to be _fast_, so an attacker can try billions of guesses per second on a graphics card. Password hashing functions (argon2, scrypt, bcrypt) are deliberately _slow and memory-hungry_, which makes each guess expensive. They also add a **salt**: a random value stored beside the hash, unique per user, so two users with the same password get different hashes and precomputed tables ("rainbow tables") are useless.

```ts bad title="Fast hash, no salt"
import { createHash } from 'node:crypto';

const stored = createHash('sha256').update(password).digest('hex');
// Same password gives the same hash for everyone, and a GPU tries billions per second.
```

If the database leaks, the attacker sorts the hashes, sees that many users share one, tests the most common passwords first and recovers most accounts within hours.

```ts good title="scrypt with a per-user salt (Node built-in)"
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await scryptAsync(password, salt, 64);
	return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [saltHex, keyHex] = stored.split(':');
	const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64);
	return timingSafeEqual(key, Buffer.from(keyHex, 'hex')); // constant-time compare
}
```

Prefer argon2id via a maintained library if you can; scrypt is a fine built-in. Tune cost parameters to the OWASP cheat sheet, and note that a hash is not encryption: it cannot be reversed, so "forgot password" must reset, never email the old one.

## Password rules that actually help

NIST SP 800-63B (the US government's digital identity guidelines, widely used as a reference) recommends:

- Allow long passwords and passphrases (at least 8 characters minimum, accept 64 or more) and accept any characters, including spaces.
- Check new passwords against lists of breached or common passwords.
- Do **not** force periodic rotation or composition rules like "one symbol and one capital". They push users to predictable patterns.
- Offer a second factor (**MFA**, multi-factor authentication: something you know plus something you have, such as an authenticator app or passkey). **Passkeys** (WebAuthn) replace the password with a key pair held on the device, which cannot be phished.
- Rate-limit login attempts per account and per IP, and respond identically whether the user exists or not.

## Sessions: staying logged in

HTTP is stateless, so after login the server gives the browser something to present on each request. Two common designs:

|                       | Server-side session         | Token (such as JWT)                                |
| --------------------- | --------------------------- | -------------------------------------------------- |
| What the client holds | Random opaque id            | Signed data containing claims                      |
| Where state lives     | Server store (Redis, DB)    | In the token itself                                |
| Revoking              | Delete the session: instant | Hard until the token expires                       |
| Scaling               | Needs shared store          | Stateless, see [scalability](/backend/scalability) |

A **JWT** (JSON Web Token, RFC 7519) is a signed JSON blob: anyone can read it, but only the holder of the key can create a valid one. Signed does not mean secret, so never put sensitive data inside. Mistakes with JWTs are common (accepting `alg: none`, not checking expiry, weak keys); RFC 8725 lists them. For a typical browser app, a plain server-side session in a cookie is simpler and safer.

```ts good title="Session cookie settings"
import { randomBytes } from 'node:crypto';

const sessionId = randomBytes(32).toString('base64url'); // unguessable
await sessions.set(sessionId, { userId: user.id }, { ttlSeconds: 60 * 60 * 8 });

res.cookie('sid', sessionId, {
	httpOnly: true, // JavaScript cannot read it, so an XSS bug cannot steal it
	secure: true, // sent only over HTTPS
	sameSite: 'lax', // not sent on most cross-site requests
	maxAge: 8 * 60 * 60 * 1000
});
```

Always issue a **new** session id at login (otherwise an attacker who planted a known id, "session fixation", shares your session). See [cookies and CSRF](/security/csrf-cors-cookies) for why `sameSite` matters.

```ts bad title="Token in localStorage"
localStorage.setItem('token', jwt); // any script on the page can read this
```

If one injected script runs (see [XSS](/security/injection-and-xss)) it can read `localStorage` and send the token away. An `httpOnly` cookie cannot be read by scripts, though XSS can still make requests on the user's behalf.

## Third-party login (OAuth and OpenID Connect)

**OAuth 2.0** lets an app get limited access to a user's account at another service without seeing their password. **OpenID Connect (OIDC)** adds a standard way to learn _who_ the user is ("Sign in with Google", or your company identity provider). For a browser app use the **authorization code flow with PKCE** (Proof Key for Code Exchange, RFC 7636): the app creates a random secret, sends only its hash at the start, and proves it holds the original at the end, so a stolen code is useless. The old implicit flow (tokens in the URL) is discouraged by the OAuth security best practice (RFC 9700). Delegating login to an identity provider removes password storage from your list of risks, in exchange for a dependency on them.

## Checklist

- Passwords hashed with argon2id or scrypt, salted per user, never reversible.
- Breached-password check, no forced rotation, MFA or passkeys offered.
- Login rate-limited; error messages do not reveal whether the account exists.
- Session cookie is `httpOnly`, `secure`, `sameSite`, with expiry and a fresh id at login.
- No tokens in `localStorage` unless you accept the XSS trade-off knowingly.
- Using a maintained library or identity provider, not homemade crypto.
