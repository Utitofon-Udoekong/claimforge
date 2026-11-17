export interface PublishedEntitlementFile {
  index: number;
  label: string;
  claimantPkh: string;
  amount: string;
  leaf: string;
  path: number;
  siblings: [string, string, string, string];
}

export interface DistributionFile {
  protocol: "claimforge/v1";
  epoch: number;
  asset: "bch" | "fldch";
  assetCategory: string;
  depth: number;
  root: string;
  note?: string;
  holders?: Array<{ label: string; address: string }>;
  entitlements: PublishedEntitlementFile[];
}

export type ClaimNetwork = "mock" | "chipnet" | "mainnet";

export interface RecordedClaim {
  who: string;
  amountSats: string;
  txid: string;
  hex: string;
}

export interface LastClaimFile {
  network: ClaimNetwork;
  note: string;
  root: string;
  claims: RecordedClaim[];
}

export function explorerUrl(network: ClaimNetwork, txid: string): string | null {
  switch (network) {
    case "mock":
      return null;
    case "chipnet":
      return `https://chipnet.imaginary.cash/tx/${txid}`;
    case "mainnet":
      return `https://explorer.electroncash.de/tx/${txid}`;
    default: {
      const unexpected: never = network;
      return unexpected;
    }
  }
}
