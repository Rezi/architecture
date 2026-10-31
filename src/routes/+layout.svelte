<script lang="ts">
	import '../app.css';
	import SideNav from '#lib/components/SideNav.svelte';
	import favicon from '#lib/assets/favicon.svg';
	import { afterNavigate } from '$app/navigation';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	let menuOpen = $state(false);

	afterNavigate(() => {
		menuOpen = false;
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<a class="skip-link" href="#content">Skip to content</a>

<div class="shell">
	<header class="topbar">
		<a class="brand" href="/">Architecture Walkthrough</a>
		<button
			class="menu-toggle"
			aria-expanded={menuOpen}
			aria-controls="sidebar"
			onclick={() => (menuOpen = !menuOpen)}
		>
			Menu
		</button>
	</header>

	<aside id="sidebar" class:open={menuOpen}>
		<SideNav />
	</aside>

	<main id="content">
		{@render children()}
	</main>
</div>
