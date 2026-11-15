// d'abord : un navigateur qui bloque le stockage du site ne doit pas faire tomber la page (wagmi, RainbowKit)
import "./safeStorage";
import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";
import { config } from "./wagmi";
import { useLang } from "./i18n";
import App from "./App";

const qc = new QueryClient();
const theme = darkTheme({ accentColor: "#5b8cff", accentColorForeground: "#070b16", borderRadius: "medium" });

/** La fenêtre de connexion de RainbowKit suit la langue du site (en-US / fr-FR). */
function Root() {
  const lang = useLang();
  return (
    <RainbowKitProvider locale={lang === "fr" ? "fr-FR" : "en-US"} theme={theme}>
      <App />
    </RainbowKitProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <Root />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
