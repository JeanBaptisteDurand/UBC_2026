// d'abord : un navigateur qui bloque le stockage du site ne doit pas faire tomber la page (wagmi, RainbowKit)
import "./safeStorage";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { reconnect } from "wagmi/actions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";
import { config } from "./wagmi";
import { useLang } from "./i18n";
import App from "./App";

const qc = new QueryClient();
const theme = darkTheme({ accentColor: "#5b8cff", accentColorForeground: "#070b16", borderRadius: "medium" });

/** 19/11 (r2) : au démarrage, wagmi demandait à CHAQUE portefeuille s'il était déjà autorisé : cela chargeait le SDK de
 *  WalletConnect (≈ 230 ko compressés) et appelait ses serveurs avant que la console soit utilisable, même pour un
 *  visiteur qui ne s'est jamais connecté. On ne reconnecte que le portefeuille utilisé la dernière fois (wagmi le note) ;
 *  s'il n'est plus dans la liste, comme avant, tous ; sans portefeuille noté, aucun : les autres se chargent quand on
 *  touche « Connect ». */
function useLastWallet() {
  useEffect(() => {
    let alive = true;
    (async () => {
      let id: string | null = null;
      try { id = (await config.storage?.getItem("recentConnectorId")) ?? null; } catch { /* stockage illisible : aucun */ }
      if (!alive || !id) return;
      const last = config.connectors.filter((c) => c.id === id);
      reconnect(config, last.length ? { connectors: last } : {}).catch(() => {});
    })();
    return () => { alive = false; };
  }, []);
}

/** La fenêtre de connexion de RainbowKit suit la langue du site (en-US / fr-FR). */
function Root() {
  useLastWallet();
  const lang = useLang();
  return (
    <RainbowKitProvider locale={lang === "fr" ? "fr-FR" : "en-US"} theme={theme}>
      <App />
    </RainbowKitProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={config} reconnectOnMount={false}>
      <QueryClientProvider client={qc}>
        <Root />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
