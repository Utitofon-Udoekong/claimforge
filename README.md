# ClaimForge

![ClaimForge](apps/claimforge/public/logo.jpg)

Pull your own payment from a published list. A Merkle root names who is owed what. The contract pays that leaf once, to that person, and nobody else can redirect it.

Repository: https://github.com/Utitofon-Udoekong/claimforge

## The problem

Paying a list of people one output at a time puts a signature, an input, and a mistake on every recipient. The payer can also change a destination after the list was agreed. ClaimForge publishes the list as a root. Each claimant pulls only their own leaf, and a second pull of that leaf fails.

## How it works

An epoch is one complete binary tree of depth 4. The publisher puts the root, the epoch, and the asset into a SolidCash contract. The asset is Bitcoin Cash, or a CashTokens category such as FLDCH. The contract does not mint the token. The distributor deposits a balance and publishes the root.

A leaf is one SHA-256 over 65 bytes, integers little-endian:

```text
0x01 || pkh[20] || amount[8] || epoch[4] || category[32]
```

`pkh` is the HASH160 inside the claimant's cashaddr. A proof is four sibling hashes and a path byte. The covenant unrolls those four hashes. There is no loop, which keeps the script inside Bitcoin Cash cost limits. The transaction checks the signature, the HASH160, the P2PKH output, the amount, the root, and that this leaf is not already claimed.

The same person can be named on Nostr. A verified bchblaze-id binding must carry the same HASH160 as the leaf. The binding does not move the coins.

The byte layout and the reject cases are in `packages/contracts/CLAIMFORGE.md`.

## Key features

- **Published list.** The desk shows the root, the epoch, whether it pays Bitcoin Cash or FLDCH, and whether the published file matches that root.
- **Your address.** Paste a mainnet cashaddr or connect Paytaca. Build proof shows the leaf and whether it matches.
- **One payment.** The contract pays that leaf's amount to that locking script, once. A replay, a bad sibling, or the wrong key fails.
- **Recorded payments.** Only a mainnet claim is shown. None is published yet.
- **Same person on Nostr.** Paste a binding. It has to name this cashaddr. It does not pay anything.

The desk takes a mainnet cashaddr. Mock-network claim files are not shown.

## Tech stack

| Piece | What it is |
| --- | --- |
| App | Next.js 15, React 18, TypeScript, Tailwind, port 3001 |
| Contract | SolidCash `ClaimForge.scash`, compiled and tested with `@solidcash/solidhat` 0.51 |
| Proofs | `verifyMerkleProof` in `packages/contracts` |
| Identity check | `@bchblaze/identity`, the same `verify()` as Nostrobridge |
| Tests | solidhat on the mock network: two claims, a replay, a bad sibling, a wrong key |
| Package manager | pnpm 9.15, Node 18+ |

No ClaimForge contract is deployed on mainnet. A recorded payment appears on the desk only after a mainnet transaction is published.

## Hackathon requirements

| Requirement | Where it is |
| --- | --- |
| A published list of entitlements | Epoch root, depth-4 Merkle tree |
| The claimant pulls their own output | `claimBch` and `claimToken` |
| The payer cannot redirect a leaf | HASH160, locking script, and amount are checked in the covenant |
| A leaf cannot be paid twice | `claimed` mapping, replay test |
| Bitcoin Cash or a token category | 32 zero bytes, or the category id. FLDCH is documented in the protocol note |
| A third party can check without the app | Rebuild the leaf, fold the siblings, inspect the paid output |
| Optional link to a Nostr identity | Binding HASH160 must match the leaf. Coins do not move |
| Working demo | `pnpm dev`, paste a mainnet cashaddr, Build proof |

## Run

```bash
pnpm install
pnpm dev
```

Open http://localhost:3001. The published root should read Matches. Paste a mainnet cashaddr and build a proof.

Contract tests:

```bash
pnpm test:contracts
```
