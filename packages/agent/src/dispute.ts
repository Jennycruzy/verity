import type { VerifiedRoot } from "./identity.js";

export interface DisputeEligibility {
  readonly buyer: VerifiedRoot;
  readonly bondAmount: string;
}

export function requireDisputeEligibility(buyer: VerifiedRoot | undefined, bondAmount: string | undefined): DisputeEligibility {
  if (!buyer?.root) {
    throw new Error("VERITY_IDENTITY_REQUIRED: a verified human root is required before rejecting a response");
  }
  if (!bondAmount || !/^\d+$/.test(bondAmount) || BigInt(bondAmount) <= 0n) {
    throw new Error("VERITY_NO_BOND: reject() requires a positive bond amount");
  }
  return { buyer, bondAmount };
}
