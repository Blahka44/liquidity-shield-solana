import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import { createHash } from "crypto";

const idl = require("../target/idl/liquidity_shield_solana.json");

const ACTION_TAGS: Record<string, number> = {
  pause: 0,
  move: 1,
  rebalance: 2,
  hold: 3,
};

function sha256(...parts: Buffer[]) {
  const hash = createHash("sha256");

  for (const part of parts) {
    hash.update(part);
  }

  return hash.digest();
}

function outcomeName(outcome: Record<string, unknown>) {
  return Object.keys(outcome)[0];
}

async function main() {
  const [recordAddress, rawInputJson, actionInput, expectedPolicyAddress] =
    process.argv.slice(2);

  if (!recordAddress || rawInputJson === undefined || !actionInput) {
    throw new Error(
      [
        "Usage:",
        "npx ts-node scripts/verify_attestation.ts",
        "<decision-record-PDA>",
        "'<exact-raw-input-json>'",
        "<pause|move|rebalance|hold>",
        "[expected-policy-PDA]",
      ].join(" "),
    );
  }

  const action = actionInput.toLowerCase();
  const actionTag = ACTION_TAGS[action];

  if (actionTag === undefined) {
    throw new Error(`Unknown action "${actionInput}".`);
  }

  const provider = anchor.AnchorProvider.env();
  const program = new Program(idl as Idl, provider) as any;
  const decisionRecord = new anchor.web3.PublicKey(recordAddress);

  // Read-only RPC fetch: this script sends no transaction and changes no state.
  const record = await program.account.decisionRecord.fetch(decisionRecord);

  const rawInputBytes = Buffer.from(rawInputJson, "utf8");
  const onChainPolicyHash = Buffer.from(record.policyHash);
  const expectedRawInputHash = sha256(rawInputBytes);
  const expectedDecisionHash = sha256(
    rawInputBytes,
    onChainPolicyHash,
    Buffer.from([actionTag]),
  );

  const onChainAction = Object.keys(record.action)[0].toLowerCase();
  const rawInputHashMatches = expectedRawInputHash.equals(
    Buffer.from(record.rawInputHash),
  );
  const decisionHashMatches = expectedDecisionHash.equals(
    Buffer.from(record.decisionHash),
  );
  const actionMatches = onChainAction === action;

  const policyMatches =
    expectedPolicyAddress === undefined ||
    record.policy.equals(new anchor.web3.PublicKey(expectedPolicyAddress));

  console.log("\nLIQUIDITY SHIELD ATTESTATION VERIFICATION");
  console.log("DecisionRecord:", decisionRecord.toBase58());
  console.log("Policy:", record.policy.toBase58());
  console.log("Agent:", record.agentId.toBase58());
  console.log("Proposal ID (hex):", Buffer.from(record.proposalId).toString("hex"));
  console.log("Risk score:", record.riskScore.toString(10));
  console.log("Action:", onChainAction);
  console.log("Outcome:", outcomeName(record.outcome));
  console.log("Timestamp:", record.timestamp.toString(10));
  console.log("On-chain raw-input hash:", Buffer.from(record.rawInputHash).toString("hex"));
  console.log("Computed raw-input hash:", expectedRawInputHash.toString("hex"));
  console.log("On-chain decision hash:", Buffer.from(record.decisionHash).toString("hex"));
  console.log("Computed decision hash:", expectedDecisionHash.toString("hex"));

  console.log("\nCHECKS");
  console.log(`Raw input hash matches: ${rawInputHashMatches}`);
  console.log(`Action matches: ${actionMatches}`);
  console.log(`Policy matches: ${policyMatches}`);
  console.log(`Decision hash matches: ${decisionHashMatches}`);

  if (
    !rawInputHashMatches ||
    !actionMatches ||
    !policyMatches ||
    !decisionHashMatches
  ) {
    throw new Error("\nVERIFICATION FAILED: supplied inputs do not match the on-chain attestation.");
  }

  console.log("\nVERIFICATION PASSED: the supplied inputs reproduce the on-chain attestation.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
