interface PaytacaBridge {
  connect: () => void;
  connected: () => Promise<boolean>;
  address: () => Promise<string>;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    paytaca?: PaytacaBridge;
  }
}

export function paytacaInstalled(): boolean {
  return typeof window !== "undefined" && window.paytaca !== undefined;
}

export async function connectPaytaca(): Promise<string> {
  const bridge = window.paytaca;
  if (bridge === undefined) throw new Error("Paytaca is not installed in this browser");
  const already = await bridge.connected().catch(() => false);
  if (!already) {
    await new Promise<void>((resolveConnect, reject) => {
      const timer = setTimeout(() => reject(new Error("Paytaca connect timed out")), 60_000);
      bridge.on("addressChanged", () => {
        clearTimeout(timer);
        resolveConnect();
      });
      try {
        bridge.connect();
      } catch (error) {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  return bridge.address();
}
