import * as anchor from "@coral-xyz/anchor";
import { BN, Idl, Program } from "@coral-xyz/anchor";
import { Buffer } from "buffer";

const idl = require("../target/idl/liquidity_shield_solana.json");

const programId = new anchor.web3.PublicKey(
  "7mgbZq9YseuJpMhnRAthiz6t8i2iLVFgwG9gjkvhHRoH",
);

const rejectedRecord = new anchor.web3.PublicKey(
  "8F66ZKYGQh5EtsDcmdkQHZhh2KQDjB6bpP9w2Tt9bR6U",
);

const executedRecord = new anchor.web3.PublicKey(
  "BokRVpcwwc6dXxK3TwPDQNBZmwKJ6KKeYbf4hAw4JnuL",
);

function format(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item) => {
      if (item instanceof anchor.web3.PublicKey) {
        return item.toBase58();
      }

      if (BN.isBN(item)) {
        return item.toString();
      }

      if (item instanceof Uint8Array || Buffer.isBuffer(item)) {
        return Buffer.from(item).toString("hex");
      }

      return item;
    },
    2,
  );
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  const program = new Program(idl as Idl, provider) as any;

  if (!program.programId.equals(programId)) {
    throw new Error("IDL does not match the deployed devnet program.");
  }

  const rejected = await program.account.decisionRecord.fetch(rejectedRecord);
  const executed = await program.account.decisionRecord.fetch(executedRecord);

  console.log("\nREJECTED ON-CHAIN ATTESTATION");
  console.log("Account:", rejectedRecord.toBase58());
  console.log(format(rejected));

  console.log("\nEXECUTED ON-CHAIN ATTESTATION");
  console.log("Account:", executedRecord.toBase58());
  console.log(format(executed));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
