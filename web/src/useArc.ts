import { useMemo } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { createArcClient, type ArcClient } from "@arcvault/sdk";

/** Construit un ArcClient à partir du wallet connecté (null tant qu'il n'y a pas de client public). */
export function useArc(): ArcClient | null {
  const pub = usePublicClient();
  const { data: wallet } = useWalletClient();
  return useMemo(
    () => (pub ? createArcClient({ publicClient: pub as any, walletClient: (wallet as any) ?? undefined }) : null),
    [pub, wallet],
  );
}
