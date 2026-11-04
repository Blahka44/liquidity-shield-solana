# Liquidity Shield Solana

Liquidity Shield is a pre-execution policy guard and on-chain attestation layer for AI agents and automated systems managing token vaults on Solana.

It enforces policy before a protected SPL Token transfer occurs, then leaves a permanent on-chain record of whether the action was executed or rejected.

## Public devnet attestation proof

Liquidity Shield has been exercised on Solana devnet with a real Policy PDA, Vault PDA, SPL token mint, and two immutable DecisionRecord attestations.

| Proof | On-chain link |
| --- | --- |
| Policy PDA | [13MXV8HGqqWun5Mb7k84ew6c2mCPGFkGBDPSVeeJ5ujk](https://explorer.solana.com/address/13MXV8HGqqWun5Mb7k84ew6c2mCPGFkGBDPSVeeJ5ujk?cluster=devnet) |
| Vault PDA | [BWq1GUxauBupxCfEYJ3Gua6Qp3HSXLP9pxmAXJaVzT8h](https://explorer.solana.com/address/BWq1GUxauBupxCfEYJ3Gua6Qp3HSXLP9pxmAXJaVzT8h?cluster=devnet) |
| Rejected DecisionRecord | [8F66ZKYGQh5EtsDcmdkQHZhh2KQDjB6bpP9w2Tt9bR6U](https://explorer.solana.com/address/8F66ZKYGQh5EtsDcmdkQHZhh2KQDjB6bpP9w2Tt9bR6U?cluster=devnet) |
| Executed DecisionRecord | [BokRVpcwwc6dXxK3TwPDQNBZmwKJ6KKeYbf4hAw4JnuL](https://explorer.solana.com/address/BokRVpcwwc6dXxK3TwPDQNBZmwKJ6KKeYbf4hAw4JnuL?cluster=devnet) |

### Demonstrated outcomes

| Proposal | Risk score | Outcome | Token movement |
| --- | ---: | --- | --- |
| Proposed `MOVE` | 51 | `REJECTED` | 0 tokens moved |
| Proposed `MOVE` | 25 | `EXECUTED` | 10 tokens moved |

The policy threshold was `50`. Both proposals wrote a DecisionRecord containing the policy, agent identity, action, risk score, raw-input hash, policy hash, decision hash, outcome, and timestamp.

The guarded vault started with 100 test tokens. After the rejected and approved proposals, the source vault held 90 tokens and the destination account held 10 tokens.

Solana Explorer displays these custom Anchor accounts as raw program data. The repository includes `scripts/read_attestations.ts`, which decodes the DecisionRecord PDAs into human-readable fields.

### Independent hash verification

The repository includes `scripts/verify_attestation.ts`, a read-only verifier that fetches a DecisionRecord from devnet and recomputes:

```text
SHA-256(raw_input_json UTF-8 bytes || policy_hash || action_tag)
## Deployed Devnet Program

- **Program ID:** [`7mgbZq9YseuJpMhnRAthiz6t8i2iLVFgwG9gjkvhHRoH`](https://explorer.solana.com/address/7mgbZq9YseuJpMhnRAthiz6t8i2iLVFgwG9gjkvhHRoH?cluster=devnet)
- **Deployment Tx:** [`5JTmeD9eqfqn9AmUhrG6ZzB932BjcPxjvBbkpvEDwM2oCbRaDS7N2ybBG1u4FVeqcYkRfZmrDD54hsFkyMPnpB43`](https://explorer.solana.com/tx/5JTmeD9eqfqn9AmUhrG6ZzB932BjcPxjvBbkpvEDwM2oCbRaDS7N2ybBG1u4FVeqcYkRfZmrDD54hsFkyMPnpB43?cluster=devnet)

## Why it exists

AI agents should not have unrestricted authority to move capital.

Liquidity Shield places a Solana program-controlled PDA between an agent and a vault token account. Every proposed action is checked against a policy before the program invokes an SPL Token transfer CPI.

```text
Agent proposes action
        |
        v
Policy PDA evaluates risk score and allowed action
        |
   +----+----+
   |         |
Rejected   Approved
   |         |
   v         v
Write      Token transfer CPI signed by vault-authority PDA
REJECTED       |
record         v
            Write EXECUTED record
```

## Core guarantees

- The policy check occurs before any protected token transfer.
- Rejected actions transfer no vault tokens.
- Both rejected and approved actions create a DecisionRecord PDA.
- The vault source token account is owned by a program-derived vault authority, not the agent.
- Decision hashes are reproducible from raw input, policy hash, and action.

## Program instructions

| Instruction | Purpose |
| :--- | :--- |
| `create_policy` | Creates the Policy PDA with risk threshold and allowed-action bitmask. |
| `update_policy` | Updates policy settings and increments its version. |
| `create_vault` | Registers a guarded vault source token account. |
| `guarded_transfer` | Evaluates a proposal, records an attestation, and transfers only when approved. |

## PDA model

| Account | Seeds | Purpose |
| :--- | :--- | :--- |
| Policy | `["policy", authority]` | Stores policy authority, version, risk threshold, allowed actions, and policy hash. |
| Vault | `["vault", policy]` | Registers the policy-owned source token account. |
| Vault authority | `["vault_authority", vault]` | Owns and signs transfers from the vault token account. |
| DecisionRecord | `["decision", policy, proposal_id]` | Immutable per-proposal attestation. |

## DecisionRecord

Every proposal produces one DecisionRecord containing:

- Policy and agent public keys
- Proposal ID
- Risk score
- Action type: Pause, Move, Rebalance, or Hold
- SHA-256 hash of the raw input
- Policy hash
- Decision hash
- Outcome: Rejected or Executed
- On-chain timestamp

*A rejected proposal returns successfully after writing its Rejected record. This is intentional: returning an error would roll back the transaction and erase the attestation.*

## Local development

Prerequisites:
- Anchor CLI 0.32.2
- Solana CLI 2.3.0
- Anchor TypeScript client 0.32.1
- Node.js and npm

**Build:**
```bash
cargo build-sbf --tools-version v1.57
```

**Generate the IDL:**
```bash
rm -f target/idl/liquidity_shield_solana.json
anchor idl build > /tmp/liquidity_shield_solana.json && \
mv /tmp/liquidity_shield_solana.json target/idl/liquidity_shield_solana.json
```

**Run checks and tests:**
```bash
npx tsc --noEmit
anchor test --skip-build
```

