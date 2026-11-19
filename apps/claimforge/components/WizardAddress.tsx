"use client";

import { useEffect, useRef, useState } from "react";
import { useWizardConnect, WizardConnectQRDialog } from "@wizardconnect/react";
import { encodeCashAddress, hash160, prefixForNetwork } from "@bchblaze/identity";

function cashaddrFromPubkey(pubkey: Uint8Array): string {
  let compressed = pubkey;
  if (pubkey.length === 32) {
    compressed = new Uint8Array(33);
    compressed[0] = 0x02;
    compressed.set(pubkey, 1);
  }
  if (compressed.length !== 33 && compressed.length !== 65) {
    throw new Error("Unexpected pubkey length");
  }
  return encodeCashAddress(prefixForNetwork("mainnet"), "p2pkh", hash160(compressed));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

type LinkState = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

function buttonLabel(state: LinkState): string {
  switch (state) {
    case "connecting":
    case "reconnecting":
      return "Connecting";
    case "connected":
      return "Reconnect";
    case "idle":
    case "disconnected":
      return "Connect";
    default: {
      const unexpected: never = state;
      return unexpected;
    }
  }
}

export function WizardAddress({ onAddress }: { onAddress: (address: string) => void }) {
  const wc = useWizardConnect({
    dappName: "ClaimForge",
    sessionKey: "claimforge-wizardconnect",
    persistSession: false,
  });
  const [error, setError] = useState<string | null>(null);
  const onAddressRef = useRef(onAddress);
  const restart = useRef(false);
  onAddressRef.current = onAddress;

  useEffect(() => {
    if (!restart.current) return;
    if (wc.state !== "idle" && wc.state !== "disconnected") return;
    restart.current = false;
    wc.connect();
  }, [wc.state, wc.connect]);

  useEffect(() => {
    if (wc.state !== "connected" || !wc.manager) return;
    try {
      const manager = wc.manager as {
        getPubkey: (account: number, index: bigint) => Uint8Array | string | undefined;
      };
      const pubkey = manager.getPubkey(0, 0n);
      if (!pubkey) {
        setError("The wallet connected without a receive address.");
        return;
      }
      const bytes = typeof pubkey === "string" ? hexToBytes(pubkey) : pubkey;
      onAddressRef.current(cashaddrFromPubkey(bytes));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [wc.state, wc.manager]);

  function openWallet() {
    if (wc.state === "idle" || wc.state === "disconnected") {
      wc.connect();
      return;
    }
    restart.current = true;
    void wc.disconnect();
  }

  return (
    <div>
      <button
        type="button"
        className="border border-ink bg-paper px-3 py-1.5 text-sm hover:bg-ink hover:text-paper"
        onClick={openWallet}
      >
        {buttonLabel(wc.state)}
      </button>
      {wc.uri && wc.qrUri ? (
        <WizardConnectQRDialog
          show={wc.state === "connecting" || wc.state === "reconnecting"}
          onClose={() => void wc.disconnect()}
          uri={wc.uri}
          qrUri={wc.qrUri}
          title="Connect"
          subtitle="Scan with a wallet"
        />
      ) : null}
      {error ?? wc.error ? <p className="mt-3 text-sm">{error ?? wc.error}</p> : null}
    </div>
  );
}
