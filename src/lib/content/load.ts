import type { Component } from 'svelte';
import type { Source } from './nav';

type Doc = {
	default: Component;
	metadata?: { sources?: Source[] };
};

const docs = import.meta.glob<Doc>('/src/content/*/*.md');

export async function loadDoc(area: string, topic: string) {
	const loader = docs[`/src/content/${area}/${topic}.md`];
	if (!loader) return undefined;
	const doc = await loader();
	return { Content: doc.default, sources: doc.metadata?.sources ?? [] };
}
