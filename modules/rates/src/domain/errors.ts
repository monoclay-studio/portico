import { BusinessRuleError, ValidationError } from '@portico/kernel';

/** A tax/fee rule (or the data it needs) cannot be applied as configured. 422 with a recovery hint. */
export class TaxConfigurationError extends BusinessRuleError {}

/** Rate plan derivation graph problems (cycle, depth). 400. */
export class DerivationError extends ValidationError {}

/** A pricing structure is incomplete or inconsistent (e.g. missing base amount for a new calendar cell). */
export class PricingError extends BusinessRuleError {}
