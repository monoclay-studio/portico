/**
 * Help anchors → website content. Every screen and complex control has a stable `helpKey`
 * (`<module>.<screen>[.<element>]`). The website's courses and tutorial videos are added HERE (or loaded from
 * the same shape at runtime) without code changes elsewhere. Empty until the website publishes content.
 */
export interface HelpLink {
  article?: string;
  video?: string;
}

export const HELP_LINKS: Readonly<Record<string, HelpLink>> = {};

/** Resolve `a.b.c`, falling back to `a.b` then `a`, so a screen-level article covers its controls. */
export function resolveHelp(
  helpKey: string,
  links: Readonly<Record<string, HelpLink>> = HELP_LINKS,
): HelpLink | null {
  const parts = helpKey.split('.');
  for (let i = parts.length; i > 0; i--) {
    const hit = links[parts.slice(0, i).join('.')];
    if (hit && (hit.article || hit.video)) return hit;
  }
  return null;
}
