import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { areas, getNeighbours, getTopic, readingOrder } from './nav';

const contentFile = (area: string, topic: string) => `src/content/${area}/${topic}.md`;

describe('guide structure', () => {
	it('has a Markdown file for every topic', () => {
		const missing = readingOrder
			.map(({ area, topic }) => contentFile(area.slug, topic.slug))
			.filter((path) => !existsSync(path));
		expect(missing).toEqual([]);
	});

	it('uses unique slugs inside each area', () => {
		for (const area of areas) {
			const slugs = area.topics.map((t) => t.slug);
			expect(new Set(slugs).size).toBe(slugs.length);
		}
	});

	it('lists only https sources on every page', () => {
		for (const { area, topic } of readingOrder) {
			const text = readFileSync(contentFile(area.slug, topic.slug), 'utf8');
			const urls = [...text.matchAll(/^\s+url:\s*(\S+)/gm)].map((m) => m[1]);
			expect(urls.length, `${area.slug}/${topic.slug} sources`).toBeGreaterThanOrEqual(3);
			for (const url of urls) expect(url).toMatch(/^https:\/\//);
		}
	});
});

describe('navigation helpers', () => {
	it('finds topics and rejects unknown ones', () => {
		expect(getTopic('frontend', 'components')?.topic.title).toBeTruthy();
		expect(getTopic('frontend', 'nope')).toBeUndefined();
	});

	it('links neighbours across area boundaries', () => {
		const last = areas[0].topics.at(-1)!;
		const { next } = getNeighbours(areas[0].slug, last.slug);
		expect(next?.area.slug).toBe(areas[1].slug);
		expect(getNeighbours(areas[0].slug, areas[0].topics[0].slug).prev).toBeUndefined();
	});
});
