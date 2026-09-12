import "dotenv/config";
import { readReplayDisputeId } from "./args.js";
import { replayDispute } from "./index.js";

let disputeId: string | undefined;
try {
  disputeId = readReplayDisputeId(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

if (disputeId) {
  try {
    const result = await replayDispute(disputeId, {
      mirrorNodeBaseUrl: required("MIRROR_NODE_BASE_URL"),
      disputeTopicId: required("HCS_DISPUTE_TOPIC_ID"),
      contentStoreBaseUrl: required("CONTENT_STORE_BASE_URL")
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.matches) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}
