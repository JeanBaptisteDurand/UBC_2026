// first: a browser that blocks the site's storage must not bring the page down (wagmi, RainbowKit)
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
import App from "./App";

const qc = new QueryClient();
const theme = darkTheme({ accentColor: "#5b8cff", accentColorForeground: "#070b16", borderRadius: "medium" });

/** On startup, only the wallet used last time is reconnected (wagmi records it): asking EVERY wallet whether it is
 *  already authorised would load WalletConnect's SDK (≈ 230 kB compressed) and call its servers before the console is
 *  usable, even for a visitor who has never connected. If that wallet is no longer in the list, all of them are tried;
 *  with no recorded wallet, none: the others load when "Connect" is pressed. */
function useLastWallet() {
  useEffect(() => {
    let alive = true;
    (async () => {
      let id: string | null = null;
      try { id = (await config.storage?.getItem("recentConnectorId")) ?? null; } catch { /* unreadable storage: none */ }
      if (!alive || !id) return;
      const last = config.connectors.filter((c) => c.id === id);
      reconnect(config, last.length ? { connectors: last } : {}).catch(() => {});
    })();
    return () => { alive = false; };
  }, []);
}

/** RainbowKit's connect window is in English, like the whole site (whatever the browser's language). */
function Root() {
  useLastWallet();
  return (
    <RainbowKitProvider locale="en-US" theme={theme}>
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
