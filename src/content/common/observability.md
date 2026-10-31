---
sources:
  - title: Monitoring Distributed Systems
    url: https://sre.google/sre-book/monitoring-distributed-systems/
    publisher: Google SRE Book
  - title: Observability primer
    url: https://opentelemetry.io/docs/concepts/observability-primer/
    publisher: OpenTelemetry
  - title: Logging Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
    publisher: OWASP
  - title: XI. Logs (The Twelve-Factor App)
    url: https://12factor.net/logs
    publisher: 12factor.net
---

## The problem: "it works on my machine" is not production

A user says "checkout is broken". You cannot attach a debugger to their browser or to the server at the moment it failed. Without data recorded in advance, all you can do is guess and try to reproduce.

**Observability** is the ability to understand what your system is doing, and why, from the data it emits, including for questions you did not think of in advance. It is built from three kinds of data (the "three pillars"), each good at a different question.

| Signal      | What it is                                                | Answers                                    |
| ----------- | --------------------------------------------------------- | ------------------------------------------ |
| **Logs**    | Timestamped records of events                             | What exactly happened in this case?        |
| **Metrics** | Numbers aggregated over time (counts, rates, percentiles) | Is something wrong, and how bad?           |
| **Traces**  | The path of one request across components, with timings   | Where did the time or the error come from? |

Typical flow: a metric alert says "error rate is up", a trace shows the slow or failing call, logs tell you the details.

## Logs: structured, not sentences

```ts bad title="Free-text log lines"
console.log('Order failed for user ' + user.email + ' with card ' + card.number);
console.log('error: ' + err);
```

Problems: you cannot filter by user or order id without fragile text search, `'error: ' + err` drops the stack trace, and the line writes an e-mail and a card number into a log store that many people can read (see the [OWASP logging guidance](/security/secrets-and-config) on what must never be logged).

```ts good title="Structured JSON with context and no secrets"
import pino from 'pino';
const log = pino();

log.error({ err, orderId: order.id, userId: user.id, requestId }, 'order payment failed');
// {"level":50,"msg":"order payment failed","orderId":"o_81","userId":"u_12","requestId":"r_9f3", ...}
```

Why this is better: logs become queryable records. Use levels deliberately: `error` means someone should look, `warn` is odd but handled, `info` is business events, `debug` is off in production. Write logs to standard output and let the platform collect them, as the twelve-factor guidance says.

## Correlation ids: one request, many log lines

A **correlation id** (request id) is a random id created at the edge and attached to every log line and downstream call. Then "show me everything for this failed request" is one search.

```ts good title="Express-style middleware, plus the FE sending it along"
import { randomUUID } from 'node:crypto';

app.use((req, res, next) => {
	const requestId = req.header('x-request-id') ?? randomUUID();
	res.setHeader('x-request-id', requestId);
	req.log = log.child({ requestId });
	next();
});
```

```ts title="FE: include the id from the failed response in the error report"
const res = await fetch('/api/checkout', { method: 'POST', body });
if (!res.ok) reportError({ status: res.status, requestId: res.headers.get('x-request-id') });
```

Now a support ticket that says "failed at 14:03, request r_9f3" leads straight to the server logs.

## Metrics: watch what users feel

Do not start with CPU graphs. Start with what a user experiences. Google's SRE book names the "four golden signals":

- **Latency**: how long requests take (look at the 95th or 99th percentile, not the average, which hides slow outliers).
- **Traffic**: how many requests.
- **Errors**: the share that fail.
- **Saturation**: how full the system is (queue length, connections used).

```ts good title="Counting and timing in the handler (prom-client style)"
const duration = new Histogram({
	name: 'http_request_seconds',
	help: 'Request time',
	labelNames: ['route', 'status']
});

app.use((req, res, next) => {
	const end = duration.startTimer();
	res.on('finish', () =>
		end({ route: req.route?.path ?? 'unknown', status: String(res.statusCode) })
	);
	next();
});
```

One trap: **never use unbounded values as labels** (user id, full URL with ids). Every distinct value creates a new time series, and the metrics system gets slow and expensive. Use the route template, not the raw URL.

## Traces: following a request across services

A **trace** is a tree of timed steps (called spans) for one request: browser call, API handler, database query, call to another service. It shows that 900 ms of a 1 s request were one slow SQL query. OpenTelemetry is the vendor-neutral standard for emitting traces, metrics and logs, and it propagates a trace id through a header (`traceparent`), so you rarely need to build this yourself. Traces matter most once you have [several services](/common/monolith-vs-distributed); in a single monolith, logs with a request id often suffice.

## On the frontend

The browser is part of your system too. Capture unhandled errors and failed fetches, and measure real-user performance (the Core Web Vitals) so you learn about problems before users complain. Sampling and privacy matter here: do not send personal data to third-party tools without a lawful basis.

## Alerts: few, actionable

Alert on **symptoms** ("checkout error rate above 2 percent for 5 minutes"), not causes ("CPU above 80 percent"). An alert nobody can act on trains the team to ignore all alerts.

## Checklist

- Are logs structured JSON with request id, and free of passwords, tokens and card data?
- Can you find every log line for one failed request in under a minute?
- Do you track latency percentiles, traffic, error rate and saturation for key endpoints?
- Are metric labels bounded (route templates, not raw ids)?
- Does the FE report errors with the server's request id?
- Does every alert have a clear action a human can take?
