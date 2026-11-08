# Liquidity Shield â€” Solana

Liquidity Shield is a pre-execution policy guard and on-chain attestation layer for AI agents managing token vaults on Solana.

## Architecture Diagram

```text
[ AI Agent ] ----(proposes action & risk score)---> [ Liquidity Shield Program ]
                                                               |
                                                [ Policy PDA Check ]
                                                /                  \
                                       (Fail) /                    \ (Pass)
                                            /                          \
                            [ Write REJECTED ]               [ Execute CPI ]
                            [ Decision Record]               [ Write EXECUTED ]
                                                      [ Decision Record ]
```

## Quick Start

```bash
# Build
cargo build-sbf --tools-version v1.57

# Test
anchor test --skip-build
```

## Threat Model & Security Limitations

**Current MVP Limitations:**
- |** Risk Score Trust:** The current MVP assumes the agent submits an honest `risk_score`. In production, this must be replaced with a trusted oracle signature (e.g., AtlasYield) to prevent agents from spoofing their own risk score.
- |** Agent Authentication:** Currently uses standard Solana signer checks. Future versions will integrate Decentralized Identifiers (DIDs).
- |** Upgrade Authority:** The program is currently upgradeable by the deployer. This must be burned or moved to a multisig before mainnet.

## Security Testing

- |** Pre-execution safety:** Rejected proposals change no token balances.
- |** Dual-outcome attestations:** Both rejected and executed proposals create DecisionRecord PDAs.
- |¨¨!…Í É•ÁÉ½‘Õ¥‰¥±¥Ñäè¨¨Q¡”Ù•É¥™¥•ÈÉ•½µÁÕÑ•ÌÑ¡”‘•¥Í¥½¸¡…Í …¹µ…Ñ¡•Ì¥ĞÑ¼Ñ¡”½¸µ¡…¥¸É•½É€¡M•”mYI%%Q%=8¹µ‘t ¸½YI%%Q%=8¹µ¤¤¸(´ò¢¢&WÆ’&W6—7Fæ6S¢¢¢&WW6–ær&÷÷6Â”Bf–Ç2Fò7&VFRæWr&V6÷&Bà ¢22&W÷6—F÷'’7G'V7GW&P ¢Ò&öw&×2öÆ—V–F—G•÷6†–VÆE÷6öÆæöÒF†Ræ6†÷"6Ö'B6öçG&7Bà¢ÒFW7G2öÒ–çFVw&F–öâFW7G2f÷"öÆ–7’Væf÷&6VÖVçBà¢Ò67&—G2öÒFWfæWBFWÆ÷–ÖVçBæB7'—Föw&†–2fW&–f–W"67&—G2à