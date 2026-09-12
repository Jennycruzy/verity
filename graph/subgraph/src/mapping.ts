import {
  BigDecimal,
  BigInt,
  Bytes,
  ethereum,
  log,
} from "@graphprotocol/graph-ts"
import { Agent, AgentRegistrationFile, Feedback } from "../generated/schema"
import { GRAPH_CHAIN_ID } from "./config"

const NEW_FEEDBACK_TOPIC = "0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc"
const FEEDBACK_REVOKED_TOPIC = "0x25156fd3288212246d8b008d5921fde376c71ed14ac2e072a506eb06fde6d09d"
const REGISTERED_TOPIC = "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a"

class Cursor {
  public offset: i32 = 0

  public constructor(public readonly bytes: Uint8Array) {}

  public readVarint(end: i32): i32 {
    let value: i32 = 0
    let shift: i32 = 0
    while (true) {
      ensure(this.offset < end, "VERITY_GRAPH_PROTOBUF_TRUNCATED: varint ended before the message")
      const current = this.bytes[this.offset++] as i32
      if (shift >= 28) {
        ensure((current & 0x7f) <= 7, "VERITY_GRAPH_PROTOBUF_OVERFLOW: varint does not fit in an i32")
      }
      value |= (current & 0x7f) << shift
      if ((current & 0x80) === 0) return value
      shift += 7
      ensure(shift < 35, "VERITY_GRAPH_PROTOBUF_OVERFLOW: varint is too long")
    }
  }

  public readDelimited(end: i32): Uint8Array {
    const length = this.readVarint(end)
    ensure(length >= 0, "VERITY_GRAPH_PROTOBUF_LENGTH: negative length")
    const next = this.offset + length
    ensure(next >= this.offset && next <= end, "VERITY_GRAPH_PROTOBUF_TRUNCATED: delimited field exceeds its message")
    const value = this.bytes.subarray(this.offset, next)
    this.offset = next
    return value
  }

  public skip(wireType: i32, end: i32): void {
    if (wireType === 0) {
      this.readVarint(end)
      return
    }
    if (wireType === 1) {
      this.offset += 8
      ensure(this.offset <= end, "VERITY_GRAPH_PROTOBUF_TRUNCATED: fixed64 field exceeds its message")
      return
    }
    if (wireType === 2) {
      this.readDelimited(end)
      return
    }
    if (wireType === 5) {
      this.offset += 4
      ensure(this.offset <= end, "VERITY_GRAPH_PROTOBUF_TRUNCATED: fixed32 field exceeds its message")
      return
    }
    ensure(false, "VERITY_GRAPH_PROTOBUF_WIRE_TYPE: unsupported protobuf wire type")
  }
}

class StreamLog {
  public address: Uint8Array = new Uint8Array(0)
  public topics: Array<Uint8Array> = []
  public data: Uint8Array = new Uint8Array(0)
  public transactionHash: string = ""
  public logIndex: i32 = 0
}

class StreamEvent {
  public log: StreamLog | null = null
  public transactionHash: string = ""
}

class DecodedPayload {
  public constructor(
    public readonly timestamp: BigInt,
    public readonly events: Array<StreamEvent>
  ) {}
}

class FeedbackData {
  public constructor(
    public readonly feedbackIndex: BigInt,
    public readonly rawValue: BigInt,
    public readonly valueDecimals: i32,
    public readonly tag1: string,
    public readonly tag2: string,
    public readonly endpoint: string,
    public readonly feedbackURI: string,
    public readonly feedbackHash: Bytes
  ) {}
}

export function handleIdentityEvents(payload: Uint8Array): void {
  handlePayload(payload, "identity")
}

export function handleFeedbackEvents(payload: Uint8Array): void {
  handlePayload(payload, "feedback")
}

export function handleRevocationEvents(payload: Uint8Array): void {
  handlePayload(payload, "revocation")
}

