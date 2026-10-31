<script lang="ts">
	import { areas } from '#lib/content/nav.ts';

	const total = areas.reduce((n, a) => n + a.topics.length, 0);
</script>

<svelte:head>
	<title>Architecture Walkthrough</title>
	<meta
		name="description"
		content="A practical guide to frontend, backend and security architecture for frontend developers, with TypeScript examples."
	/>
</svelte:head>

<article class="prose">
	<h1>Architecture Walkthrough</h1>
	<p class="lead">
		A practical guide for frontend developers who want to understand how whole web applications are
		designed: the browser side, the server side, and what keeps both safe.
	</p>

	<h2>How this guide works</h2>
	<ul>
		<li>
			<strong>{total} short topics</strong> in four areas. Each one answers a single question.
		</li>
		<li>
			<strong>Every idea comes with a reason.</strong> We explain what problem a technique solves before
			recommending it, and we avoid jargon we have not defined.
		</li>
		<li>
			<strong>Bad examples are shown next to good ones</strong>, labelled clearly, so you can
			recognise the bad version when you meet it in real code.
		</li>
		<li>
			<strong>All code is TypeScript</strong>, on both frontend and backend. Component examples use
			Svelte 5; the concepts carry over to React and Vue.
		</li>
		<li>
			<strong>Each page ends with sources</strong>: official documentation, OWASP, MDN, and widely
			respected engineering articles, for when you want to go deeper.
		</li>
	</ul>

	<h2>Choose an area</h2>
	<div class="cards">
		{#each areas as area (area.slug)}
			<a class="card" href="/{area.slug}">
				<h3>{area.title}</h3>
				<p>{area.summary}</p>
				<small>{area.topics.length} topics</small>
			</a>
		{/each}
	</div>

	<h2>Suggested path</h2>
	<ol>
		<li>
			Start with <a href="/common/what-is-architecture">what architecture actually is</a>, so the
			vocabulary is shared.
		</li>
		<li>
			Read the <a href="/frontend">frontend</a> area, since this is the ground you already know. Notice
			which topics are new to you.
		</li>
		<li>
			Continue with <a href="/backend">backend</a>, where the same ideas (layers, contracts, error
			handling) reappear in a different setting.
		</li>
		<li>
			Finish with <a href="/security">security</a>. It refers back to earlier pages, because most
			vulnerabilities are architectural mistakes, not exotic attacks.
		</li>
	</ol>
</article>
