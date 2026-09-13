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

export interface StakeVerificationInput {
  readonly transactionId: string;
  readonly providerRoot: string;
  readonly providerAddress: string;
  readonly amountTinybars: string;
}

export interface StakeVerifier {
  verify(input: StakeVerificationInput): Promise<void>;
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
const STAKE_PROVIDER_INTERFACE = new Interface(["function stakeProvider(bytes32 providerRoot) payable"]);
const POST_BOND_SELECTOR = POST_BOND_INTERFACE.getFunction("postBond")?.selector;
const POST_BOND_WITH_EXPIRY_SELECTOR = POST_BOND_WITH_EXPIRY_INTERFACE.getFunction("postBondWithExpiry")?.selector;
const STAKE_PROVIDER_SELECTOR = STAKE_PROVIDER_INTERFACE.getFunction("stakeProvider")?.selector;
const MIRROR_RETRY_ATTEMPTS = 5;
const MIRROR_RETRY_DELAY_MS = 500;

export class MirrorBondVerifier implements BondVerifier {
  private readonly baseUrl: string;
  private readonly escrowContractId: string;

  public constructor(
    mirrorNodeBaseUrl: string,
    escrowContractId: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    const normalized = normalizeMirrorNodeBaseUrl(mirrorNodeBaseUrl);
    const normalizedContractId = escrowContractId.trim();
    if (!normalizedContractId) throw new Error("VERITY_ESCROW_CONTRACT_ID_MISSING: set the deployed escrow contract ID");
    if (!/^0\.0\.\d+$/.test(normalizedContractId)) throw new Error("VERITY_ESCROW_CONTRACT_ID_INVALID: use a Hedera contract ID in 0.0.N format");
    this.escrowContractId = normalizedContractId;
    this.baseUrl = normalized;
  }

  public async verify(input: BondVerificationInput): Promise<void> {
    const transactionId = toMirrorTransactionId(input.transactionId);
    const value = await readContractResult(
      `${this.baseUrl}/contracts/results/${encodeURIComponent(transactionId)}`,
      input.transactionId,
      this.fetchImpl,
      "VERITY_BOND"
    );
    if (value.result !== "SUCCESS") throw new Error(`VERITY_BOND_NOT_VERIFIED: transaction ${input.transactionId} did not succeed`);
    if (value.contract_id !== this.escrowContractId) throw new Error("VERITY_BOND_CONTRACT_MISMATCH: bond transaction targeted another contract");
    if (!await mirrorCallerMatches(this.baseUrl, String(value.from), input.buyerAddress, this.fetchImpl)) throw new Error("VERITY_BOND_CALLER_MISMATCH: bond was not posted by the buyer address");
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

export class MirrorStakeVerifier implements StakeVerifier {
  private readonly baseUrl: string;

  public constructor(
    mirrorNodeBaseUrl: string,
    private readonly escrowContractId: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    const normalized = normalizeMirrorNodeBaseUrl(mirrorNodeBaseUrl);
    if (!escrowContractId.trim()) throw new Error("VERITY_ESCROW_CONTRACT_ID_MISSING: set the deployed escrow contract ID");
    if (!/^0\.0\.\d+$/.test(escrowContractId)) throw new Error("VERITY_ESCROW_CONTRACT_ID_INVALID: use a Hedera contract ID in 0.0.N format");
    this.baseUrl = normalized;
  }

  public async verify(input: StakeVerificationInput): Promise<void> {
    const transactionId = toMirrorTransactionId(input.transactionId);
    const value = await readContractResult(
      `${this.baseUrl}/contracts/results/${encodeURIComponent(transactionId)}`,
      input.transactionId,
      this.fetchImpl,
      "VERITY_STAKE"
    );
    if (value.result !== "SUCCESS") throw new Error(`VERITY_STAKE_NOT_VERIFIED: transaction ${input.transactionId} did not succeed`);
    if (value.contract_id !== this.escrowContractId) throw new Error("VERITY_STAKE_CONTRACT_MISMATCH: stake transaction targeted another contract");
    if (!await mirrorCallerMatches(this.baseUrl, String(value.from), input.providerAddress, this.fetchImpl)) throw new Error("VERITY_STAKE_CALLER_MISMATCH: stake was not posted by the provider address");
    if (String(value.amount) !== input.amountTinybars) throw new Error("VERITY_STAKE_AMOUNT_MISMATCH: posted amount does not match the provider stake");
    if (typeof value.function_parameters !== "string") throw new Error("VERITY_STAKE_PARAMETERS_MISSING: contract result omitted function parameters");
    const functionParameters = value.function_parameters.toLowerCase();
    if (!STAKE_PROVIDER_SELECTOR || !functionParameters.startsWith(STAKE_PROVIDER_SELECTOR.toLowerCase())) {
      throw new Error("VERITY_STAKE_FUNCTION_MISMATCH: transaction was not a stakeProvider call");
    }
    let decoded: readonly unknown[];
    try {
      decoded = STAKE_PROVIDER_INTERFACE.decodeFunctionData("stakeProvider", value.function_parameters) as unknown as readonly unknown[];
    } catch (error) {
      throw new Error("VERITY_STAKE_FUNCTION_MISMATCH: transaction was not a valid stakeProvider call", { cause: error });
    }
    if (String(decoded[0]).toLowerCase() !== bytes32Hex(input.providerRoot).toLowerCase()) {
      throw new Error("VERITY_STAKE_ARGUMENT_MISMATCH: stake provider root does not match the registry record");
    }
  }
}

async function readContractResult(
  url: string,
  transactionId: string,
  fetchImpl: typeof fetch,
  label: "VERITY_BOND" | "VERITY_STAKE"
): Promise<ContractResult> {
  let lastFailure = "Mirror Node did not return a successful contract result";
  for (let attempt = 1; attempt <= MIRROR_RETRY_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(url);
    const raw = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      lastFailure = "Mirror Node returned invalid JSON";
      if (attempt === MIRROR_RETRY_ATTEMPTS) {
        throw new Error(`${label}_MIRROR_JSON: ${lastFailure}`, { cause: error });
      }
      await waitForMirrorRetry(attempt);
      continue;
    }
    if (response.ok && isContractResult(value)) return value;
    lastFailure = response.ok ? "Mirror Node returned an invalid contract result" : `Mirror Node returned HTTP ${response.status}`;
    if (attempt < MIRROR_RETRY_ATTEMPTS) await waitForMirrorRetry(attempt);
  }
  throw new Error(`${label}_NOT_VERIFIED: ${lastFailure} for ${transactionId}`);
}

async function waitForMirrorRetry(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, MIRROR_RETRY_DELAY_MS * attempt));
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

function normalizeMirrorEvmAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized) && !/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("VERITY_MIRROR_EVM_ADDRESS_INVALID: expected a 20-byte address or a left-padded 32-byte address");
  }
  const address = `0x${normalized.slice(-40)}`;
  if (normalized.length === 66 && !/^0x0{24}/.test(normalized)) {
    throw new Error("VERITY_MIRROR_EVM_ADDRESS_INVALID: 32-byte address was not left padded");
  }
  return address;
}

