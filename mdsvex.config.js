import { defineMDSveXConfig } from 'mdsvex';
import Prism from 'prismjs';
import loadLanguages from 'prismjs/components/index.js';

loadLanguages([
	'typescript',
	'bash',
	'json',
	'sql',
	'yaml',
	'http',
	'diff',
	'docker',
	'markup',
	'css',
	'markdown'
]);

/** @type {Record<string, string>} */
const ALIASES = {
	ts: 'typescript',
	md: 'markdown',
	sh: 'bash',
	shell: 'bash',
	svelte: 'markup',
	html: 'markup'
};

/** Characters Svelte would otherwise interpret inside Markdown output. */
/** @param {string} s */
const escapeSvelte = (s) =>
	s
		.replace(/\{/g, '&#123;')
		.replace(/\}/g, '&#125;')
		.replace(/`/g, '&#96;')
		.replace(/\\/g, '&#92;');

/** @param {string} s */
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Fence meta syntax:  ```ts bad title="String-built SQL"
 * `bad` / `good` add a coloured label so anti-patterns are never mistaken for advice.
 *
 * @param {string} code
 * @param {string | null | undefined} lang
 * @param {string | null | undefined} meta
 * @returns {string}
 */
function highlighter(code, lang, meta) {
	meta = meta ?? '';
	const language = ALIASES[lang ?? ''] ?? lang ?? '';
	const grammar = Prism.languages[language];
	const html = grammar ? Prism.highlight(code, grammar, language) : escapeHtml(code);

	const kind = /\bbad\b/.test(meta) ? 'bad' : /\bgood\b/.test(meta) ? 'good' : '';
	const title = /title="([^"]*)"/.exec(meta)?.[1] ?? '';
	const label = kind === 'bad' ? 'Bad' : kind === 'good' ? 'Good' : '';

	const caption =
		label || title
			? `<figcaption>${label ? `<strong class="tag">${label}</strong>` : ''}${escapeHtml(title)}</figcaption>`
			: '';

	return escapeSvelte(
		`<figure class="code ${kind}">${caption}<pre class="language-${language || 'text'}" tabindex="0"><code>${html}</code></pre></figure>`
	);
}

export default defineMDSveXConfig({
	extensions: ['.svx', '.md'],
	highlight: { highlighter }
});
