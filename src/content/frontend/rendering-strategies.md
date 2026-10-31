---
sources:
  - title: Rendering on the Web
    url: https://web.dev/articles/rendering-on-the-web
    publisher: web.dev
  - title: Page options
    url: https://svelte.dev/docs/kit/page-options
    publisher: SvelteKit docs
  - title: The Perils of Rehydration
    url: https://www.joshwcomeau.com/react/the-perils-of-rehydration/
    publisher: Josh W. Comeau
  - title: Islands architecture
    url: https://www.patterns.dev/vanilla/islands-architecture
    publisher: patterns.dev
---

## The problem: who builds the HTML, and when?

A browser can only show HTML. Every web page, however "app-like", ends up as HTML. The question is **where and when that HTML is produced**. The answer affects how fast users see content, whether search engines can read it, how much you pay for servers, and how complicated your deployment is.

There are three basic answers.

| Strategy                         | HTML is produced...                       | Typical fit                                |
| -------------------------------- | ----------------------------------------- | ------------------------------------------ |
| **CSR** (client-side rendering)  | In the browser, by JavaScript, after load | Logged-in dashboards, tools                |
| **SSR** (server-side rendering)  | On the server, on every request           | Pages that differ per user or change often |
| **SSG** (static site generation) | At build time, once, then served as files | Docs, blogs, marketing pages               |

## CSR: ship an empty page and let JavaScript fill it

The server sends nearly empty HTML plus a JavaScript bundle. The browser downloads it, runs it, fetches data, and only then draws the content.

```text title="What a CSR page looks like before JavaScript runs"
<body><div id="app"></div><script src="/bundle.js"></script></body>
```

Good: simple hosting (static files), fast navigation after the first load, no server to run. Bad: the user stares at a blank screen until the bundle and the data arrive (two sequential waits), crawlers and link previews may see nothing, and slow phones suffer because they must run all that JavaScript.

## SSR: build the page on each request

The server runs your components, produces full HTML, and sends it. The user sees content as soon as the HTML arrives, even before JavaScript loads.

Good: fast first view, content visible to crawlers, per-user pages possible. Costs: you need a server runtime, every request costs server time, and a slow database query now delays the first byte.

## SSG: build every page ahead of time

At build time you render each page once and publish the HTML files to a CDN (a network of servers that serves files from near the user). Nothing runs per request.

Good: fastest and cheapest, very resilient. Cost: content is only as fresh as the last build, and you cannot show per-user content in the HTML (you can add it with JavaScript afterwards).

## Hydration: making server HTML interactive

HTML from SSR or SSG is static: buttons do nothing yet. **Hydration** is the step where the framework's JavaScript loads in the browser, walks the existing HTML, and attaches event handlers and state so the page becomes interactive. It reuses the HTML instead of building it again.

Hydration has one strict rule: the first client render must produce the _same_ HTML the server did. If not, you get mismatches and flicker.

```svelte bad title="Output differs between server and browser"
<p>Now: {new Date().toLocaleTimeString()}</p><p>{window.innerWidth > 800 ? 'Desktop' : 'Mobile'}</p>
```

On the server there is no `window`, and the time differs from the client's by the time the page arrives. The first line mismatches; the second even crashes during SSR.

```svelte good title="Same first render, then adjust in the browser"
<script lang="ts">
	import { onMount } from 'svelte';
	let time = $state('');
	onMount(() => {
		time = new Date().toLocaleTimeString();
	}); // runs only in the browser
</script>

<p>Now: {time || 'loading'}</p>
```

`onMount` runs only in the browser, after hydration. React uses `useEffect` for the same purpose, and Vue uses `onMounted`.

Hydration also has a price: the user can see a button that does not respond until JavaScript has loaded and run. Splitting interactive parts from static ones (the "islands" idea, as in Astro) reduces that cost.

## Mixing strategies per route

You do not pick one for the whole app. SvelteKit lets each route choose with page options:

```ts good title="src/routes/blog/+page.ts"
export const prerender = true; // SSG: render at build time
```

```ts good title="src/routes/dashboard/+layout.ts"
export const ssr = false; // CSR only: behind login, no SEO needed
```

Next.js and Nuxt offer the same per-route choice with different names.

## How to choose

Ask three questions in order:

1. **Does the page differ per user or change every minute?** If no, prefer SSG.
2. **Does it need to be found by search or shared as a link preview?** If yes, you need HTML in the response: SSG or SSR.
3. **Is it behind a login, mostly interactive?** CSR is acceptable and the simplest.

## When NOT to use SSR

If your team has no ability to run and monitor a server, or the app sits behind authentication and nobody needs to crawl it, SSR adds operations work for little visible gain. Likewise do not use SSG for data that must be live (stock levels, balances).

> Key takeaway: choose per route by freshness and visibility needs. Default to the most static option that works.

## Checklist

- For each route, do you know whether it is CSR, SSR or SSG, and why?
- Do public pages return real content in their HTML?
- Does any code read `window` or the clock during the first render?
- Is the cost of hydration (JavaScript size) tracked on content-heavy pages?
