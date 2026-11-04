import * as anchor from "@coral-xyz/anchor";
import { BN, Idl, Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { Buffer } from "buffer";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const idl = require("../target/idl/liquidity_shield_solana.json");

describe("liquidity_shield_solana", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl as Idl, provider) as any;
  const payer = (provider.wallet as any).payer as anchor.web3.Keypair;

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

  let sourceTokenAccount: anchor.web3.PublicKey;
  let destinationTokenAccount: anchor.web3.PublicKey;

  it("creates a policy-owned vault transfer path", async () => {
    await program.methods
      .createPolicy(new BN(50), 0xffff)
      .accounts({
        authority: provider.wallet.publicKey,
        policy,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const mint = await createMint(
      provider.connection,
      payer,
      provider.wallet.publicKey,
      null,
      6,
    );

    // `true` explicitly allows the vault-authority PDA to own this ATA.
    sourceTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        mint,
        vaultAuthority,
        true,
      )
    ).address;

    destinationTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        mint,
        provider.wallet.publicKey,
      )
    ).address;

    await mintTo(
      provider.connection,
      payer,
      mint,
      sourceTokenAccount,
      payer,
      100n,
    );

    await program.methods
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
  });

  it("records REJECTED and moves no funds when policy rejects", async () => {
    const proposalId = Buffer.alloc(32, 1);
    const [decisionRecord] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("decision"), policy.toBuffer(), proposalId],
      program.programId,
    );

    await program.methods
      .guardedTransfer(
        [...proposalId],
        new BN(51),
        { move: {} },
        '{"intent":"blocked move","amount":10}',
        new BN(10),
      )
      .accounts({
        agent: provider.wallet.publicKey,
        policy,
        vault,
        vaultAuthority,
        sourceTokenAccount,
        destinationTokenAccount,
        decisionRecord,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const decision = await program.account.decisionRecord.fetch(decisionRecord);
    const source = await getAccount(provider.connection, sourceTokenAccount);
    const destination = await getAccount(
      provider.connection,
      destinationTokenAccount,
    );

    assert.deepEqual(decision.outcome, { rejected: {} });
    assert.equal(source.amount.toString(), "100");
    assert.equal(destination.amount.toString(), "0");
  });

  it("records EXECUTED only after the guarded token transfer", async () => {
    const proposalId = Buffer.alloc(32, 2);
    const [decisionRecord] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("decision"), policy.toBuffer(), proposalId],
      program.programId,
    );

    await program.methods
      .guardedTransfer(
        [...proposalId],
        new BN(25),
        { move: {} },
        '{"intent":"approved move","amount":10}',
        new BN(10),
      )
      .accounts({
        agent: provider.wallet.publicKey,
        policy,
        vault,
        vaultAuthority,
        sourceTokenAccount,
        destinationTokenAccount,
        decisionRecord,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const decision = await program.account.decisionRecord.fetch(decisionRecord);
    const source = await getAccount(provider.connection, sourceTokenAccount);
    const destination = await getAccount(
      provider.connection,
      destinationTokenAccount,
    );

    assert.deepEqual(decision.outcome, { executed: {} });
    assert.equal(source.amount.toString(), "90");
    assert.equal(destination.amount.toString(), "10");
  });
});
