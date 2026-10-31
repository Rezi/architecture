---
sources:
  - title: PostgreSQL documentation, Indexes
    url: https://www.postgresql.org/docs/current/indexes.html
    publisher: PostgreSQL Global Development Group
  - title: PostgreSQL documentation, Transaction isolation
    url: https://www.postgresql.org/docs/current/transaction-iso.html
    publisher: PostgreSQL Global Development Group
  - title: PostgreSQL documentation, Using EXPLAIN
    url: https://www.postgresql.org/docs/current/using-explain.html
    publisher: PostgreSQL Global Development Group
  - title: SQL Performance Explained
    url: https://use-the-index-luke.com/
    publisher: Use The Index, Luke
  - title: Online migrations at scale
    url: https://stripe.com/blog/online-migrations
    publisher: Stripe
---

## Why the database deserves your attention

In most backends the database is the one component that holds the truth, is hardest to scale, and is hardest to change. Application code can be redeployed in minutes; a bad table design lives for years. Examples below use PostgreSQL and the `pg` library, but the ideas hold for any relational database.

## Let the schema defend your data

Your code will have bugs, and a second service or a one-off script may write to the same tables. Constraints are the last line of defence, enforced no matter who writes.

```sql bad title="Everything nullable, no relationships, rules only in app code"
CREATE TABLE orders (
  id serial,
  user_id int,
  status text,
  total_cents int
);
-- Orders with no user, status "shippd", negative totals and duplicates all become possible.
```

