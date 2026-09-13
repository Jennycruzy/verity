import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { HttpContentStore } from "@verity/content";
import { FileRootStore, WorldIdVerifier } from "@verity/agent";
import { createSettlementCoordinator } from "@verity/settlement";
import { createDisputeServer } from "./app.js";
import { MirrorBondVerifier } from "./bond.js";
import { HttpCrossChecker } from "./crosschecker.js";
import { readDisputeServiceConfig } from "./config.js";
import { readProviderRegistryFromHcs } from "./registry.js";
import { DisputeProcessor } from "./service.js";
import { FileDisputeStore } from "./store.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = readDisputeServiceConfig();
const providers = await readProviderRegistryFromHcs(config.mirrorNodeBaseUrl, config.providerTopicId, { escrowContractId: config.escrowContractId });
const identity = new WorldIdVerifier(
  { verifyUrl: config.worldVerifyUrl, action: config.worldAction, proofMode: config.worldProofMode },
  new FileRootStore(config.rootStorePath)
);
const checkers = config.checkers.map((checker) => new HttpCrossChecker(checker.id, checker.url, config.checkerTimeoutMs));
const processor = new DisputeProcessor(
  identity,
  providers,
  new HttpContentStore(config.contentStoreBaseUrl),
  checkers,
  createSettlementCoordinator(),
  new MirrorBondVerifier(config.mirrorNodeBaseUrl, config.escrowContractId),
  new FileDisputeStore(config.disputeStoreDirectory)
);
const server = createDisputeServer(processor, { maxBodyBytes: config.maxBodyBytes });
const host = process.env.DISPUTES_HOST?.trim() || process.env.VERITY_BIND_HOST?.trim() || "0.0.0.0";
server.listen(config.port, host, () => console.log(JSON.stringify({ host, port: config.port, source: "disputes" })));
