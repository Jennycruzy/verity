export type SettlementState = "created" | "verified" | "held" | "adjudicating" | "settled" | "void" | "failed";

export type SettlementEvent =
  | "verified"
  | "held"
  | "accepted"
  | "rejected"
  | "adjudication_started"
  | "adjudication_upheld"
  | "adjudication_overturned"
  | "settlement_failed";

export function transition(state: SettlementState, event: SettlementEvent): SettlementState {
  switch (state) {
    case "created":
      if (event === "verified") return "verified";
      break;
    case "verified":
      if (event === "held") return "held";
      break;
    case "held":
      if (event === "accepted") return "settled";
      if (event === "adjudication_started") return "adjudicating";
      if (event === "settlement_failed") return "failed";
      break;
    case "adjudicating":
      if (event === "adjudication_upheld") return "void";
      if (event === "adjudication_overturned") return "settled";
      if (event === "settlement_failed") return "failed";
      break;
    case "settled":
    case "void":
    case "failed":
      break;
  }
  throw new Error(`VERITY_INVALID_TRANSITION: ${state} cannot process ${event}`);
}
