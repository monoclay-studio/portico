import axe from 'axe-core';

/**
 * Run axe-core on a rendered container and return violations (WCAG 2.x A/AA rules). Colour contrast cannot be
 * computed in jsdom; it is checked on real screens by the Playwright smoke test.
 */
export async function axeViolations(container: Element): Promise<axe.Result[]> {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations;
}

export function formatViolations(v: axe.Result[]): string {
  return v.map((x) => `${x.id}: ${x.help} (${x.nodes.map((n) => n.target.join(' ')).join(', ')})`).join('\n');
}
