import type { Property } from '../../api';
import type { SimProperty } from '../../mocks/maldives';

export function toSimProperty(p: Property): SimProperty {
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