function handlePayload(payload: Uint8Array, kind: string): void {
  const decoded = decodePayload(payload)

  for (let i = 0; i < decoded.events.length; i++) {
    const event = decoded.events[i]
    if (event.log === null) continue
    const eventLog = event.log as StreamLog
    const topic = eventLog.topics.length > 0 ? bytesToHex(eventLog.topics[0]) : ""
    if (kind === "identity" && topic === REGISTERED_TOPIC) handleRegistered(eventLog, event.transactionHash, decoded.timestamp)
    if (kind === "feedback" && topic === NEW_FEEDBACK_TOPIC) handleNewFeedback(eventLog, event.transactionHash, decoded.timestamp)
    if (kind === "revocation" && topic === FEEDBACK_REVOKED_TOPIC) handleFeedbackRevoked(eventLog, decoded.timestamp)
  }
}

function handleRegistered(
  event: StreamLog,
  transactionHash: string,
  timestamp: BigInt
): void {
  if (event.topics.length < 3) {
    log.error("VERITY_GRAPH_REGISTERED_SCHEMA: expected agentId and owner topics", [])
    return
  }
  const chainId = graphChainId()
  const agentId = bigEndianUnsigned(event.topics[1])
  const agentEntityId = agentKey(chainId, agentId)
  let agent = Agent.load(agentEntityId)
  if (agent === null) {
    agent = new Agent(agentEntityId)
    agent.chainId = chainId
    agent.agentId = agentId
    agent.totalFeedback = BigInt.fromI32(0)
    agent.createdAt = timestamp
  }
  agent.owner = addressFromTopic(event.topics[2])
  agent.agentURI = decodeSingleString(event.data)
  if (agent.agentURI !== null) {
    const registrationRoot = extractHumanRoot(agent.agentURI as string)
    if (registrationRoot !== null) agent.humanRoot = registrationRoot
  }
  agent.updatedAt = timestamp
  agent.lastActivity = timestamp
  agent.save()

  if (agent.agentURI !== null && (agent.agentURI as string).length > 0) {
    const registrationId = `${agentEntityId}:${transactionHash}:${event.logIndex.toString()}`
    const registration = new AgentRegistrationFile(registrationId)
    registration.agent = agentEntityId
    registration.rawURI = agent.agentURI as string
    registration.createdAt = timestamp
    registration.save()
    agent.registrationFile = registrationId
    agent.save()
  }
}

function handleNewFeedback(
  event: StreamLog,
  transactionHash: string,
  timestamp: BigInt
): void {
  if (event.topics.length < 3) {
    log.error("VERITY_GRAPH_FEEDBACK_SCHEMA: expected agentId and client topics", [])
    return
  }
  const parsed = decodeFeedback(event.data)
  if (parsed === null) {
    log.error("VERITY_GRAPH_FEEDBACK_SCHEMA: event data did not match the ERC-8004 feedback tuple", [])
    return
  }
  const feedback = parsed as FeedbackData
  const chainId = graphChainId()
  const agentId = bigEndianUnsigned(event.topics[1])
  const agentEntityId = agentKey(chainId, agentId)
  const agent = loadOrCreateAgent(agentEntityId, chainId, agentId, timestamp)
  const humanRoot = extractHumanRoot(feedback.feedbackURI)
  if (humanRoot !== null) agent.humanRoot = humanRoot
  const clientAddress = addressFromTopic(event.topics[2])
  const feedbackId = `${agentEntityId}:${clientAddress.toHexString()}:${feedback.feedbackIndex.toString()}`
  const record = new Feedback(feedbackId)
  record.agent = agentEntityId
  record.clientAddress = clientAddress
  record.feedbackIndex = feedback.feedbackIndex
  record.value = scaledValue(feedback.rawValue, feedback.valueDecimals)
  record.valueDecimals = feedback.valueDecimals
  record.tag1 = feedback.tag1
  record.tag2 = feedback.tag2
  record.endpoint = feedback.endpoint
  record.feedbackURI = feedback.feedbackURI
  record.feedbackHash = feedback.feedbackHash
  record.isRevoked = false
  record.createdAt = timestamp
  record.transactionHash = hexBytes(transactionHash)
  record.registryAddress = Bytes.fromUint8Array(event.address)
  record.save()

  agent.totalFeedback = agent.totalFeedback.plus(BigInt.fromI32(1))
  agent.updatedAt = timestamp
  agent.lastActivity = timestamp
  agent.save()
}

