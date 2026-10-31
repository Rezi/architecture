export type Topic = {
	slug: string;
	title: string;
	summary: string;
};

export type Area = {
	slug: 'common' | 'frontend' | 'backend' | 'security';
	title: string;
	summary: string;
	topics: Topic[];
};

/**
 * Single source of truth for the guide structure and ordering.
 * Every topic has a matching Markdown file: src/content/<area>/<topic>.md
 * (a unit test enforces this).
 */
export const areas: Area[] = [
	{
		slug: 'common',
		title: 'Common architecture',
		summary:
			'Ideas that apply on both sides of the network: trade-offs, boundaries, contracts and feedback loops.',
		topics: [
			{
				slug: 'what-is-architecture',
				title: 'What architecture actually is',
				summary: 'Decisions that are expensive to change, quality attributes, trade-offs and ADRs.'
			},
			{
				slug: 'separation-of-concerns',
				title: 'Separation of concerns, coupling and cohesion',
				summary: 'The one idea behind most "clean" code, with a before and after.'
			},
			{
				slug: 'layering-and-boundaries',
				title: 'Layers, boundaries and dependency direction',
				summary:
					'Keep business rules independent of frameworks, databases and UI (ports and adapters).'
			},
			{
				slug: 'api-contracts',
				title: 'API contracts between FE and BE',
				summary: 'Contract-first design, shared types, error shapes and safe evolution.'
			},
			{
				slug: 'monolith-vs-distributed',
				title: 'Monolith, modular monolith or microservices',
				summary: 'What each costs you and how to choose without following hype.'
			},
			{
				slug: 'observability',
				title: 'Logs, metrics and traces',
				summary: 'How to find out what your system is doing in production.'
			},
			{
				slug: 'testing-strategy',
				title: 'Testing strategy',
				summary: 'What to test at which level, and why more tests is not the goal.'
			}
		]
	},
	{
		slug: 'frontend',
		title: 'Frontend architecture',
		summary:
			'Structuring a browser application so it stays understandable, fast and accessible as it grows.',
		topics: [
			{
				slug: 'project-structure',
				title: 'Project structure',
				summary: 'Feature folders versus type folders, and public module surfaces.'
			},
			{
				slug: 'components',
				title: 'Component design',
				summary: 'Composition, props down / events up, smart versus presentational components.'
			},
			{
				slug: 'state-management',
				title: 'State management',
				summary: 'Local, shared, server and URL state: put each kind in the right place.'
			},
			{
				slug: 'data-fetching',
				title: 'Data fetching and the API layer',
				summary: 'A typed client, loading and error states, caching and race conditions.'
			},
			{
				slug: 'rendering-strategies',
				title: 'Rendering strategies: CSR, SSR, SSG',
				summary: 'Where HTML is produced, what hydration is, and how to pick.'
			},
			{
				slug: 'performance',
				title: 'Performance',
				summary: 'Core Web Vitals, bundle size, code splitting and measuring before optimising.'
			},
			{
				slug: 'forms-and-validation',
				title: 'Forms and validation',
				summary: 'Client validation is UX, server validation is security. Do both from one schema.'
			},
			{
				slug: 'error-handling',
				title: 'Error handling and resilience',
				summary: 'Error boundaries, typed errors, retries and graceful degradation.'
			},
			{
				slug: 'accessibility',
				title: 'Accessibility as architecture',
				summary: 'Semantic HTML, keyboard support and focus management from the start.'
			}
		]
	},
	{
		slug: 'backend',
		title: 'Backend architecture',
		summary: 'Building services that are correct, testable, observable and able to grow.',
		topics: [
			{
				slug: 'layered-architecture',
				title: 'Layered architecture',
				summary: 'Thin handlers, services with business rules and repositories for data access.'
			},
			{
				slug: 'dependency-injection',
				title: 'Dependency injection and testability',
				summary: 'Pass dependencies in instead of importing them, with no framework required.'
			},
			{
				slug: 'api-design',
				title: 'REST API design',
				summary: 'Resources, status codes, pagination, idempotency and versioning.'
			},
			{
				slug: 'validation-and-errors',
				title: 'Validation and error handling',
				summary: 'Validate at the boundary, model errors explicitly and return Problem Details.'
			},
			{
				slug: 'database',
				title: 'Databases, transactions and migrations',
				summary: 'Schema design, indexes, N+1 queries, transactions and safe migrations.'
			},
			{
				slug: 'caching',
				title: 'Caching',
				summary: 'HTTP caching, application caches, invalidation and the stampede problem.'
			},
			{
				slug: 'background-jobs',
				title: 'Background jobs and queues',
				summary: 'Move slow work out of the request, with retries and idempotent handlers.'
			},
			{
				slug: 'reliability',
				title: 'Reliability: timeouts, retries, circuit breakers',
				summary: 'Surviving slow and failing dependencies without making things worse.'
			},
			{
				slug: 'scalability',
				title: 'Scalability and statelessness',
				summary: 'Why stateless services scale horizontally and where state should live instead.'
			}
		]
	},
	{
		slug: 'security',
		title: 'Security',
		summary:
			'The mistakes that cause real breaches, how they work, and the defaults that prevent them.',
		topics: [
			{
				slug: 'principles',
				title: 'Principles and threat modelling',
				summary: 'Least privilege, defence in depth, trust boundaries and STRIDE.'
			},
			{
				slug: 'owasp-top-10',
				title: 'OWASP Top 10 in practice',
				summary: 'What each category means for a web developer, with one-line fixes.'
			},
			{
				slug: 'authentication',
				title: 'Authentication',
				summary: 'Password hashing, sessions versus JWTs, OAuth 2.0 / OIDC and MFA.'
			},
			{
				slug: 'authorization',
				title: 'Authorization and access control',
				summary: 'Roles, ownership checks and the IDOR bug that tops the lists.'
			},
			{
				slug: 'injection-and-xss',
				title: 'Injection and XSS',
				summary: 'SQL injection, cross-site scripting, output encoding and CSP.'
			},
			{
				slug: 'csrf-cors-cookies',
				title: 'CSRF, CORS and cookies',
				summary: 'Three browser mechanisms that are constantly confused with each other.'
			},
			{
				slug: 'secrets-and-config',
				title: 'Secrets and configuration',
				summary: 'Keep secrets out of code, bundles and logs.'
			},
			{
				slug: 'transport-and-headers',
				title: 'HTTPS and security headers',
				summary: 'TLS, HSTS, CSP and the other headers worth setting.'
			},
			{
				slug: 'supply-chain',
				title: 'Dependencies and supply chain',
				summary: 'Lockfiles, audits, install scripts and trusting third-party code.'
			},
			{
				slug: 'api-security',
				title: 'API security',
				summary: 'Rate limiting, mass assignment, SSRF and not leaking data in responses.'
			}
		]
	}
];

export function getArea(slug: string): Area | undefined {
	return areas.find((a) => a.slug === slug);
}

export function getTopic(areaSlug: string, topicSlug: string) {
	const area = getArea(areaSlug);
	const topic = area?.topics.find((t) => t.slug === topicSlug);
	return area && topic ? { area, topic } : undefined;
}

/** All topics in reading order, across areas. */
export const readingOrder = areas.flatMap((area) => area.topics.map((topic) => ({ area, topic })));

export function getNeighbours(areaSlug: string, topicSlug: string) {
	const i = readingOrder.findIndex((e) => e.area.slug === areaSlug && e.topic.slug === topicSlug);
	return {
		prev: i > 0 ? readingOrder[i - 1] : undefined,
		next: i >= 0 && i < readingOrder.length - 1 ? readingOrder[i + 1] : undefined
	};
}

export type Source = {
	title: string;
	url: string;
	publisher: string;
};
