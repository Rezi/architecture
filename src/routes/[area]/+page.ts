import { error } from '@sveltejs/kit';
import { areas, getArea } from '#lib/content/nav.ts';

export const entries = () => areas.map((a) => ({ area: a.slug }));

export function load({ params }) {
	const area = getArea(params.area);
	if (!area) error(404, 'Unknown area');
	return { area };
}