function handleFeedbackRevoked(event: StreamLog, timestamp: BigInt): void {
  if (event.topics.length < 4) {
    log.error("VERITY_GRAPH_REVOCATION_SCHEMA: expected agentId, client, and feedback index topics", [])
    return
  }
  const chainId = graphChainId()
  const agentId = bigEndianUnsigned(event.topics[1])
  const clientAddress = addressFromTopic(event.topics[2])
  const feedbackIndex = bigEndianUnsigned(event.topics[3])
  const feedbackId = `${agentKey(chainId, agentId)}:${clientAddress.toHexString()}:${feedbackIndex.toString()}`
  const record = Feedback.load(feedbackId)
  if (record === null) {
    log.warning("VERITY_GRAPH_REVOCATION_MISSING: feedback {} was not indexed", [feedbackId])
    return
  }
  record.isRevoked = true
  record.revokedAt = timestamp
  record.save()
}

function loadOrCreateAgent(agentEntityId: string, chainId: BigInt, agentId: BigInt, timestamp: BigInt): Agent {
  let agent = Agent.load(agentEntityId)
  if (agent !== null) return agent as Agent
  agent = new Agent(agentEntityId)
  agent.chainId = chainId
  agent.agentId = agentId
  agent.totalFeedback = BigInt.fromI32(0)
  agent.createdAt = timestamp
  agent.updatedAt = timestamp
  agent.lastActivity = timestamp
  return agent
}

function decodePayload(payload: Uint8Array): DecodedPayload {
  const cursor = new Cursor(payload)
  const events = new Array<StreamEvent>()
  let timestamp = BigInt.fromI32(0)
  while (cursor.offset < payload.length) {
    const key = cursor.readVarint(payload.length)
    const field = key >>> 3
    const wireType = key & 7
    if (field === 1 && wireType === 2) {
      timestamp = decodeClock(cursor.readDelimited(payload.length))
    } else if (field === 2 && wireType === 2) {
      const event = decodeEvent(cursor.readDelimited(payload.length))
      if (event !== null) events.push(event as StreamEvent)
    } else {
      cursor.skip(wireType, payload.length)
    }
  }
  return new DecodedPayload(timestamp, events)
}

function decodeClock(payload: Uint8Array): BigInt {
  const cursor = new Cursor(payload)
  let seconds: i32 = 0
  while (cursor.offset < payload.length) {
    const key = cursor.readVarint(payload.length)
    const field = key >>> 3
    const wireType = key & 7
    if (field === 3 && wireType === 2) {
      const timestamp = new Cursor(cursor.readDelimited(payload.length))
      while (timestamp.offset < timestamp.bytes.length) {
        const timestampKey = timestamp.readVarint(timestamp.bytes.length)
        const timestampField = timestampKey >>> 3
        const timestampWireType = timestampKey & 7
        if (timestampField === 1 && timestampWireType === 0) {
          seconds = timestamp.readVarint(timestamp.bytes.length)
        } else {
          timestamp.skip(timestampWireType, timestamp.bytes.length)
        }
      }
    } else {
      cursor.skip(wireType, payload.length)
    }
  }
  return BigInt.fromI32(seconds)
}

