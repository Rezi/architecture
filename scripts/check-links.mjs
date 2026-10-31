#!/usr/bin/env node
// Checks every external source URL in src/content/**/*.md (needs network, Node 18+).
// Usage: node scripts/check-links.mjs
// 403/429 are reported as "blocked" (many sites reject bots); 404/410/5xx and network errors are failures.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/content/', import.meta.url).pathname;
const urls = new Map(); // url -> files
for (const area of readdirSync(root)) {
	for (const file of readdirSync(join(root, area)).filter((f) => f.endsWith('.md'))) {
		const text = readFileSync(join(root, area, file), 'utf8');
		for (const m of text.matchAll(/https:\/\/[^\s)>"'`]+/g)) {
			const url = m[0].replace(/[.,;]+$/, '');
			urls.set(url, [...(urls.get(url) ?? []), `${area}/${file}`]);
		}
	}
}

const headers = { 'user-agent': 'Mozilla/5.0 (link-check; architecture-walkthru)' };
async function check(url) {
	for (const method of ['HEAD', 'GET']) {
		try {
			const res = await fetch(url, {
				method,
				headers,
				redirect: 'follow',
				signal: AbortSignal.timeout(15000)
			});
			if (res.ok) return 'ok';
			if (method === 'GET')
				return res.status === 403 || res.status === 429 ? 'blocked' : `HTTP ${res.status}`;
		} catch (e) {
			if (method === 'GET') return `error: ${e.cause?.code ?? e.message}`;
		}
	}
}

const bad = [];
const queue = [...urls.keys()];
await Promise.all(
	Array.from({ length: 8 }, async () => {
		while (queue.length) {
			const url = queue.pop();
			const result = await check(url);
			if (result !== 'ok') bad.push(`${result.padEnd(14)} ${url}  (${urls.get(url).join(', ')})`);
		}
	})
);

console.log(`${urls.size} unique URLs checked`);
if (bad.length) console.log(bad.sort().join('\n'));
process.exit(bad.some((b) => !b.startsWith('blocked')) ? 1 : 0);
