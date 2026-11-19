import { createStorage, http, createConnector } from "wagmi";
import { injected } from "wagmi/connectors";
import { getDefaultConfig, type Wallet } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { arcTestnet } from "@arcvault/sdk";
import { testSignerToken, makeTestProvider, TEST_ICON } from "./testWallet";
import { safeStorage } from "./safeStorage";
import { t } from "./i18n";

// RainbowKit: MetaMask, Rainbow, Coinbase, WalletConnect, and any injected wallet.
// WalletConnect requires a real projectId (otherwise only injected wallets work): VITE_WC_PROJECT_ID.
const projectId = (import.meta as any).env?.VITE_WC_PROJECT_ID ?? "archive_demo_project_id";

// TEST MODE (Arc testnet): visible only with a token (see testWallet.ts).
// The test wallet's name is read once, in the language of the page load (the wagmi config is created once, and
// RainbowKit copies the wallet names when it is created).
const token = typeof window !== "undefined" ? testSignerToken() : null;
const archiveTestWallet = (): Wallet => ({
  id: "archive-test-signer",
  name: t("wallet.test.name"),
  iconUrl: TEST_ICON,
  iconBackground: "#fbbf24",
  createConnector: (walletDetails) =>
    createConnector((config) => ({
      ...injected({ target: () => ({ id: "archiveTestSigner", name: t("wallet.test.name"), provider: makeTestProvider(token!) as any }) })(config),
      ...walletDetails,
    })),
});

export const isTestMode = !!token;

/** The browser's generic wallet (RainbowKit's "Browser Wallet", shown when no wallet is recognised): named in the
 *  language of the page load, like the test wallet (« Portefeuille du navigateur » on the French site, where the rest of
 *  the window says « portefeuille »). */
const browserWallet = (): Wallet => ({ ...injectedWallet(), name: t("wallet.browser.name") });

/** Group names of the connect window. "Recommended" is one of the names RainbowKit translates itself into its `locale`
 *  (so it follows the site's language without a reload: « Recommandé » in French); "Test (Arc testnet)" reads the same
 *  in both languages. A name translated here would be frozen when the config is created. */
const GROUP_RECOMMENDED = "Recommended";
const GROUP_TEST = "Test (Arc testnet)";

/** wagmi's WalletConnect connector is prepared only when it is needed: preparing it when the config is created
 *  (setup → getProvider) would load its SDK (≈ 230 kB compressed) and call WalletConnect's servers on every page load,
 *  before the console is usable, even for a visitor who never connects. It is prepared at connect time (connect()
 *  wires what setup would) or to reconnect the wallet used last time (main.tsx). Injected wallets (extensions) and
 *  Coinbase are unchanged. */
const lazyWalletConnect = <W extends (...a: any[]) => Wallet>(w: W): W => ((...a: any[]) => {
  const wallet = w(...a);
  return {
    ...wallet,
    createConnector: (details: any) => {
      const create = wallet.createConnector(details) as any;
      return ((cfg: any) => {
        const c = create(cfg);
        return c?.type === "walletConnect" ? { ...c, setup: undefined } : c;
      }) as any;
    },
  };
}) as unknown as W;

export const config = getDefaultConfig({
  appName: "ArcHive",
  projectId,
  chains: [arcTestnet],
  transports: { [arcTestnet.id]: http() },
  ssr: false,
  // guarded storage: a browser that blocks site data cannot bring the page down (safeStorage.ts)
  storage: createStorage({ storage: safeStorage }),
  wallets: [
    { groupName: GROUP_RECOMMENDED, wallets: [lazyWalletConnect(metaMaskWallet), lazyWalletConnect(rainbowWallet), coinbaseWallet, lazyWalletConnect(walletConnectWallet), browserWallet] },
    ...(token ? [{ groupName: GROUP_TEST, wallets: [archiveTestWallet] }] : []),
  ],
});
