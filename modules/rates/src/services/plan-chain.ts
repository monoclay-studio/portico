import type { RatePlanDto } from '../contracts';
import type { DerivationStep } from '../domain/pricing';
import type { PlanChainLink } from '../domain/restrictions';

/** Derivation steps from the base plan down to the last plan of `chain` (root first). */
export function derivationSteps(chain: readonly RatePlanDto[]): DerivationStep[] {
  return chain.slice(1).map((p) => {
    const d = p.derivation as NonNullable<RatePlanDto['derivation']>;
    return {
      ratePlanId: p.id,
      adjustment: d.adjustment,
      rounding: d.rounding,
      unitTypeAdjustments: d.unitTypeAdjustments,
      floorMinor: d.floorMinor,
      ceilingMinor: d.ceilingMinor,
    };
  });
}

/** Restriction inheritance links (root first). */
export function restrictionChain(chain: readonly RatePlanDto[]): PlanChainLink[] {
  return chain.map((p, i) => ({ id: p.id, inheritedKinds: i === 0 ? [] : p.inherit.restrictions }));
}

/** Packages of a plan honouring `inherit.packages` (parent's first, then own; deduplicated). */
export function effectivePackageIds(chain: readonly RatePlanDto[]): string[] {
  const out: string[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const p = chain[i] as RatePlanDto;
    out.unshift(...p.packageIds.filter((id) => !out.includes(id)));
    if (i === 0 || !p.inherit.packages) break;
  }
  return out;
}
