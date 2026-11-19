# Déployer ArcHive (serveur 62.171.153.35)

Depuis le 16/11/2026, **un seul projet** sur le serveur, `/opt/archive`. Le site en ligne est **construit sur le serveur, à partir du code source qui s'y trouve**.

## Ce qui est servi

| Adresse | Quoi | Source |
|---|---|---|
| `/` , `/use.html`, `/service.html?p=<n>`, `/rent.html`, `/publish.html`, `/demo.html` | Le front de Florent (accueil avec la baie 3D, catalogue, fiches, Louer, Publier, démo rejouée), avec le panneau du copilote du site | `frontend/` |
| `/console/` (`#/vue`, `#/ruche`, `#/produits`, `#/primes`, `#/playground`, `#/cles`, `#/publier-prime`, `#/operateur`, `#/publier-produit`, `#/portefeuille`, `#/developpeurs`) | La console : wallet, sessions, clés, primes, opérateurs, publication, CCTP, docs développeurs, copilote de la console | `web/` |
| `/datacenter/` | La salle des serveurs en 3D | `web/public/datacenter/` (construite dans le dépôt UBC : `T-salle-serveurs-3d/site/build-site.sh`) |
| `/api/*` | L'API de lecture et l'index des événements | `services/api` |
| `/copilot/*` | Le copilote de la console | `services/copilot` |
| `/copilot-site/*` | Le copilote du site : le même programme avec `COPILOT_SURFACE=site`. Il pilote les pages du front et prépare des opérations que l'utilisateur signe | `services/copilot` |
| `/mcp` | Le serveur MCP en HTTP (Streamable HTTP, sans état ; lectures et actions préparées seulement) | `services/mcp` (`src/http.ts`) |
| `/install.sh`, `/archive-node.mjs`, `/manifests/` | L'agent des opérateurs et les manifestes des produits | `web/public/`, `packages/node` |
| `/enclave/<nom>/` | Le proxy de même origine vers les enclaves (VM Intel TDX chez Phala) | `deploy/nginx.conf` |
| `/arc-rpc` | La passerelle du nœud d'Arc. Le nœud a été supprimé le 16/11, faute de disque : `deploy/arc-node` permet de le réinstaller | `deploy/arc-node/` |

## Sur le serveur

| Quoi | Où |
|---|---|
| Code source complet, sans secrets | `/opt/archive/src` |
| Ce qui tourne | `/opt/archive` : `api.mjs`, `copilot.mjs`, `registrar.mjs`, `mcp-http.mjs`, `web/`, `docker-compose.yml`, `nginx.conf`, `Caddyfile` |
| Données (index des événements, machines appairées) | `/opt/archive/data` |
| Secrets, jamais dans le code | `/opt/archive/*.env` (droits 600) : `registrar-v2.env`, `test-signer.env`, `copilot.env`, `nginx.env` |
| Sauvegardes | `/root/backups/`, dont la v1 (`archive-v1-2026-11-16.tgz`) et le dépôt de Florent du 15/11 (`florent-frontend-2026-11-15.tgz`) |

## Depuis un poste de dev

```sh
./deploy/push.sh          # envoie le code (filtre : deploy/rsync-filter.txt), puis construit et relance LÀ-BAS
```

## Directement sur le serveur (après avoir modifié /opt/archive/src)

```sh
/opt/archive/src/deploy/deploy.sh      # tout : build.sh, configuration, relance des services, vérification
/opt/archive/src/deploy/build.sh web   # le site seul (front, console, salle 3D), sans toucher aux services
```

- **`build.sh`**, dans un conteneur Node 22, prend en charge :
  - les dépendances ;
  - les bundles `api`, `copilot`, `registrar` et `mcp-http` (esbuild) ;
  - l'agent `archive-node` ;
  - la console (Vite, `--base /console/`) et le front (Vite, avec `VITE_API_URL=/api`, `VITE_CONSOLE_URL=/console` et `VITE_COPILOT_URL=/copilot-site`) ;
  - puis l'assemblage de `/opt/archive/web`.
- **`deploy.sh`**, dans l'ordre :
  - lance `build.sh`, installe `docker-compose.yml`, `nginx.conf` et le `Caddyfile`, relance les services et recrée nginx ;
  - recrée Caddy **seulement si le Caddyfile a changé** : Caddy ne relit son fichier qu'à sa recréation ;
  - contrôle le site. Les enclaves sont contrôlées à part : leur absence n'est pas une panne du site.
- **N'envoyez pas tout `web/public/` depuis un poste :** `archive-node.mjs` y est reconstruit par le serveur.

## Les enclaves (Intel TDX, chez Phala)

- Les enclaves ne tournent pas sur ce serveur, qui n'a pas de TDX. Leurs 9 VM ont été **supprimées le 14/11** pour ne plus payer. Pour les recréer, voir la note V du dépôt UBC (fichiers de déploiement sauvegardés, nœud prod9, gaz).
- **Ensuite,** mettre à jour les adresses des enclaves dans `deploy/nginx.conf` (blocs `/enclave/…`) et dans `deploy/docker-compose.vps.yml` (`ENCLAVE_URL` des registrars), puis lancer `deploy.sh`.
- **Sans enclave, ce qui ne marche pas :**
  - l'IA privée, les appels x402 et le copilote attesté ;
  - la création d'une prime, car aucun opérateur n'est actif.
- **Sans enclave, ce qui marche :** les pages, les deux copilotes du serveur, le MCP, la caution d'opérateur et la lecture de l'état on-chain.

## Ce qui n'est jamais copié

`.secrets/`, `.git/`, tout `.env` (sauf `web/.env.local`, l'identifiant WalletConnect, public), `node_modules/`, `dist/` et les sorties de compilation. Voir `rsync-filter.txt`.

## Le front de Florent : sa branche GitHub `front` (depuis le 17/11/2026)

- `src/frontend` suit la branche `front` de `JeanBaptisteDurand/UBC_2026` (dossier `frontend/`). L'adoption a été faite une fois par `front-adopt.sh` : un commit de fusion, et nos 27 commits d'avant restent dans l'historique (étiquette `jb-front-2026-11-16`, paquet `/root/backups/front-jb-1cd3c51-20261117.bundle`).
- **Changer le front :** pousser sur la branche `front`, puis lancer `/opt/archive/src/deploy/front-update.sh` sur le serveur. Il fusionne seulement `frontend/`, puis lance `build.sh web` (services non touchés). Il refuse s'il y a des changements locaux, et ne construit rien en cas de conflit.
- **Construction :** `npm ci` (le `package-lock.json` du front n'est jamais réécrit), `node scripts/sizes.mjs`, puis `vite build --mode jb` (profil `frontend/.env.jb` : tout sur cette origine).
- **Garde-fou :** `build.sh` refuse de remplacer un `web/` modifié à la main (empreinte du dernier site construit dans `/opt/archive/.web-front-build`). `FORCE_WEB=1` passe outre, exprès, après une sauvegarde.
- **Depuis ce Mac :** `push.sh` n'envoie plus `frontend/` (règle `- /frontend/` dans `rsync-filter.txt`). La copie locale `frontend/` est l'ancienne (1cd3c51) : ne pas la modifier.
- **Ne jamais** déposer un `dist/` dans `/opt/archive/web`, ni modifier `src/frontend` sur le serveur.
