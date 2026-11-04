import * as anchor from "@coral-xyz/anchor";
import { BN, Idl, Program } from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Buffer } from "buffer";
import { randomBytes } from "crypto";

const idl = require("../target/idl/liquidity_shield_solana.json");

const PROGRAM_ID = new anchor.web3.PublicKey(
  "7mgbZq9YseuJpMhnRAthiz6t8i2iLVFgwG9gjkvhHRoH",
);

const explorer = (address: anchor.web3.PublicKey | string) =>
  `https://explorer.solana.com/address/${address.toString()}?cluster=devnet`;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl as Idl, provider) as any;
  const payer = (provider.wallet as any).payer as anchor.web3.Keypair;
  const { connection } = provider;

  if (!program.programId.equals(PROGRAM_ID)) {
    throw new Error(
      `IDL program ID ${program.programId.toBase58()} does not match ${PROGRAM_ID.toBase58()}`,
    );
  }

  const [policy] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), provider.wallet.publicKey.toBuffer()],
    program.programId,
  );

  const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), policy.toBuffer()],
    program.programId,
  );

  const [vaultAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vault.toBuffer()],
    program.programId,
  );

  console.log("Program:", explorer(program.programId));
  console.log("Policy PDA:", explorer(policy));
  console.log("Vault PDA:", explorer(vault));
  console.log("Vault authority PDA:", explorer(vaultAuthority));

  const policyExists = await connection.getAccountInfo(policy);

  if (policyExists === null) {
    const signature = await program.methods
      .createPolicy(new BN(50), 0xffff)
      .accounts({
        authority: provider.wallet.publicKey,
        policy,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Created policy:", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  } else {
    const signature = await program.methods
      .updatePolicy(new BN(50), 0xffff)
      .accounts({
        authority: provider.wallet.publicKey,
        policy,
      })
      .rpc();

    console.log("Updated policy:", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  }

  const vaultExists = await connection.getAccountInfo(vault);
  let sourceTokenAccount: anchor.web3.PublicKey;
  let mint: anchor.web3.PublicKey;

  if (vaultExists === null) {
    mint = await createMint(
      connection,
      payer,
      provider.wallet.publicKey,
      null,
      6,
    );

    sourceTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        vaultAuthority,
        true,
      )
    ).address;

    await mintTo(
      connection,
      payer,
      mint,
      sourceTokenAccount,
      payer,
      100n,
    );

    const signature = await program.methods
      .createVault()
      .accounts({
        authority: provider.wallet.publicKey,
        policy,
        vault,
        vaultAuthority,
        sourceTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Created mint:", explorer(mint));
    console.log("Created vault:", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  } else {
    const vaultState = await program.account.vault.fetch(vault);
    sourceTokenAccount = vaultState.sourceTokenAccount;

    const sourceAccount = await getAccount(connection, sourceTokenAccount);
    mint = sourceAccount.mint;

    // The script-created wallet is the mint authority. Add test liquidity for reruns.
    await mintTo(
      connection,
      payer,
      mint,
      sourceTokenAccount,
      payer,
      100n,
    );

    console.log("Reusing mint:", explorer(mint));
    console.log("Reusing vault source token account:", explorer(sourceTokenAccount));
  }

  const destinationTokenAccount = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      provider.wallet.publicKey,
    )
  ).address;

  const rejectedProposalId = randomBytes(32);
  const [rejectedRecord] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("decision"), policy.toBuffer(), rejectedProposalId],
    program.programId,
  );

  const rejectedRawInput = JSON.stringify({
    demo: "liquidity-shield-devnet",
    intent: "blocked move",
    amount: 10,
    riskScore: 51,
  });

  const rejectedSignature = await program.methods
    .guardedTransfer(
      [...rejectedProposalId],
      new BN(51),
      { move: {} },
      rejectedRawInput,
      new BN(10),
    )
    .accounts({
      agent: provider.wallet.publicKey,
      policy,
      vault,
      vaultAuthority,
      sourceTokenAccount,
      destinationTokenAccount,
      decisionRecord: rejectedRecord,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const executedProposalId = randomBytes(32);
  const [executedRecord] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("decision"), policy.toBuffer(), executedProposalId],
    program.programId,
  );

  const executedRawInput = JSON.stringify({
    demo: "liquidity-shield-devnet",
    intent: "approved move",
    amount: 10,
    riskScore: 25,
  });

  const executedSignature = await program.methods
    .guardedTransfer(
      [...executedProposalId],
      new BN(25),
      { move: {} },
      executedRawInput,
      new BN(10),
    )
    .accounts({
      agent: provider.wallet.publicKey,
      policy,
      vault,
      vaultAuthority,
      sourceTokenAccount,
      destinationTokenAccount,
      decisionRecord: executedRecord,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const rejected = await program.account.decisionRecord.fetch(rejectedRecord);
  const executed = await program.account.decisionRecord.fetch(executedRecord);
  const source = await getAccount(connection, sourceTokenAccount);
  const destination = await getAccount(connection, destinationTokenAccount);

  console.log("\nDEVNET ATTESTATIONS");
  console.log("REJECTED record:", explorer(rejectedRecord));
  console.log(
    "REJECTED transaction:",
    `https://explorer.solana.com/tx/${rejectedSignature}?cluster=devnet`,
  );
  console.log("REJECTED outcome:", rejected.outcome);

  console.log("EXECUTED record:", explorer(executedRecord));
  console.log(
    "EXECUTED transaction:",
    `https://explorer.solana.com/tx/${executedSignature}?cluster=devnet`,
  );
  console.log("EXECUTED outcome:", executed.outcome);

  console.log("\nTOKEN BALANCES");
  console.log("Vault source:", source.amount.toString());
  console.log("Destination:", destination.amount.toString());

  console.log("\nKeep these raw inputs to recompute the stored hashes:");
  console.log("Rejected raw input:", rejectedRawInput);
  console.log("Executed raw input:", executedRawInput);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
