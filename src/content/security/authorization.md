---
sources:
  - title: Authorization Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
    publisher: OWASP
  - title: Insecure Direct Object Reference Prevention Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html
    publisher: OWASP
  - title: Access control vulnerabilities and privilege escalation
    url: https://portswigger.net/web-security/access-control
    publisher: PortSwigger Web Security Academy
  - title: CWE-639, Authorization Bypass Through User-Controlled Key
    url: https://cwe.mitre.org/data/definitions/639.html
    publisher: MITRE
---

## The problem

**Authorization** decides what an already identified user may do. Getting it wrong is called **broken access control**, and it tops the [OWASP Top 10](/security/owasp-top-10). The reason is simple: every endpoint, every record and every action needs a check, and a single forgotten check is a vulnerability.

Three kinds of mistake recur:

- **Vertical escalation**: a normal user calls an admin function.
- **Horizontal escalation**: a user reads or edits another user's data.
- **Missing function-level checks**: the UI hides a button, but the endpoint behind it is open.

## The FE trap

```svelte bad title="Hiding the button is not access control"
<script lang="ts">
	let { user } = $props();
</script>

{#if user.role === 'admin'}
	<button onclick={() => fetch('/api/users/42', { method: 'DELETE' })}>Delete user</button>
{/if}
```

Hiding UI is good UX, since users should not see actions they cannot use. But the attacker never needs your button. They open the Network tab, copy any request, change the URL and send it. If the server does not check the role, `DELETE /api/users/42` works for everyone. **The server must authorise every request**; the client check only saves confused clicks.

## IDOR: the most common horizontal bug

**IDOR** (Insecure Direct Object Reference) means the app uses an identifier from the request to fetch a record, but never checks the record belongs to the caller.

```ts bad title="Fetches by id only"
app.get('/api/orders/:id', requireUser, async (req, res) => {
	const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
	res.json(rows[0]);
});
```

How it is exploited: Alice sees her own order at `/api/orders/1001`. She changes the number to `1002` and receives Bob's order, address and all. Scripting this to walk through every number takes minutes. Random ids (UUIDs) make guessing harder but are **not** a fix; they only hide the problem. The ownership check is the fix.

```ts good title="Ownership is part of the query"
app.get('/api/orders/:id', requireUser, async (req, res) => {
	const { rows } = await db.query(
		'SELECT id, total_cents, status FROM orders WHERE id = $1 AND user_id = $2',
		[req.params.id, req.user.id]
	);
	if (rows.length === 0) return res.status(404).json({ error: 'not_found' }); // same answer for "missing" and "not yours"
	res.json(rows[0]);
});
```

Putting the owner into the `WHERE` clause means unauthorised rows are never loaded. Returning 404 for both cases stops the attacker learning which ids exist. Notice the user id comes from the session (`req.user`), never from the request body or URL.

## Models: roles, permissions, attributes

| Model                  | Idea                                            | Fits when                                            | Weakness                                      |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| RBAC (role-based)      | Users have roles, roles have permissions        | Few clear job types                                  | Role explosion; cannot say "own records only" |
| ABAC (attribute-based) | Rule over attributes of user, resource, context | "Editors may edit documents in their own department" | More complex to write and audit               |
| Ownership checks       | Resource has an owner                           | User-generated data                                  | Needs care on every query                     |

Most apps combine them: roles for coarse rights, ownership for data.

## Centralise the checks

Scattered `if (user.role === ...)` lines are where checks get forgotten. Put policy in one place and make the default deny, as the [layers page](/common/layering-and-boundaries) suggests for cross-cutting rules.

```ts good title="One policy function, default deny"
type Action = 'read' | 'update' | 'delete';

export function can(user: User, action: Action, order: Order): boolean {
	if (user.role === 'admin') return true;
	if (order.userId !== user.id) return false;
	return action !== 'delete' || order.status === 'draft';
}

// In the handler
const order = await orders.findById(req.params.id);
if (!order || !can(req.user, 'update', order)) return res.status(404).end();
```

Middleware can enforce "must be logged in" for a whole route group, so new routes are protected unless explicitly opened. A test per rule (with a second user as the attacker) catches regressions cheaply; see [testing strategy](/common/testing-strategy).

## Related traps

- **Mass assignment**: copying the whole request body into an update lets users set `role: 'admin'`. Pick allowed fields explicitly.
- **Trusting tokens' claims**: a role in a JWT is stale until it expires. Reload permissions for sensitive actions.
- **Least privilege** (give each user and service only what it needs, see [principles](/security/principles)) also applies to database accounts and API keys.

## Trade-offs

Fine-grained rules are costly to write and review; start with ownership plus a few roles, and add attributes when real requirements appear. Checks in a database layer (row-level security) are strong but harder to debug. Do whichever you can keep consistent.

## Checklist

- Every endpoint authenticates and authorises; the default is deny.
- Data access is scoped by owner in the query itself.
- The user id comes from the session, not from client input.
- UI hiding is treated as UX, never as protection.
- Update handlers pick allowed fields explicitly.
- There are tests where user B tries to reach user A's data.
