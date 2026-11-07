/** What a workspace data source needs to know about the property in view (from platform's property record). */
export interface PropertyContext {
  id: string;
  code: string;
  name: string;
  profile: string;
  businessDate: string;
  timezone: string;
  baseCurrency: string;
}

export function propertyContext(p: PropertyContext): PropertyContext {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    profile: p.profile,
    businessDate: p.businessDate,
    timezone: p.timezone,
    baseCurrency: p.baseCurrency,
  };
}
