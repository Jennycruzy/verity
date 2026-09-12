import "dotenv/config";
import { randomUUID } from "node:crypto";
import { buy } from "@verity/sdk";
import { evaluateEntity, evaluateFxRate, type ContentReference, type DeterministicVerdict, type EntityObservation, type FxRateObservation } from "@verity/types";
import { createSettlementCoordinator } from "@verity/settlement";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";

const url = required("VERITY_DEMO_PROVIDER_URL");
const rule = required("VERITY_DEMO_RULE");
const providerId = required("VERITY_DEMO_PROVIDER_ID");
const buyerId = required("VERITY_DEMO_BUYER_ROOT");
const requestId = randomUUID();
const coordinator = createSettlementCoordinator();
try {
  const demoIdentityProof = optionalJsonObject("VERITY_DEMO_IDENTITY_PROOF_JSON");
  const demoProviderResponses = optionalJsonReferences("VERITY_DEMO_PROVIDER_RESPONSES_JSON");
  const result = await buy(url, {
    evaluate: (value: unknown) => evaluateDemoValue(rule, value),
    evaluationInput: (value: unknown) => demoEvaluationInput(rule, value),
    maxPrice: process.env.VERITY_DEMO_MAX_PRICE,
    bond: process.env.VERITY_DEMO_BOND,
    disputeUrl: process.env.VERITY_DISPUTE_URL,
    requestId,
    ...(process.env.VERITY_DEMO_PROVIDER_ROOT?.trim() ? { providerRoot: process.env.VERITY_DEMO_PROVIDER_ROOT.trim() } : {}),
    ...(demoIdentityProof ? { identityProof: demoIdentityProof, identitySignal: required("VERITY_DEMO_IDENTITY_SIGNAL") } : {}),
    ...(demoProviderResponses ? { providerResponses: demoProviderResponses } : {}),
    settle: async (paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> => {
      const outcome = await coordinator.settleAccepted({
        requestId,
        providerId,
        buyerId,
        ruleId: rule === "fx-rate-v1" ? "fx-rate-v1" : "entity-canonical-v1",
        paymentPayload,
        paymentRequirements: requirements
      });
      if (!outcome.transactionId) throw new Error("VERITY_DEMO_TRANSACTION_MISSING: settlement coordinator returned no transaction ID");
      console.log(JSON.stringify({ requestId, hcsTransactionId: outcome.hcsTransactionId }));
      return { success: true, transaction: outcome.transactionId, network: requirements.network };
    }
  });

  console.log(JSON.stringify({ requestId, verdict: result.verdict, settlement: result.settlement, dispute: result.dispute }, null, 2));
} finally {
  coordinator.close();
}

function evaluateDemoValue(ruleId: string, value: unknown): DeterministicVerdict {
  if (ruleId === "fx-rate-v1") return evaluateFxRate(demoFxInput(value));
  if (ruleId === "entity-canonical-v1") return evaluateEntity(demoEntityInput(value));
  throw new Error(`VERITY_DEMO_RULE_UNKNOWN: ${ruleId}`);
}

function demoEvaluationInput(ruleId: string, value: unknown): FxRateObservation | EntityObservation {
  if (ruleId === "fx-rate-v1") return demoFxInput(value);
  if (ruleId === "entity-canonical-v1") return demoEntityInput(value);
  throw new Error(`VERITY_DEMO_RULE_UNKNOWN: ${ruleId}`);
}

function demoFxInput(value: unknown): FxRateObservation {
  if (!value || typeof value !== "object") throw new Error("VERITY_DEMO_RESPONSE: provider returned a non-object JSON response");
  const record = value as Record<string, unknown>;
  const toleranceBps = Number(required("VERITY_DEMO_FX_TOLERANCE_BPS"));
  if (typeof record.rate !== "string") throw new Error("VERITY_DEMO_RESPONSE: FX provider did not return rate");
  return { expectedRate: required("VERITY_DEMO_EXPECTED_FX_RATE"), actualRate: record.rate, toleranceBps };
}

function demoEntityInput(value: unknown): EntityObservation {
  if (!value || typeof value !== "object") throw new Error("VERITY_DEMO_RESPONSE: provider returned a non-object JSON response");
  const record = value as Record<string, unknown>;
  if (typeof record.entity !== "string") throw new Error("VERITY_DEMO_RESPONSE: entity provider did not return entity");
  return { expected: required("VERITY_DEMO_EXPECTED_ENTITY"), actual: record.entity };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required`);
  return value;
}

function optionalJsonObject(name: string): Readonly<Record<string, unknown>> | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must contain valid JSON`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`VERITY_CONFIG_INVALID: ${name} must contain a JSON object`);
  return value as Readonly<Record<string, unknown>>;
}

function optionalJsonReferences(name: string): readonly ContentReference[] | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must contain valid JSON`, { cause: error });
  }
  if (!Array.isArray(value)) throw new Error(`VERITY_CONFIG_INVALID: ${name} must contain a JSON array`);
  return value as readonly ContentReference[];
}
