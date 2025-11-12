# Lucid Contracts

This repository contains smart contracts for Lucid’s modules, including **Vested Emission Offerings (VEOs)** and **Multi-Bridge Chain Abstraction**.

## Multi-Bridge Chain Abstraction

[Multi-Bridge Docs](https://docs.lucidlabs.fi/modules-and-integrations/multi-bridge)

The Multi-Bridge contracts provide a unified interface for cross-chain messaging and token transfers, reducing reliance on any single bridge by requiring **threshold confirmation across multiple bridges**.

Core concepts:

- **Chain abstraction** — aggregate messaging and asset transfers across bridges like Polymer, Axelar, Wormhole, Connext, LayerZero, etc.
- **Quorum validation** — transfers and messages are finalized only after confirmation from a configurable number of bridges (e.g. 2 of 3).
- **Supported use-cases**:
  - _Asset Transfers_ — secure movement of tokens between chains.
  - _Message + Asset Transfers_ — cross-chain logic execution combined with token transfers.
- **Adapter architecture** — each supported bridge uses its own adapter, coordinated through a central registry.

---

## Vested Emission Offerings (VEOs)

[VEO Docs](https://docs.lucidlabs.fi/modules-and-integrations/vested-emission-offerings-veos)

VEOs are a bonding mechanism that enables protocols to distribute tokens over time with built-in vesting. Instead of releasing tokens immediately, participants receive vested allocations that unlock gradually, ensuring long-term alignment between users and the protocol.

Key features:

- **Bonding participation** — users commit assets or liquidity in exchange for vested token allocations.
- **Pricing strategies** — supports fixed, auction, and oracle-based pricing models.
- **Vesting schedules** — tokens unlock progressively, with claims handled through the contracts.
- **Protocol-Owned Liquidity (POL)** — bonded assets can be deployed directly as POL, strengthening liquidity without reliance on mercenary incentives.
- **Immutable parameters** — once deployed, each VEO’s configuration (pricing, capacity, vesting) cannot be altered.

---

## Resources

- [Full Documentation](https://docs.lucidlabs.fi)
- [VEOs Overview](https://docs.lucidlabs.fi/modules-and-integrations/vested-emission-offerings-veos)
- [Multi-Bridge Overview](https://docs.lucidlabs.fi/modules-and-integrations/multi-bridge)
