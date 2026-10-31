import { error } from '@sveltejs/kit';
import { loadDoc } from '#lib/content/load.ts';
import { getNeighbours, getTopic, readingOrder } from '#lib/content/nav.ts';

export const entries = () =>
	readingOrder.map(({ area, topic }) => ({ area: area.slug, topic: topic.slug }));

export async function load({ params }) {
	const found = getTopic(params.area, params.topic);
	if (!found) error(404, 'Unknown topic');

	const doc = await loadDoc(params.area, params.topic);
	if (!doc) error(404, 'This topic has no content yet');

	return { ...found, ...doc, ...getNeighbours(params.area, params.topic) };
}
