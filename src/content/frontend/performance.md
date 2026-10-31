---
sources:
  - title: Web Vitals
    url: https://web.dev/articles/vitals
    publisher: web.dev
  - title: Interaction to Next Paint (INP)
    url: https://web.dev/articles/inp
    publisher: web.dev
  - title: Optimize long tasks
    url: https://web.dev/articles/optimize-long-tasks
    publisher: web.dev
  - title: Lazy loading
    url: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Lazy_loading
    publisher: MDN
  - title: Analyze runtime performance
    url: https://developer.chrome.com/docs/devtools/performance
    publisher: Chrome for Developers
---

## The problem: "it feels slow" is not a measurement

Performance work goes wrong in two ways: nobody does it until users complain, or people optimise things that were never slow. The fix for both is the same order of work: **measure, find the biggest cost, fix that, measure again.**

## What to measure: the Web Vitals

Google defines a small set of user-centred measurements called **Core Web Vitals**. Each one measures something a person actually feels:

| Metric                              | In plain words                                                                 | Good target    |
| ----------------------------------- | ------------------------------------------------------------------------------ | -------------- |
| **LCP** (Largest Contentful Paint)  | How long until the biggest thing on screen (hero image, headline) has appeared | 2.5 s or less  |
| **INP** (Interaction to Next Paint) | After a click or key press, how long until the screen visibly responds         | 200 ms or less |
| **CLS** (Cumulative Layout Shift)   | How much the page jumps around while loading                                   | 0.1 or less    |

Check them at the 75th percentile of real users, not on your fast laptop. Lab tools (Lighthouse, DevTools) help you debug; real-user data (the Chrome UX Report, or your own measurement) tells you what is true.

You can collect them yourself with the browser's performance API:

```ts title="lib/vitals.ts"
export function reportLcp(send: (name: string, value: number) => void) {
	new PerformanceObserver((list) => {
		const last = list.getEntries().at(-1);
		if (last) send('LCP', last.startTime);
	}).observe({ type: 'largest-contentful-paint', buffered: true });
}
```

In practice the `web-vitals` library wraps all of this and handles edge cases.

## Bundle size: less JavaScript is the best fix

JavaScript is the most expensive kind of byte: it must be downloaded, parsed and executed, which is slow on mid-range phones. A **bundle** is the file(s) your build tool produces from your code and its dependencies.

```ts bad title="Importing a whole library for one function"
import _ from 'lodash'; // pulls in ~70 kB of code you never call
const names = _.uniq(users.map((u) => u.name));
```

```ts good title="Native or narrow imports"
const names = [...new Set(users.map((u) => u.name))];
// or: import uniq from 'lodash-es/uniq'; (only that function is included)
```

Before adding a dependency, check its cost (bundlephobia, or your bundler's analyser) and ask if the platform already does it. Dates, for example, are often pulled in as a 200 kB library for one `format()` call that `Intl.DateTimeFormat` handles.

## Code splitting: load code when it is needed

**Code splitting** means breaking the bundle into several files and loading each only when needed, so the first page does not pay for the admin panel. The tool is the dynamic `import()`, which returns a promise.

```ts good title="Load a heavy editor only when the user opens it"
let editorModule: Promise<typeof import('./richEditor')> | undefined;

export function openEditor() {
	editorModule ??= import('./richEditor'); // downloaded on first click only
	return editorModule;
}
```

Frameworks split by route automatically (SvelteKit and Next.js do). Split manually for large, rarely used things: chart libraries, editors, PDF export, maps.

Trade-off: a split piece costs a network request when first used, so the user may wait on click. Preload it on hover or when idle if that matters.

## Images and layout shift

Images are usually the heaviest and the cause of both LCP and CLS problems.

```svelte bad title="No dimensions, everything loads at once"
<img src="/hero-4000px.jpg" />
<img src="/below-the-fold.jpg" />
```

The browser does not know the image size, so it reserves no space and the text below jumps when it arrives (layout shift). A 4000 px photo is also sent to a phone.

```svelte good title="Reserve space, size it, defer what is off screen"
<img
	src="/hero-800.jpg"
	srcset="/hero-800.jpg 800w, /hero-1600.jpg 1600w"
	sizes="100vw"
	width="800"
	height="450"
	fetchpriority="high"
	alt="Team at work"
/>
<img src="/below-the-fold.jpg" width="800" height="450" loading="lazy" alt="" />
```

`width` and `height` let the browser reserve space, `srcset` lets it pick a suitable file, `loading="lazy"` delays off-screen images, and `fetchpriority="high"` tells it the hero matters most.

## Rendering cost on the main thread

The browser runs your JavaScript and handles clicks on one thread. A **long task** (over 50 ms of continuous work) blocks clicks and hurts INP. Typical causes: rendering thousands of list rows, or heavy computation. Remedies: render fewer things (pagination, virtualised lists that only create visible rows), and move heavy work to a Web Worker.

Also, be wary of reflexive micro-optimisation (**memoization**, i.e. caching a function's result so it is not recomputed). Modern frameworks such as Svelte need it rarely; apply it only where a profile shows a real cost.

## When NOT to optimise

- Without a measurement showing a problem, leave it. Optimised code is usually more complex.
- Do not chase a perfect Lighthouse score. A fast-enough page that your team can maintain beats a perfect one nobody understands.
- A 5 kB saving on a page that is dominated by a 2 MB hero image is wasted effort. Fix the biggest item first.

> Key takeaway: measure real users, remove or delay JavaScript, size your images, and profile before optimising anything else. Related: [rendering strategies](/frontend/rendering-strategies).

## Checklist

- Do you know your LCP, INP and CLS for real users?
- Is there a bundle size budget checked in CI?
- Are heavy, rarely used features loaded with `import()`?
- Do all images have dimensions, and are off-screen ones lazy?
- Did a profile (not a hunch) justify each optimisation?
