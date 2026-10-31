# Architecture Walkthrough

A practical, opinionated guide that leads a frontend developer through **common**, **frontend**,
**backend** and **security** architecture. One topic per page, TypeScript examples on both sides,
labelled bad and good code, and links to authoritative sources (MDN, OWASP, RFCs, official docs,
well-known engineers) at the end of every page.

Built from the official `sv` SvelteKit minimal template (TypeScript, Prettier, Vitest, Playwright,
mdsvex), with `adapter-static` so the whole guide is prerendered to plain HTML.

## Run it

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # static site in ./build
pnpm preview
```

## Where things live

| Path                            | What                                                       |
| ------------------------------- | ---------------------------------------------------------- |
| `src/lib/content/nav.ts`        | Areas, topics, titles, summaries and order (single source) |
| `src/content/<area>/<topic>.md` | One Markdown page per topic                                |
| `mdsvex.config.js`              | Code highlighting and the `bad` / `good` block labels      |
| `src/routes/[area]/[topic]`     | The one route that renders every topic                     |
| `scripts/check-content.mjs`     | Linter for content files (no install needed)               |

## Writing or editing a topic

1. Add the topic to `src/lib/content/nav.ts` (this controls the sidebar and the previous/next links).
2. Create `src/content/<area>/<slug>.md`. Start with a `sources` list in the frontmatter; the title and
   summary come from `nav.ts`, so the body starts at an H2.
3. Label examples in the code fence:

   ````md
   ```ts bad title="String-built SQL"

   ```
   ````

   Use `good` for the fixed version. Both need `title="..."`.

4. In prose, never write a bare `{`, `}` or `<tag`; put them in `inline code`, or Svelte will try to
   compile them.
5. Check your work:

   ```sh
   node scripts/check-content.mjs [area]
   pnpm test:unit
   pnpm check
   ```

## Tests

- `pnpm test:unit` verifies that every topic has a page and at least three https sources.
- `pnpm test:e2e` builds the site and walks through the navigation with Playwright.
