#!/usr/bin/env node
// Dependency-free sanity checks for src/content/**/*.md.
// Usage: node scripts/check-content.mjs [area ...]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/content/', import.meta.url).pathname;
const navSrc = readFileSync(new URL('../src/lib/content/nav.ts', import.meta.url), 'utf8');
const areas = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(root);

const problems = [];
const report = (file, line, msg) => problems.push(`${file}:${line}  ${msg}`);

// Which topic slugs does nav.ts declare per area?
const declared = {};
for (const m of navSrc.matchAll(
	/slug: '(common|frontend|backend|security)',\n\t\ttitle[\s\S]*?topics: \[([\s\S]*?)\n\t\t\]/g
)) {
	declared[m[1]] = [...m[2].matchAll(/slug: '([a-z0-9-]+)'/g)].map((t) => t[1]);
}

for (const area of areas) {
	for (const slug of declared[area] ?? []) {
		const rel = `${area}/${slug}.md`;
		const path = join(root, rel);
		if (!existsSync(path)) {
			report(rel, 0, 'missing file');
			continue;
		}
		const lines = readFileSync(path, 'utf8').split('\n');
		let i = 0;

		// --- frontmatter ---
		if (lines[0] !== '---') report(rel, 1, 'must start with --- frontmatter');
		const end = lines.indexOf('---', 1);
		const front = lines.slice(1, end);
		const urls = front.filter((l) => /^\s+url:/.test(l)).map((l) => l.split('url:')[1].trim());
		if (urls.length < 3) report(rel, 1, `needs at least 3 sources (has ${urls.length})`);
		for (const u of urls) if (!/^https:\/\/\S+$/.test(u)) report(rel, 1, `bad source url: ${u}`);
		if (new Set(urls).size !== urls.length) report(rel, 1, 'duplicate source url');
		for (const l of front)
			if (/^\s+(title|publisher):\s*.*:\s/.test(l))
				report(rel, 1, `quote YAML value containing ": " -> ${l.trim()}`);

		// --- body ---
		let fence = false;
		let hasBad = false,
			hasGood = false,
			ts = 0;
		for (i = end + 1; i < lines.length; i++) {
			const line = lines[i];
			const f = /^```(\S*)\s*(.*)$/.exec(line);
			if (f) {
				if (!fence) {
					const [, lang, meta] = f;
					if (!lang) report(rel, i + 1, 'code fence without language');
					if (/^(ts|typescript)$/.test(lang)) ts++;
					if (/\bbad\b/.test(meta)) hasBad = true;
					if (/\bgood\b/.test(meta)) hasGood = true;
					if (/\b(bad|good)\b/.test(meta) && !/title="/.test(meta))
						report(rel, i + 1, 'bad/good fence needs title="..."');
				}
				fence = !fence;
				continue;
			}
			if (fence) continue;
			const prose = line.replace(/`[^`]*`/g, ''); // drop inline code
			if (/[{}]/.test(prose)) report(rel, i + 1, 'raw { or } in prose (put it in `inline code`)');
			if (/<[A-Za-z\/!]/.test(prose))
				report(rel, i + 1, 'raw < in prose (put it in `inline code`)');
		}
		if (fence) report(rel, lines.length, 'unclosed code fence');
		if (!hasBad) report(rel, 0, 'no ```bad``` example');
		if (!hasGood) report(rel, 0, 'no ```good``` example');
		if (ts < 2) report(rel, 0, `needs at least 2 TypeScript blocks (has ${ts})`);
		if (lines.length < 80) report(rel, 0, `too short (${lines.length} lines)`);
	}
}

if (problems.length) {
	console.log(problems.join('\n'));
	console.log(`\n${problems.length} problem(s)`);
	process.exit(1);
}
console.log('content OK');
