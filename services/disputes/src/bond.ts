import { Interface } from "ethers";
import { normalizeMirrorNodeBaseUrl, toBytes32 } from "@verity/hcs";

export interface BondVerificationInput {
  readonly transactionId: string;
  readonly disputeId: string;
  readonly providerRoot: string;
  readonly buyerAddress: string;
  readonly amountTinybars: string;
}

export interface BondVerifier {
  verify(input: BondVerificationInput): Promise<void>;
}

interface ContractResult {
  readonly contract_id?: unknown;
  readonly from?: unknown;
  readonly amount?: unknown;
  readonly function_parameters?: unknown;
  readonly result?: unknown;
}

const POST_BOND_INTERFACE = new Interface(["function postBond(bytes32 disputeId, bytes32 providerRoot) payable"]);
const POST_BOND_WITH_EXPIRY_INTERFACE = new Interface(["function postBondWithExpiry(bytes32 disputeId, bytes32 providerRoot, uint256 expiresAt) payable"]);
const POST_BOND_SELECTOR = POST_BOND_INTERFACE.getFunction("postBond")?.selector;
const POST_BOND_WITH_EXPIRY_SELECTOR = POST_BOND_WITH_EXPIRY_INTERFACE.getFunction("postBondWithExpiry")?.selector;

export class MirrorBondVerifier implements BondVerifier {
  private readonly baseUrl: string;

  public constructor(
    mirrorNodeBaseUrl: string,
    private readonly escrowContractId: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    const normalized = normalizeMirrorNodeBaseUrl(mirrorNodeBaseUrl);
    if (!escrowContractId.trim()) throw new Error("VERITY_ESCROW_CONTRACT_ID_MISSING: set the deployed escrow contract ID");
    this.baseUrl = normalized;
  }

  public async verify(input: BondVerificationInput): Promise<void> {
    const transactionId = toMirrorTransactionId(input.transactionId);
    const response = await this.fetchImpl(`${this.baseUrl}/contracts/results/${encodeURIComponent(transactionId)}`);
    const raw = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error("VERITY_BOND_MIRROR_JSON: Mirror Node returned invalid JSON", { cause: error });
    }
    if (!response.ok || !isContractResult(value)) {
      throw new Error(`VERITY_BOND_NOT_VERIFIED: Mirror Node did not return a successful contract result for ${input.transactionId}`);
    }
    if (value.result !== "SUCCESS") throw new Error(`VERITY_BOND_NOT_VERIFIED: transaction ${input.transactionId} did not succeed`);
    if (value.contract_id !== this.escrowContractId) throw new Error("VERITY_BOND_CONTRACT_MISMATCH: bond transaction targeted another contract");
    if (String(value.from).toLowerCase() !== input.buyerAddress.toLowerCase()) throw new Error("VERITY_BOND_CALLER_MISMATCH: bond was not posted by the buyer address");
    if (String(value.amount) !== input.amountTinybars) throw new Error("VERITY_BOND_AMOUNT_MISMATCH: posted amount does not match the dispute bond");
    if (typeof value.function_parameters !== "string") throw new Error("VERITY_BOND_PARAMETERS_MISSING: contract result omitted function parameters");
    const functionParameters = value.function_parameters.toLowerCase();
    let decoded: readonly unknown[];
    let functionName: "postBond" | "postBondWithExpiry";
    try {
      if (POST_BOND_SELECTOR && functionParameters.startsWith(POST_BOND_SELECTOR.toLowerCase())) {
        functionName = "postBond";
        decoded = POST_BOND_INTERFACE.decodeFunctionData(functionName, value.function_parameters) as unknown as readonly unknown[];
      } else if (POST_BOND_WITH_EXPIRY_SELECTOR && functionParameters.startsWith(POST_BOND_WITH_EXPIRY_SELECTOR.toLowerCase())) {
        functionName = "postBondWithExpiry";
        decoded = POST_BOND_WITH_EXPIRY_INTERFACE.decodeFunctionData(functionName, value.function_parameters) as unknown as readonly unknown[];
        assertPositiveExpiry(decoded[2]);
      } else {
        throw new Error("unsupported function selector");
      }
    } catch (error) {
      throw new Error("VERITY_BOND_FUNCTION_MISMATCH: transaction was not a supported bond call", { cause: error });
    }
    if (String(decoded[0]).toLowerCase() !== bytes32Hex(input.disputeId).toLowerCase()
      || String(decoded[1]).toLowerCase() !== bytes32Hex(input.providerRoot).toLowerCase()) {
      throw new Error(`VERITY_BOND_ARGUMENT_MISMATCH: ${functionName} keys do not match the dispute`);
    }
  }
}

export function toMirrorTransactionId(value: string): string {
  const normalized = value.trim();
  const match = /^(\d+\.\d+\.\d+)@(\d+)\.(\d{9})$/.exec(normalized);
  if (match?.[1] && match[2] && match[3]) return `${match[1]}-${match[2]}-${match[3]}`;
  if (/^\d+\.\d+\.\d+-\d+-\d{9}$/.test(normalized)) return normalized;
  throw new Error("VERITY_BOND_TRANSACTION_ID_INVALID: expected a Hedera transaction ID");
}

function bytes32Hex(value: string): string {
  return `0x${Buffer.from(toBytes32(value)).toString("hex")}`;
}

function assertPositiveExpiry(value: unknown): void {
  try {
    if (BigInt(String(value)) <= 0n) throw new Error("expiry is not positive");
  } catch (error) {
    throw new Error("VERITY_BOND_EXPIRY_INVALID: expiring bond call has an invalid expiry", { cause: error });
  }
}

function isContractResult(value: unknown): value is ContractResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ContractResult;
  return typeof candidate.contract_id === "string"
    && typeof candidate.from === "string"
    && (typeof candidate.amount === "number" || typeof candidate.amount === "string")
    && typeof candidate.result === "string";
}
