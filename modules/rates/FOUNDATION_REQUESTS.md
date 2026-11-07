# Foundation requests from rates

## 1. A permission-free property facts provider in platform

**Problem.** Rates needs the property's time zone, country, base currency, check-in time and tax classification
for every quote and tax computation. `platform.getProperty` requires `platform.property.read`, which channel API
clients, the booking engine and many desk roles do not (and should not) hold — they hold `rates.quote.read`.
Today the composition root binds the rates port as `platform.getProperty({ ...tx, authz: systemAuthorizer }, id)`.
That works, but every module needing property facts will repeat this pattern, and widening the authorizer inside
a binding is easy to get wrong.

**Proposed diff (platform):**

```ts
// modules/platform/src/service.ts
/** Facts other modules need to compute (time zone, currency, classification). No permission: callers check their own. */
export async function getPropertyFacts(tx: TxContext, id: string): Promise<Pick<Property,
  'id' | 'countryCode' | 'timezone' | 'baseCurrency' | 'checkInTime' | 'checkOutTime' | 'classification' | 'legalEntityId' | 'businessDate'>> {
  const row = await db(tx).selectFrom('platform.properties').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new NotFoundError('property', id);
  const p = toProperty(row);
  return { id: p.id, countryCode: p.countryCode, timezone: p.timezone, baseCurrency: p.baseCurrency,
           checkInTime: p.checkInTime, checkOutTime: p.checkOutTime, classification: p.classification,
           legalEntityId: p.legalEntityId, businessDate: p.businessDate };
}
```

RLS still confines it to the tenant. Then bind `RatesPorts.getProperty` to it.

## 2. Domain-map update for the rates provider

The additive contract changes listed in `modules/rates/README.md` § "Contract changes" should be copied into
`docs/architecture/domain-map.md` § rates by the orchestrator (agents may not edit docs outside their module).
