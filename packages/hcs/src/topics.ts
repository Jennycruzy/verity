import { TopicCreateTransaction, TopicInfoQuery, type Client } from "@hiero-ledger/sdk";

export interface TopicProvisionResult {
  readonly topicId: string;
  readonly transactionId?: string;
  readonly created: boolean;
}

export async function ensureTopic(client: Client, topicId: string | undefined, memo: string): Promise<TopicProvisionResult> {
  if (topicId) {
    await new TopicInfoQuery().setTopicId(topicId).execute(client);
    return { topicId, created: false };
  }

  const response = await new TopicCreateTransaction()
    .setTopicMemo(memo)
    .execute(client);
  const receipt = await response.getReceipt(client);
  if (!receipt.topicId) {
    throw new Error(`VERITY_TOPIC_CREATE_FAILED: ${memo} returned no topic ID`);
  }
  return {
    topicId: receipt.topicId.toString(),
    transactionId: response.transactionId.toString(),
    created: true
  };
}
