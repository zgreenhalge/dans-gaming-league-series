/** The Tools section (`/tools`): open sandbox pages anyone can use, with no sign-in and no side
 *  effects — each one only reads league data and computes in the browser. This list drives the
 *  `/tools` index, its sitemap entries and each tool's breadcrumbs; add a tool's page under
 *  `src/app/tools/` and an entry here. */

export interface Tool {
  /** URL segment under `/tools`. */
  slug: string;
  name: string;
  /** One line for the tool's card on the index. */
  summary: string;
}

export const TOOLS: Tool[] = [
  {
    slug: 'schedule-lab',
    name: 'Schedule Lab',
    summary: 'Generate regular-season schedules for any roster and format, and compare them side by side.',
  },
];

export function toolHref(slug: string): string {
  return `/tools/${slug}`;
}

/** Breadcrumbs for a tool page: DGLS › Tools › <tool>. */
export function toolCrumbs(tool: Tool) {
  return [
    { label: 'DGLS', href: '/' },
    { label: 'Tools', href: '/tools' },
    { label: tool.name },
  ];
}

export function getTool(slug: string): Tool {
  const tool = TOOLS.find((t) => t.slug === slug);
  if (!tool) throw new Error(`getTool: no tool "${slug}" in TOOLS`);
  return tool;
}