function decodeEvent(payload: Uint8Array): StreamEvent | null {
  const cursor = new Cursor(payload)
  const event = new StreamEvent()
  while (cursor.offset < payload.length) {
    const key = cursor.readVarint(payload.length)
    const field = key >>> 3
    const wireType = key & 7
    if (field === 1 && wireType === 2) {
      event.log = decodeLog(cursor.readDelimited(payload.length))
    } else if (field === 2 && wireType === 2) {
      event.transactionHash = Bytes.fromUint8Array(cursor.readDelimited(payload.length)).toString()
    } else {
      cursor.skip(wireType, payload.length)
    }
  }
  if (event.log === null) return null
  const eventLog = event.log as StreamLog
  eventLog.transactionHash = event.transactionHash
  return event
}

function decodeLog(payload: Uint8Array): StreamLog {
  const cursor = new Cursor(payload)
  const eventLog = new StreamLog()
  while (cursor.offset < payload.length) {
    const key = cursor.readVarint(payload.length)
    const field = key >>> 3
    const wireType = key & 7
    if (field === 1 && wireType === 2) {
      eventLog.address = cursor.readDelimited(payload.length)
    } else if (field === 2 && wireType === 2) {
      eventLog.topics.push(cursor.readDelimited(payload.length))
    } else if (field === 3 && wireType === 2) {
      eventLog.data = cursor.readDelimited(payload.length)
    } else if (field === 4 && wireType === 0) {
      eventLog.logIndex = cursor.readVarint(payload.length)
    } else {
      cursor.skip(wireType, payload.length)
    }
  }
  return eventLog
}

function decodeFeedback(payload: Uint8Array): FeedbackData | null {
  const decoded = ethereum.decode(
    "(uint64,int128,uint8,string,string,string,string,bytes32)",
    Bytes.fromUint8Array(payload)
  )
  if (decoded === null) return null
  const tuple = decoded.toTuple()
  return new FeedbackData(
    tuple[0].toBigInt(),
    tuple[1].toBigInt(),
    tuple[2].toI32(),
    tuple[3].toString(),
    tuple[4].toString(),
    tuple[5].toString(),
    tuple[6].toString(),
    tuple[7].toBytes()
  )
}

function decodeSingleString(payload: Uint8Array): string {
  const decoded = ethereum.decode("(string)", Bytes.fromUint8Array(payload))
  if (decoded === null) return ""
  return decoded.toTuple()[0].toString()
}

function scaledValue(rawValue: BigInt, decimals: i32): BigDecimal {
  let divisor = BigDecimal.fromString("1")
  for (let i = 0; i < decimals; i++) divisor = divisor.times(BigDecimal.fromString("10"))
  return rawValue.toBigDecimal().div(divisor)
}

function bigEndianUnsigned(value: Uint8Array): BigInt {
  const bytes = Bytes.fromUint8Array(value)
  bytes.reverse()
  return BigInt.fromUnsignedBytes(bytes)
}

function addressFromTopic(value: Uint8Array): Bytes {
  ensure(value.length === 32, "VERITY_GRAPH_ADDRESS_SCHEMA: indexed address topic must be 32 bytes")
  return Bytes.fromUint8Array(value.subarray(12, 32))
}

function bytesToHex(value: Uint8Array): string {
  return Bytes.fromUint8Array(value).toHexString().toLowerCase()
}

function graphChainId(): BigInt {
  return BigInt.fromString(GRAPH_CHAIN_ID)
}

function hexBytes(value: string): Bytes {
  const normalized = value.startsWith("0x") ? value : `0x${value}`
  return Bytes.fromHexString(normalized)
}

function agentKey(chainId: BigInt, agentId: BigInt): string {
  return `${chainId.toString()}:${agentId.toString()}`
}

function extractHumanRoot(uri: string): string | null {
  const marker = "#verity-human-root="
  const start = uri.indexOf(marker)
  if (start < 0) return null
  const value = uri.substring(start + marker.length)
  if (value.length === 0) return null
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 48 || code > 57) return null
  }
  return value
}

function ensure(condition: bool, message: string): void {
  if (!condition) throw new Error(message)
}
