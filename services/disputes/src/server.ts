import "dotenv/config";
import { HttpContentStore } from "@verity/content";
import { FileRootStore, WorldIdVerifier } from "@verity/agent";
import { createSettlementCoordinator } from "@verity/settlement";
import { createDisputeServer } from "./app.js";
import { MirrorBondVerifier } from "./bond.js";
import { HttpCrossChecker } from "./crosschecker.js";
import { readDisputeServiceConfig } from "./config.js";
import { readProviderRegistry } from "./registry.js";
import { DisputeProcessor } from "./service.js";
import { FileDisputeStore } from "./store.js";

const config = readDisputeServiceConfig();
const providers = await readProviderRegistry(config.providerRegistryPath);
const identity = new WorldIdVerifier(
  { verifyUrl: config.worldVerifyUrl, action: config.worldAction },
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
server.listen(config.port, () => console.log(JSON.stringify({ port: config.port, source: "disputes" })));
