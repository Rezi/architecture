<script lang="ts">
	import type { Source } from '#lib/content/nav.ts';

	let { sources }: { sources: Source[] } = $props();
</script>

{#if sources.length}
	<aside class="sources" aria-labelledby="sources-heading">
		<h2 id="sources-heading">Sources and further reading</h2>
		<ul>
			{#each sources as source (source.url)}
				<li>
					<a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
					<span>{source.publisher}</span>
				</li>
			{/each}
		</ul>
	</aside>
{/if}
