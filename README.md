

## Liquidity Shield — Solana

Liquidity Shield is a pre-execution policy guard and on-chain attestation layer for AI agents managing token vaults on Solana.

## Architecture Diagram

```
[ AI Agent ] ----(proposes action & risk score)----> [ Liquidity Shield Program ]
                                                               |
                                                    [ Policy PDA Check ]
                                                    /                  \
                                          (Fail) /                    \ (Pass)
                                                /                      \
                                 [ Write REJECTED ]               [ Execute CPI ]
                                 [ Decision Record]               [ Write EXECUTED]
                                                                  [ Decision Record]
```

## Quick Start

```bash
# Build
cargo build-sbf --tools-version v1.57

# Test
anchor test --skip-build
```

## Threat Model & Security Limitations

### Current MVP Limitations:
* **Risk Score Trust**: The current MVP assumes the agent submits an honest `risk_score`. In production, this must be replaced with a trusted oracle signature (e.g., AtlasYield) to prevent agents from spoofing their own risk score.
* **Agent Authentication**: Currently uses standard Solana signer checks. Future versions will integrate Decentralized Identifiers (DIDs).
* **Upgrade Authority**: The program is currently upgradeable by the deployer. This must be burned or moved to a multisig before mainnet.

## Security Testing
* **Pre-execution safety**: Rejected proposals change no token balances.
* **Dual-outcome attestations**: Both rejected and executed proposals create DecisionRecord PDAs.
* **Hash reproducibility**: The verifier recomputes the decision hash and matches it to the on-chain record (See `VERIFICATION.md`).
* **Replay resistance**: Reusing a proposal ID fails to create a new record.

## Repository Structure
* `programs/liquidity_shield_solana/` — The Anchor smart contract.
* `tests/` — Integration tests for policy enforcement.
* `scripts/` — Devnet deployment and cryptographic verifier scripts.