async function mirrorCallerMatches(baseUrl: string, mirrorCaller: string, configuredAddress: string, fetchImpl: typeof fetch): Promise<boolean> {
  const caller = normalizeMirrorEvmAddress(mirrorCaller);
  const configured = normalizeMirrorEvmAddress(configuredAddress);
  if (caller === configured) return true;
  const response = await fetchImpl(`${baseUrl}/accounts/${encodeURIComponent(configured)}`);
  if (!response.ok) return false;
  let value: unknown;
  try {
    value = JSON.parse(await response.text());
  } catch (error) {
    throw new Error("VERITY_CALLER_ACCOUNT_MIRROR_JSON: Mirror Node returned invalid account JSON", { cause: error });
  }
  if (!value || typeof value !== "object") return false;
  const account = value as { account?: unknown; evm_address?: unknown };
  if (typeof account.account !== "string" || typeof account.evm_address !== "string") return false;
  if (normalizeMirrorEvmAddress(account.evm_address) !== configured) return false;
  return caller === solidityAddressFromAccountId(account.account);
}

function solidityAddressFromAccountId(value: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) throw new Error("VERITY_MIRROR_ACCOUNT_ID_INVALID: Mirror Node returned an invalid Hedera account ID");
  const shard = BigInt(match[1]);
  const realm = BigInt(match[2]);
  const number = BigInt(match[3]);
  if (shard > 0xffffffffn || realm > 0xffffffffffffffffn || number > 0xffffffffffffffffn) {
    throw new Error("VERITY_MIRROR_ACCOUNT_ID_INVALID: Hedera account ID exceeds Solidity address bounds");
  }
  return `0x${shard.toString(16).padStart(8, "0")}${realm.toString(16).padStart(16, "0")}${number.toString(16).padStart(16, "0")}`;
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
