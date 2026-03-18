// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Archon',
			description: 'A platform that organizes AI agents like a company.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/LeviathanST/archon' }],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Quick Start', slug: 'getting-started/quick-start' },
						{ label: 'Configuration', slug: 'getting-started/configuration' },
					],
				},
				{
					label: 'Architecture',
					items: [
						{ label: 'Overview', slug: 'architecture/overview' },
						{ label: 'Message Flow', slug: 'architecture/message-flow' },
						{ label: 'Meeting Lifecycle', slug: 'architecture/meeting-lifecycle' },
						{ label: 'Agent System', slug: 'architecture/agent-system' },
						{ label: 'Database Schema', slug: 'architecture/database' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Creating Agents', slug: 'guides/creating-agents' },
						{ label: 'Writing Methodologies', slug: 'guides/methodologies' },
						{ label: 'Running Review Meetings', slug: 'guides/review-meetings' },
					],
				},
				{
					label: 'API Reference',
					autogenerate: { directory: 'reference' },
				},
				{
					label: 'Design',
					items: [
						{ label: 'Philosophy', slug: 'design/philosophy' },
						{ label: 'Decisions (ADRs)', slug: 'design/decisions' },
					],
				},
			],
		}),
	],
});
