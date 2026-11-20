import { useMemo } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { createArcClient, type ArcClient } from "@arcvault/sdk";
import { testnet } from "./deployment";

/** Builds an ArcClient on the live stack (deployment.ts: v3) from the connected wallet (null while there is no public
 *  client). */
export function useArc(): ArcClient | null {
  const pub = usePublicClient();
  const { data: wallet } = useWalletClient();
  return useMemo(
    () => (pub ? createArcClient({ publicClient: pub as any, walletClient: (wallet as any) ?? undefined, deployment: testnet }) : null),
    [pub, wallet],
  );
}
