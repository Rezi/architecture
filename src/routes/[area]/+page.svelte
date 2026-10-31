<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.area.title} · Architecture Walkthrough</title>
	<meta name="description" content={data.area.summary} />
</svelte:head>

<article class="prose">
	<h1>{data.area.title}</h1>
	<p class="lead">{data.area.summary}</p>

	<ol class="topic-list">
		{#each data.area.topics as topic (topic.slug)}
			<li>
				<a href="/{data.area.slug}/{topic.slug}">{topic.title}</a>
				<span>{topic.summary}</span>
			</li>
		{/each}
	</ol>
</article>
