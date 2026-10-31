<script lang="ts">
	import { page } from '$app/state';
	import { areas } from '#lib/content/nav.ts';
</script>

<nav aria-label="Guide contents">
	{#each areas as area (area.slug)}
		{@const active = page.params.area === area.slug}
		<details open={active || page.url.pathname === '/'}>
			<summary>{area.title}</summary>
			<ul>
				{#each area.topics as topic (topic.slug)}
					<li>
						<a
							href="/{area.slug}/{topic.slug}"
							aria-current={page.url.pathname === `/${area.slug}/${topic.slug}`
								? 'page'
								: undefined}
						>
							{topic.title}
						</a>
					</li>
				{/each}
			</ul>
		</details>
	{/each}
</nav>