```sql good title="Constraints state the rules once, for every writer"
CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users (id),
  status      text   NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Store money as integer cents (floating point cannot represent 0.1 exactly), and times as `timestamptz` (a point in time, not a wall-clock string).

## Indexes: the difference between instant and minutes

Without help, finding rows with `WHERE user_id = 42` means reading the entire table (a **sequential scan**). An **index** is a sorted lookup structure, like the index at the back of a book, that lets the database jump straight to the matching rows.

```sql bad title="No index on the column you filter by"
SELECT id, total_cents FROM orders WHERE user_id = 42 ORDER BY created_at DESC LIMIT 20;
-- Fine with 1,000 rows. With 50 million rows, every page load scans all of them.
```

```sql good title="Index matching the filter and the sort"
CREATE INDEX orders_user_created_idx ON orders (user_id, created_at DESC);
```

Do not guess; ask the database. `EXPLAIN ANALYZE` shows the plan it actually used and the time it took. Look for `Seq Scan` on a big table where you expected `Index Scan`.

```sql
EXPLAIN ANALYZE
SELECT id, total_cents FROM orders WHERE user_id = 42 ORDER BY created_at DESC LIMIT 20;
```

Trade-offs: every index speeds up reads but slows down each write and uses disk, so index the columns you actually filter, join and sort on, not everything. In a multi-column index, order matters: `(user_id, created_at)` helps queries on `user_id` alone but not on `created_at` alone. Primary keys and `UNIQUE` constraints are indexed automatically; foreign key columns are not in PostgreSQL, so add one if you join or delete through them.

## The N+1 query problem

**N+1** means: one query to fetch a list of N items, then one more query per item to fetch something related, so N+1 queries in total. It is the backend twin of a React component that fires a request for each row it renders.

```ts bad title="One query for orders, then one per order: 101 round trips for 100 orders"
const { rows: orders } = await pool.query('SELECT id, user_id FROM orders LIMIT 100');
for (const order of orders) {
	const { rows } = await pool.query('SELECT name FROM users WHERE id = $1', [order.user_id]);
	order.userName = rows[0].name;
}
```

Each query is fast, but each also pays a network round trip to the database (often 0.5 to 2 ms), plus connection use. At 100 rows it is merely slow, under load it exhausts the connection pool. It is invisible in development with 5 rows.

```ts good title="One query with a JOIN"
const { rows } = await pool.query(
	`SELECT o.id, o.total_cents, u.name AS user_name
	 FROM orders o JOIN users u ON u.id = o.user_id
	 ORDER BY o.created_at DESC LIMIT 100`
);
```

If a JOIN is awkward, fetch the related rows in a second query using `WHERE id = ANY($1)` with the collected IDs, then combine them in memory: two queries instead of 101. ORMs such as Prisma and Drizzle have the same trap (a lazy-loaded relation inside a loop) and offer `include` or `with` options to fix it. Always log query counts per request in development.

## Transactions: all or nothing

A **transaction** groups several statements so they either all take effect or none do (this is the "A" in ACID, atomicity). Without one, a crash or error in the middle leaves half-finished data.

```ts bad title="Two related writes with no transaction"
await pool.query('UPDATE accounts SET balance_cents = balance_cents - $1 WHERE id = $2', [
	500,
	fromId
]);
// Process crashes or the next query fails here: the money has vanished.
await pool.query('UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id = $2', [
	500,
	toId
]);
```

```ts good title="One transaction on one dedicated connection"
const client = await pool.connect(); // a transaction lives on ONE connection, not on the pool
try {
	await client.query('BEGIN');
	const { rowCount } = await client.query(
		'UPDATE accounts SET balance_cents = balance_cents - $1 WHERE id = $2 AND balance_cents >= $1',
		[500, fromId]
	);
	if (rowCount === 0) throw new ConflictError('Insufficient funds');
	await client.query('UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id = $2', [
		500,
		toId
	]);
	await client.query('COMMIT');
} catch (e) {
	await client.query('ROLLBACK');
	throw e;
} finally {
	client.release(); // always give the connection back
}
```

Note the `AND balance_cents >= $1` inside the UPDATE. The tempting alternative, SELECT the balance, check it in JavaScript, then UPDATE, has a **race condition**: two simultaneous requests both read 500, both pass the check, and both subtract. Making the check part of the single atomic statement avoids it. When you need to read first and then decide, lock the row with `SELECT ... FOR UPDATE` inside the transaction so others wait.

The database also decides how much concurrent transactions can see each other, called the **isolation level**. PostgreSQL's default (read committed) is right for most work; stricter levels exist for tricky cases and may force you to retry on failure. Read the PostgreSQL page before raising it. Keep transactions **short**: never make an HTTP call or wait for a user inside one, because it holds locks and a connection.

## Migrations: changing a live schema safely

A **migration** is a versioned script that changes the schema, kept in the repository and applied in order by tooling (Prisma Migrate, Drizzle Kit, node-pg-migrate, Flyway). The danger: during a deploy the old and new application versions run side by side, so the schema must work for both.

```sql bad title="Rename in one step: the old code breaks the moment this runs"
ALTER TABLE users RENAME COLUMN name TO full_name;
```

```sql good title="Expand and contract: several small, safe steps over several deploys"
-- Deploy 1 (expand): add the new column, code writes both.
ALTER TABLE users ADD COLUMN full_name text;
-- Backfill in small batches, not one giant UPDATE that locks the table.
UPDATE users SET full_name = name WHERE id BETWEEN 1 AND 10000 AND full_name IS NULL;
-- Deploy 2: code reads full_name only.
-- Deploy 3 (contract): remove the old column once nothing uses it.
ALTER TABLE users DROP COLUMN name;
```

Also beware operations that take a long lock on a big table (adding a column with a volatile default on old versions, creating an index without `CONCURRENTLY`, adding a NOT NULL constraint). Test migrations on a copy of production-sized data.

## Trade-offs and when NOT to do this

- Do not add an index "just in case", and do not denormalise (duplicate data to avoid joins) until measurement shows a problem.
- Foreign keys cost a little on writes; the integrity they buy is almost always worth it.
- Expand and contract is slow for a hobby app with one user and a maintenance window; a single-step migration is fine there.

## Checklist

- Does the schema use NOT NULL, foreign keys, UNIQUE and CHECK constraints for the rules that must always hold?
- Have you run EXPLAIN on your slowest queries, and is there an index for each frequent filter and sort?
- Can any request run a query inside a loop?
- Are multi-statement writes in a transaction, kept short, with no network calls inside?
- Is every schema change compatible with both the old and the new code?
