export function readReplayDisputeId(argv: readonly string[]): string {
  const [command, disputeId, extra] = argv;
  if (command !== "replay" || !disputeId || extra) {
    throw new Error("Usage: verity replay <disputeId>");
  }
  return disputeId;
}
