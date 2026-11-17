"use client";

import { useEffect, useMemo, useState } from "react";
import { decodeCashAddress, isP2pkhType, verify } from "@bchblaze/identity";
import {
  bytesEqual,
  bytesToHex,
  hexToBytes,
  publishDistribution,
  verifyMerkleProof,
  type ClaimAsset,
} from "@bchblaze/contracts";
import { siteConfig } from "@/lib/config";
import { copyText } from "@/lib/copy";
import { connectPaytaca, paytacaInstalled } from "@/lib/paytaca";
import {
  explorerUrl,
  type DistributionFile,
  type LastClaimFile,
  type PublishedEntitlementFile,
} from "@/lib/types";

interface LoadedDistribution {
  file: DistributionFile;
  recomputedRoot: string;
  matches: boolean;
}

interface BuiltProof {
  entitlement: PublishedEntitlementFile;
  address: string;
  verified: boolean;
}

function assetUnit(asset: ClaimAsset): string {
  switch (asset) {
    case "bch":
      return "sats";
    case "fldch":
      return "FLDCH base units";
    default: {
      const unexpected: never = asset;
      return unexpected;
    }
  }
}

function isDistribution(value: unknown): value is DistributionFile {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DistributionFile>;
  return record.protocol === "claimforge/v1" && typeof record.root === "string" && Array.isArray(record.entitlements);
}

function isLastClaim(value: unknown): value is LastClaimFile {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LastClaimFile>;
  return typeof record.root === "string" && Array.isArray(record.claims) && typeof record.network === "string";
}

function recompute(file: DistributionFile): string {
  const published = publishDistribution(
    file.epoch,
    file.asset,
    file.entitlements.map((entry) => ({
      index: entry.index,
      label: entry.label,
      claimantPkh: entry.claimantPkh,
      amount: entry.amount,
    })),
  );
  return published.root;
}

function publishedProofMatches(file: DistributionFile): boolean {
  const published = publishDistribution(
    file.epoch,
    file.asset,
    file.entitlements.map((entry) => ({
      index: entry.index,
      label: entry.label,
      claimantPkh: entry.claimantPkh,
      amount: entry.amount,
    })),
  );
  if (published.root !== file.root || published.assetCategory !== file.assetCategory) return false;
  return file.entitlements.every((entry, index) => {
    const rebuilt = published.entitlements[index];
    if (rebuilt === undefined) return false;
    return (
      rebuilt.leaf === entry.leaf &&
      rebuilt.path === entry.path &&
      rebuilt.siblings[0] === entry.siblings[0] &&
      rebuilt.siblings[1] === entry.siblings[1] &&
      rebuilt.siblings[2] === entry.siblings[2] &&
      rebuilt.siblings[3] === entry.siblings[3]
    );
  });
}

