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
import { copyText } from "@/lib/copy";
import { connectPaytaca } from "@/lib/paytaca";
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

  useEffect(() => {
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
        if (!cancelled && isLastClaim(claimBody) && claimBody.network === "mainnet") setClaims(claimBody);
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
    if (decoded.network !== "mainnet") {
      setProofError("ClaimForge pays a mainnet cashaddr.");
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
    if (decoded.network !== "mainnet") {
      setBindingNote("The binding is valid, and its address is not mainnet.");
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

  const control = "mt-1 w-full border border-ink bg-paper px-3 py-2 font-mono text-xs";
  const quiet = "border border-ink bg-paper px-3 py-1.5 text-sm hover:bg-ink hover:text-paper";

  return (
    <div>
      <div>
        <h1 className="max-w-xl">Pull your own payment from a published list.</h1>
        <p className="lede">
          A Merkle root names who is owed what. Paste your address, build the proof, and the contract pays that leaf once.
        </p>
      </div>

      <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:gap-14">
        <div className="space-y-10 lg:sticky lg:top-8">
          <section className="border-t border-ink pt-5">
            <h2>Published list</h2>
            {loadError ? <p className="mt-3 text-sm">{loadError}</p> : null}
            {file && loaded ? (
              <dl className="mt-4 space-y-4 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink/60">Root</dt>
                  <dd className="mt-1 break-all font-mono text-xs">{file.root}</dd>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink/60">Epoch</dt>
                    <dd className="mt-1">{file.epoch}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink/60">Pays</dt>
                    <dd className="mt-1">{file.asset === "bch" ? "Bitcoin Cash" : "FLDCH"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink/60">Check</dt>
                    <dd className="mt-1">{loaded.matches ? "Matches" : "Mismatch"}</dd>
                  </div>
                </div>
              </dl>
            ) : null}
          </section>

          <section className="border-t border-ink pt-5">
            <h2>Recorded payments</h2>
            {!claims ? (
              <p className="mt-3 text-sm text-ink/60">None on mainnet yet.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {(recorded.length > 0 ? recorded : claims.claims).map((claim) => {
                  const href = explorerUrl(claims.network, claim.txid);
                  return (
                    <article key={claim.txid}>
                      <p className="text-sm">
                        {claim.who} · {claim.amountSats} sats
                        {claims.network === "mock" ? " · mock network" : ""}
                      </p>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-xs">
                          {claim.txid}
                        </a>
                      ) : (
                        <p className="mt-1 break-all font-mono text-xs text-ink/70">{claim.txid}</p>
                      )}
                      <button type="button" className={`${quiet} mt-3`} onClick={() => void copyText(claim.hex)}>
                        Copy transaction
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="mt-10 space-y-10 lg:mt-0">
          <section className="border-t border-ink pt-5">
            <h2>Your address</h2>
            <div className="mt-4">
              <button
                type="button"
                className={quiet}
                onClick={() => {
                  void connectPaytaca()
                    .then((connected) => {
                      setAddress(connected);
                      setWalletNote(null);
                    })
                    .catch((error: unknown) => {
                      setWalletNote(error instanceof Error ? error.message : String(error));
                    });
                }}
              >
                Paytaca
              </button>
            </div>
            <label className="mt-4 block text-xs uppercase tracking-wide text-ink/60" htmlFor="cashaddr">
              Cashaddr
            </label>
            <textarea
              id="cashaddr"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              rows={2}
              className={control}
              placeholder="bitcoincash:q…"
            />
            <button type="button" className="mt-3 bg-ink px-3 py-1.5 text-sm text-paper" onClick={() => buildProof(address)}>
              Build proof
            </button>
            {walletNote ? <p className="mt-3 text-sm">{walletNote}</p> : null}
            {proofError ? <p className="mt-3 text-sm">{proofError}</p> : null}
          </section>

          {proof && file ? (
            <section className="border-t border-ink pt-5">
              <h2>
                {proof.entitlement.label} · {proof.entitlement.amount} {assetUnit(file.asset)}
              </h2>
              <p className="mt-1 text-sm text-ink/70">{proof.verified ? "Proof matches the published root." : "Proof does not match."}</p>
              <p className="mt-3 break-all font-mono text-xs text-ink/70">{proof.entitlement.leaf}</p>
            </section>
          ) : null}

          <section className="border-t border-ink pt-5">
            <h2>Same person on Nostr</h2>
            <p className="lede">Paste a binding. It has to name this same address. It does not move the coins.</p>
            <textarea
              value={bindingText}
              onChange={(event) => setBindingText(event.target.value)}
              rows={4}
              className={control}
              placeholder="Binding JSON"
            />
            <button type="button" className={`${quiet} mt-3`} onClick={checkBinding}>
              Check binding
            </button>
            {bindingNote ? <p className="mt-3 text-sm">{bindingNote}</p> : null}
          </section>
        </div>
      </div>
    </div>
  );
}
