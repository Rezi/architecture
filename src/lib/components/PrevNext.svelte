<script lang="ts">
	import type { readingOrder } from '#lib/content/nav.ts';

	type Entry = (typeof readingOrder)[number];
	let { prev, next }: { prev?: Entry; next?: Entry } = $props();
</script>

<nav class="prev-next" aria-label="Previous and next topic">
	{#if prev}
		<a class="prev" href="/{prev.area.slug}/{prev.topic.slug}">
			<small>← Previous</small>
			{prev.topic.title}
		</a>
	{/if}
	{#if next}
		<a class="next" href="/{next.area.slug}/{next.topic.slug}">
			<small>Next →</small>
			{next.topic.title}
		</a>
	{/if}
</nav>