export function ClaimDesk() {
  const [loaded, setLoaded] = useState<LoadedDistribution | null>(null);
  const [claims, setClaims] = useState<LastClaimFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [walletNote, setWalletNote] = useState<string | null>(null);
  const [proof, setProof] = useState<BuiltProof | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [bindingText, setBindingText] = useState("");
  const [bindingNote, setBindingNote] = useState<string | null>(null);
  const [hasPaytaca, setHasPaytaca] = useState(false);

  useEffect(() => {
    setHasPaytaca(paytacaInstalled());
    let cancelled = false;
    async function load() {
      try {
        const distributionResponse = await fetch("/distribution.json");
        if (!distributionResponse.ok) throw new Error("distribution.json is not published");
        const distributionBody: unknown = await distributionResponse.json();
        if (!isDistribution(distributionBody)) throw new Error("distribution.json is not claimforge/v1");
        const recomputedRoot = recompute(distributionBody);
        const matches = recomputedRoot === distributionBody.root && publishedProofMatches(distributionBody);
        if (!cancelled) setLoaded({ file: distributionBody, recomputedRoot, matches });
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
      try {
        const claimResponse = await fetch("/last-claim.json");
        if (!claimResponse.ok) return;
        const claimBody: unknown = await claimResponse.json();
        if (!cancelled && isLastClaim(claimBody)) setClaims(claimBody);
      } catch {
        if (!cancelled) setClaims(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const file = loaded?.file;

  function buildProof(nextAddress: string) {
    setProof(null);
    setProofError(null);
    setBindingNote(null);
    if (!loaded || !file) {
      setProofError("The published root is not loaded");
      return;
    }
    if (!loaded.matches) {
      setProofError("The published file does not recompute to its own root. Refusing to build a proof.");
      return;
    }
    let decoded;
    try {
      decoded = decodeCashAddress(nextAddress.trim());
    } catch (error) {
      setProofError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!isP2pkhType(decoded.type)) {
      setProofError("ClaimForge leaves are P2PKH. Token-aware P2PKH is accepted. P2SH is not.");
      return;
    }
    const pkh = bytesToHex(decoded.hash);
    const entitlement = file.entitlements.find((entry) => entry.claimantPkh === pkh);
    if (entitlement === undefined) {
      setProofError(`No leaf in epoch ${file.epoch} pays ${pkh}`);
      return;
    }
    const siblings = entitlement.siblings.map((sibling) => hexToBytes(sibling)) as [
      Uint8Array,
      Uint8Array,
      Uint8Array,
      Uint8Array,
    ];
    const verified = verifyMerkleProof(hexToBytes(entitlement.leaf), siblings, entitlement.path, hexToBytes(file.root));
    setProof({ entitlement, address: nextAddress.trim(), verified });
  }

  function checkBinding() {
    setBindingNote(null);
    if (!proof) {
      setBindingNote("Build a proof before checking a binding.");
      return;
    }
    const result = verify(bindingText);
    if (!result.ok || result.binding === undefined) {
      setBindingNote(result.details.join(" "));
      return;
    }
    let decoded;
    try {
      decoded = decodeCashAddress(result.binding.statement.bchAddress);
    } catch (error) {
      setBindingNote(error instanceof Error ? error.message : String(error));
      return;
    }
    const same = bytesEqual(decoded.hash, hexToBytes(proof.entitlement.claimantPkh));
    if (!same) {
      setBindingNote("The binding is valid, and it belongs to a different cashaddr than this leaf.");
      return;
    }
    setBindingNote(
      `Binding verified. Nostr ${result.binding.statement.nostrPubkey.slice(0, 16)}… is the same HASH160 as this leaf. The binding does not move the coins.`,
    );
  }

  const recorded = useMemo(() => {
    if (!claims || !file || !proof) return [];
    if (claims.root !== file.root) return [];
    return claims.claims.filter((claim) => claim.who === proof.entitlement.label);
  }, [claims, file, proof]);

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-bch-400">FoldingCash · SolidCash</p>
        <h1 className="text-4xl text-white sm:text-5xl">ClaimForge</h1>
        <p className="text-slate-300">
          A publisher commits a Merkle root of who is owed what. Each claimant pulls their own output. The covenant
          checks the proof, the signature, and the P2PKH lock, then marks that leaf spent.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
          <h2 className="text-lg text-white">Published root</h2>
          {loadError ? <p className="mt-3 text-sm text-rose-300">{loadError}</p> : null}
          {file && loaded ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Root</dt>
                <dd className="break-all font-mono text-xs text-bch-400">{file.root}</dd>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <dt className="text-slate-500">Epoch</dt>
                  <dd>{file.epoch}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Asset</dt>
                  <dd>{file.asset === "bch" ? "BCH" : "FLDCH"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Depth</dt>
                  <dd>{file.depth}</dd>
                </div>
              </div>
              <div>
                <dt className="text-slate-500">Recomputed in this page</dt>
                <dd className={loaded.matches ? "text-bch-400" : "text-rose-300"}>
                  {loaded.matches ? "Matches the published root and every sibling." : "Does not match. Proofs are disabled."}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">FLDCH category, when this epoch pays the token</dt>
                <dd className="break-all font-mono text-[11px] text-slate-300">{siteConfig.fldchCategory}</dd>
              </div>
              {file.note ? <p className="text-slate-400">{file.note}</p> : null}
            </dl>
          ) : null}
        </article>

        <article className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
          <h2 className="text-lg text-white">Claimant</h2>
          <p className="mt-2 text-sm text-slate-400">
            Paste a cashaddr, or fill one of the published demo holders. Paytaca fills the connected address when the
            extension is present.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {file?.holders?.map((holder) => (
              <button
                key={holder.address}
                type="button"
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200 hover:border-bch-500/50"
                onClick={() => setAddress(holder.address)}
              >
                {holder.label}
              </button>
            ))}
            <button
              type="button"
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200 hover:border-nostr-400/60"
              onClick={() => {
                void connectPaytaca()
                  .then((connected) => {
                    setAddress(connected);
                    setWalletNote("Paytaca returned this address. The proof is still checked against the published root.");
                  })
                  .catch((error: unknown) => {
                    setWalletNote(error instanceof Error ? error.message : String(error));
                  });
              }}
            >
              {hasPaytaca ? "Connect Paytaca" : "Connect Paytaca if installed"}
            </button>
          </div>
          <label className="mt-4 block text-xs text-slate-500" htmlFor="cashaddr">
            Cashaddr
          </label>
          <textarea
            id="cashaddr"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            rows={2}
            spellCheck={false}
            className="mt-1 w-full rounded-xl border border-white/10 bg-ink-950 px-3 py-2 font-mono text-xs text-slate-100"
            placeholder="bitcoincash:q…"
          />
          <button
            type="button"
            className="mt-3 rounded-xl bg-bch-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-bch-400"
            onClick={() => buildProof(address)}
          >
            Build proof
          </button>
          {walletNote ? <p className="mt-3 text-sm text-slate-300">{walletNote}</p> : null}
          {proofError ? <p className="mt-3 text-sm text-rose-300">{proofError}</p> : null}
        </article>
      </section>

      {proof && file ? (
        <section className="rounded-2xl border border-bch-500/30 bg-ink-900/80 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg text-white">{proof.entitlement.label}</h2>
              <p className="text-sm text-slate-400">
                {proof.entitlement.amount} {assetUnit(file.asset)} · index {proof.entitlement.index} · path {proof.entitlement.path}
              </p>
            </div>
            <p className={proof.verified ? "text-sm text-bch-400" : "text-sm text-rose-300"}>
              {proof.verified ? "Local fold matches the published root." : "Local fold failed."}
            </p>
          </div>
          <dl className="mt-4 space-y-3 text-xs">
            <div>
              <dt className="text-slate-500">Leaf</dt>
              <dd className="break-all font-mono text-slate-200">{proof.entitlement.leaf}</dd>
            </div>
            {proof.entitlement.siblings.map((sibling, index) => (
              <div key={`${index}-${sibling}`}>
                <dt className="text-slate-500">Sibling {index}</dt>
                <dd className="break-all font-mono text-slate-300">{sibling}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-slate-400">
            The covenant also requires a transaction signature from the key behind this cashaddr, and a payout output
            locked to that same P2PKH script for this amount. This page does not hold that key.
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
        <h2 className="text-lg text-white">Transaction the covenant accepted</h2>
        {!claims ? (
          <p className="mt-3 text-sm text-slate-400">
            No captured claim yet. The solidhat suite writes <span className="font-mono">public/last-claim.json</span> when
            a valid claim pays.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-slate-300">{claims.note}</p>
            <p className="text-xs text-slate-500">
              Network <span className="font-mono text-slate-300">{claims.network}</span>
              {claims.root === file?.root ? " · same root as the file above" : " · root differs from the loaded file"}
            </p>
            {(recorded.length > 0 ? recorded : claims.claims).map((claim) => {
              const href = explorerUrl(claims.network, claim.txid);
              return (
                <article key={claim.txid} className="rounded-xl border border-white/10 p-4">
                  <p className="text-sm text-white">
                    {claim.who} · {claim.amountSats} sats
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-bch-400">{claim.txid}</p>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-amber-200">
                      Open on the explorer
                    </a>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">
                      Mock-network transaction. A block explorer will not find this txid. The hex is the transaction the
                      Bitcoin Cash 2026 VM executed.
                    </p>
                  )}
                  <button
                    type="button"
                    className="mt-3 rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-200"
                    onClick={() => {
                      void copyText(claim.hex);
                    }}
                  >
                    Copy raw transaction
                  </button>
                  <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-400">
                    {claim.hex}
                  </pre>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
        <h2 className="text-lg text-white">Bind the leaf to a Nostr key</h2>
        <p className="mt-2 text-sm text-slate-400">
          Paste a bchblaze-id event or binding record. Verification is offline. The cashaddr inside the statement has to
          be the same HASH160 as the leaf you just built.
        </p>
        <textarea
          value={bindingText}
          onChange={(event) => setBindingText(event.target.value)}
          rows={5}
          spellCheck={false}
          className="mt-3 w-full rounded-xl border border-white/10 bg-ink-950 px-3 py-2 font-mono text-xs"
          placeholder='{"kind":30734,...}'
        />
        <button
          type="button"
          className="mt-3 rounded-xl border border-nostr-400/40 px-4 py-2 text-sm text-slate-100"
          onClick={checkBinding}
        >
          Verify binding
        </button>
        {bindingNote ? <p className="mt-3 text-sm text-slate-200">{bindingNote}</p> : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5 text-sm text-slate-300">
        <h2 className="text-lg text-white">How a third party checks a claim</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>Read the root, epoch, and asset category from the contract data NFT, or from this published file after recomputing it.</li>
          <li>
            Leaf preimage, 65 bytes, little-endian amounts: <span className="font-mono text-xs">01 || pkh[20] || amount[8] || epoch[4] || category[32]</span>.
            One SHA-256. BCH uses 32 zero bytes as the category. FLDCH uses {siteConfig.fldchCategory}.
          </li>
          <li>Fold four siblings. A set path bit means the node is the right child: hash sibling then node. A clear bit hashes node then sibling.</li>
          <li>The payout output must be the standard P2PKH script for that hash, for that amount. The same leaf cannot be claimed again.</li>
        </ol>
        <p className="mt-3 text-slate-400">
          The full note is <span className="font-mono">packages/contracts/CLAIMFORGE.md</span>. Run the covenant tests with{" "}
          <span className="font-mono">pnpm --filter @bchblaze/contracts test</span>.
        </p>
      </section>
    </div>
  );
}
