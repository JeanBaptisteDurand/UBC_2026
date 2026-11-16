/** constants.ts — valeurs par défaut de l'agent opérateur (surchargées par les options ou l'environnement). */

export const DEFAULT_API = "https://archive.62-171-153-35.sslip.io/api"; // HTTPS : la clé arcop_ ne circule jamais en clair
export const DEFAULT_WEB = "https://archive.62-171-153-35.sslip.io";
export const DEFAULT_RPC = "https://rpc.testnet.arc.io";

export const DEFAULT_PORT = 8802;
/** port d'écoute de l'enclave DANS le conteneur (image sealed-chat : PORT=8802) */
export const ENCLAVE_INNER_PORT = 8802;
export const CONTAINER = "archive-enclave";
/** image de l'enclave d'inférence, pile v2.1 (celle de enclave/phala/sealed-chat-v21.yml), épinglée par digest */
export const DEFAULT_IMAGE =
  "ghcr.io/jeanbaptistedurand/archive-sealed-chat@sha256:5699da226fb3f1e0f09234c8f9330b5a5414eb8d5bc619854953d10dbe7edc3f";

/** produit servi par défaut : 1, l'inférence privée de la pile v2 (vraie machine Intel TDX). Sans TDX (--demo) : essai
 *  LOCAL seulement, rien n'est inscrit sur le réseau (le registre v2 vérifie chaque quote par DCAP : une attestation
 *  simulée est refusée). */
export const PRODUCT_TDX = 1;
export const PRODUCT_DEMO = 1;

/** Arc testnet, pile v2.1 (deployments.v21.testnet.json) : passés au conteneur (l'image n'a aucune adresse par défaut
 *  qui vaille pour la v2.1). */
export const CHAIN_ID = 5042002;
export const ENCLAVE_REGISTRY = "0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d";
export const SESSION_PAY = "0x8Bf8A8356f53006E9aB359AA6382f783923058a6";

export const HEARTBEAT_MS = 30_000;
/** pendant le démarrage de l'enclave, on bat plus vite pour que le site passe vite à « en service » */
export const HEARTBEAT_STARTING_MS = 5_000;
/** au-delà, une enclave qui ne répond toujours pas est « en erreur » */
export const STARTUP_GRACE_MS = 120_000;
export const MAX_LOG_LINES = 100;
export const CLOCK_MAX_SKEW_S = 30;

export const DSTACK_SOCKET = "/var/run/dstack.sock";
export const TDX_DEVICES = ["/dev/tdx_guest", "/dev/tdx-guest"] as const;
export const TSM_REPORT_DIR = "/sys/kernel/config/tsm/report";

/** étiquettes Docker posées sur le conteneur : elles disent qu'il est à nous et avec quelle configuration */
export const LABEL_OWNER = "io.archive.owner";
/** révision de la commande « docker run » : la changer fait remplacer les conteneurs existants
 *  (3 : pile v2 — contrats v2, OPERATOR_ALLOWLIST, image v2) */
export const RUN_SPEC = "3";
