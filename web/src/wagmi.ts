import { createStorage, http, createConnector } from "wagmi";
import { injected } from "wagmi/connectors";
import { getDefaultConfig, type Wallet } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { arcTestnet } from "@arcvault/sdk";
import { testSignerToken, makeTestProvider, TEST_ICON } from "./testWallet";
import { safeStorage } from "./safeStorage";
import { t } from "./i18n";

// RainbowKit : MetaMask, Rainbow, Coinbase, WalletConnect, et tout wallet injecté.
// WalletConnect exige un projectId réel (sinon seuls les wallets injectés marchent) : VITE_WC_PROJECT_ID.
const projectId = (import.meta as any).env?.VITE_WC_PROJECT_ID ?? "archive_demo_project_id";

// MODE TEST (Arc testnet) : visible seulement avec un jeton (voir testWallet.ts).
// Le nom du wallet de test est lu une fois, dans la langue du chargement de la page (la config wagmi est créée une
// fois, et RainbowKit recopie les noms des wallets à sa création).
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

/** Le portefeuille générique du navigateur (« Browser Wallet » de RainbowKit, montré quand aucun portefeuille n'est
 *  reconnu) : nommé dans la langue du chargement, comme le portefeuille de test (« Portefeuille du navigateur » sur le
 *  site français, où le reste de la fenêtre dit « portefeuille »). */
const browserWallet = (): Wallet => ({ ...injectedWallet(), name: t("wallet.browser.name") });

/** Noms des groupes de la fenêtre de connexion. « Recommended » est l'un des noms que RainbowKit traduit lui-même dans
 *  la langue de son `locale` (il suit donc la langue du site sans rechargement : « Recommandé » en français) ; « Test
 *  (Arc testnet) » se lit pareil dans les deux langues. Un nom traduit ici serait figé à la création de la config. */
const GROUP_RECOMMENDED = "Recommended";
const GROUP_TEST = "Test (Arc testnet)";

export const config = getDefaultConfig({
  appName: "ArcHive",
  projectId,
  chains: [arcTestnet],
  transports: { [arcTestnet.id]: http() },
  ssr: false,
  // stockage protégé : un navigateur qui bloque les données du site ne fait plus tomber la page (safeStorage.ts)
  storage: createStorage({ storage: safeStorage }),
  wallets: [
    { groupName: GROUP_RECOMMENDED, wallets: [metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet, browserWallet] },
    ...(token ? [{ groupName: GROUP_TEST, wallets: [archiveTestWallet] }] : []),
  ],
});
