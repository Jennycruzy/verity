import { AccountId, Client, PrivateKey, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { encodeHcsRecord, type HcsRecord } from "./codec.js";

export interface HcsPublisher {
  publish<TPayload extends Record<string, unknown>>(topicId: string, record: HcsRecord<TPayload>): Promise<string>;
}

export class HederaHcsPublisher implements HcsPublisher {
  public constructor(private readonly client: Client) {}

  public async publish<TPayload extends Record<string, unknown>>(topicId: string, record: HcsRecord<TPayload>): Promise<string> {
    const message = encodeHcsRecord(record);
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(message)
      .execute(this.client);
    await response.getReceipt(this.client);
    return response.transactionId.toString();
  }
}

export function createHederaClient(network: string, accountId: string, privateKey: string): Client {
  const client = networkClient(network);
  client.setOperator(AccountId.fromString(accountId), PrivateKey.fromStringECDSA(privateKey));
  return client;
}

function networkClient(network: string): Client {
  if (network === "hedera:testnet") return Client.forTestnet();
  if (network === "hedera:mainnet") return Client.forMainnet();
  throw new Error(`VERITY_HEDERA_NETWORK_UNSUPPORTED: cannot create a client for ${network}`);
}
