<script lang="ts">
	import Sources from '#lib/components/Sources.svelte';
	import PrevNext from '#lib/components/PrevNext.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let { Content } = $derived(data);
</script>

<svelte:head>
	<title>{data.topic.title} · {data.area.title} · Architecture Walkthrough</title>
	<meta name="description" content={data.topic.summary} />
</svelte:head>

<article class="prose">
	<p class="eyebrow"><a href="/{data.area.slug}">{data.area.title}</a></p>
	<h1>{data.topic.title}</h1>
	<p class="lead">{data.topic.summary}</p>
	<Content />
</article>

<Sources sources={data.sources} />
<PrevNext prev={data.prev} next={data.next} />
