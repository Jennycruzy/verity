import { BigDecimal, BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import { Agent, AgentRegistrationFile, Feedback } from "../generated/schema"
import { Registered as RegisteredEvent, URIUpdated as URIUpdatedEvent } from "../generated/IdentityRegistry/IdentityRegistry"
import { FeedbackRevoked as FeedbackRevokedEvent, NewFeedback as NewFeedbackEvent } from "../generated/ReputationRegistry/ReputationRegistry"
import { GRAPH_CHAIN_ID } from "./config"

export function handleRegistered(event: RegisteredEvent): void {
  const agent = loadOrCreateAgent(agentKey(event.params.agentId), event.block.timestamp)
  agent.owner = event.params.owner
  agent.agentURI = event.params.agentURI
  const root = extractHumanRoot(event.params.agentURI)
  if (root !== null) agent.humanRoot = root
  agent.updatedAt = event.block.timestamp
  agent.lastActivity = event.block.timestamp
  agent.save()
  saveRegistration(agent, event.params.agentURI, event.block.timestamp, event.transaction.hash, event.logIndex)
}

export function handleURIUpdated(event: URIUpdatedEvent): void {
  const agent = Agent.load(agentKey(event.params.agentId))
  if (agent === null) {
    log.warning("VERITY_GRAPH_URI_UPDATE_MISSING: agent {} was not indexed", [event.params.agentId.toString()])
    return
  }
  agent.agentURI = event.params.newURI
  const root = extractHumanRoot(event.params.newURI)
  if (root !== null) agent.humanRoot = root
  agent.updatedAt = event.block.timestamp
  agent.lastActivity = event.block.timestamp
  agent.save()
  saveRegistration(agent as Agent, event.params.newURI, event.block.timestamp, event.transaction.hash, event.logIndex)
}

export function handleNewFeedback(event: NewFeedbackEvent): void {
  const agent = loadOrCreateAgent(agentKey(event.params.agentId), event.block.timestamp)
  const root = extractHumanRoot(event.params.feedbackURI)
  if (root !== null) agent.humanRoot = root

  const feedbackId = `${agent.id}:${event.params.clientAddress.toHexString()}:${event.params.feedbackIndex.toString()}`
  const feedback = new Feedback(feedbackId)
  feedback.agent = agent.id
  feedback.clientAddress = event.params.clientAddress
  feedback.feedbackIndex = event.params.feedbackIndex
  feedback.value = scaledValue(event.params.value, event.params.valueDecimals)
  feedback.valueDecimals = event.params.valueDecimals
  feedback.tag1 = event.params.tag1
  feedback.tag2 = event.params.tag2
  feedback.endpoint = event.params.endpoint
  feedback.feedbackURI = event.params.feedbackURI
  feedback.feedbackHash = event.params.feedbackHash
  feedback.isRevoked = false
  feedback.createdAt = event.block.timestamp
  feedback.transactionHash = event.transaction.hash
  feedback.registryAddress = event.address
  feedback.save()

  agent.totalFeedback = agent.totalFeedback.plus(BigInt.fromI32(1))
  agent.updatedAt = event.block.timestamp
  agent.lastActivity = event.block.timestamp
  agent.save()
}

export function handleFeedbackRevoked(event: FeedbackRevokedEvent): void {
  const feedbackId = `${agentKey(event.params.agentId)}:${event.params.clientAddress.toHexString()}:${event.params.feedbackIndex.toString()}`
  const feedback = Feedback.load(feedbackId)
  if (feedback === null) {
    log.warning("VERITY_GRAPH_REVOCATION_MISSING: feedback {} was not indexed", [feedbackId])
    return
  }
  feedback.isRevoked = true
  feedback.revokedAt = event.block.timestamp
  feedback.save()
}

function loadOrCreateAgent(id: string, timestamp: BigInt): Agent {
  let agent = Agent.load(id)
  if (agent !== null) return agent as Agent
  const separator = id.indexOf(":")
  agent = new Agent(id)
  agent.chainId = BigInt.fromString(GRAPH_CHAIN_ID)
  agent.agentId = BigInt.fromString(id.substring(separator + 1))
  agent.totalFeedback = BigInt.fromI32(0)
  agent.createdAt = timestamp
  agent.updatedAt = timestamp
  agent.lastActivity = timestamp
  return agent as Agent
}

function saveRegistration(agent: Agent, uri: string, timestamp: BigInt, transactionHash: Bytes, logIndex: BigInt): void {
  if (uri.length === 0) return
  const registrationId = `${agent.id}:${transactionHash.toHexString()}:${logIndex.toString()}`
  const registration = new AgentRegistrationFile(registrationId)
  registration.agent = agent.id
  registration.rawURI = uri
  const endpoint = extractWebEndpoint(uri)
  if (endpoint !== null) registration.webEndpoint = endpoint
  registration.createdAt = timestamp
  registration.save()
  agent.registrationFile = registrationId
  agent.save()
}

function scaledValue(rawValue: BigInt, decimals: i32): BigDecimal {
  let divisor = BigDecimal.fromString("1")
  for (let i = 0; i < decimals; i++) divisor = divisor.times(BigDecimal.fromString("10"))
  return rawValue.toBigDecimal().div(divisor)
}

function agentKey(agentId: BigInt): string {
  return `${GRAPH_CHAIN_ID}:${agentId.toString()}`
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

function extractWebEndpoint(uri: string): string | null {
  const marker = "#verity-web-endpoint="
  const start = uri.indexOf(marker)
  if (start < 0) return null
  const value = uri.substring(start + marker.length)
  if (value.indexOf("http://") !== 0 && value.indexOf("https://") !== 0) return null
  return value
}
