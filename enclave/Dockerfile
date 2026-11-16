# Image de l'enclave ArcHive, produits sealed-chat et sealed-x402. Déployable sur Phala Cloud (dstack TDX).
# Une seule image, deux commandes : node dist/sealed-chat.mjs (sessions, port 8802) ou node dist/sealed-x402.mjs
# (paiement à l'appel x402, port 8804 par défaut). Chaque service a ses propres clés et son propre PRODUCT_ID.
# La Prime scellée a SA propre image (Dockerfile.bounty) : elle n'est ni construite ni copiée ici.
#
# Reproductible (9/11 au soir, remarque du vérificateur) :
#  - base épinglée par condensat (la même que Dockerfile.copilot et les services du VPS) ;
#  - aucun paquet système, plus d'apt-get : Node embarque ses autorités de certification (fetch HTTPS vers le RPC d'Arc
#    et vers RedPill vérifié dans cette base le 9/11, sans /etc/ssl/certs ni paquet ca-certificates) ;
#  - dépendances figées par le fichier de verrouillage (npm ci), sans les caches de npm (/root/.npm : index horodaté,
#    journaux ; /tmp/node-compile-cache : cache de code de V8), qui différaient d'une construction à l'autre ;
#  - seules les sources des deux produits sont copiées (leurs imports, relevés par esbuild) : un changement de la Prime
#    scellée (bounty.ts, predicate.ts, anvil-fork.ts, products/sealed-bounty) ne change plus cette image. Un nouvel
#    import hors de cette liste fait échouer la construction (esbuild), jamais en silence.
# Construction, depuis enclave/ :
#   docker build --platform linux/amd64 -t ghcr.io/<compte>/archive-sealed-chat:<version> .
# Même empreinte d'une construction à l'autre (vérifié le 9/11 en linux/arm64 : deux constructions sans cache, même
# manifeste, même config ; à refaire en linux/amd64 avant de publier), à condition de fixer aussi les dates des fichiers :
#   docker buildx build --platform linux/amd64 --no-cache --provenance=false --sbom=false --build-arg SOURCE_DATE_EPOCH=0 \
#     --output type=oci,dest=archive-sealed-chat.oci.tar,rewrite-timestamp=true .
FROM node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps && rm -rf /root/.npm /tmp/node-compile-cache
COPY tsconfig.json ./
COPY src/kit ./src/kit
COPY src/server ./src/server
COPY src/services/inference.ts src/services/x402.ts src/services/x402-ack.ts src/services/x402-gateway.ts src/services/model-attestation.ts ./src/services/
COPY products/sealed-chat ./products/sealed-chat
COPY products/sealed-x402 ./products/sealed-x402
RUN node_modules/.bin/esbuild products/sealed-chat/server.ts --bundle --platform=node --format=esm --outfile=dist/sealed-chat.mjs --packages=external \
 && node_modules/.bin/esbuild products/sealed-x402/server.ts --bundle --platform=node --format=esm --outfile=dist/sealed-x402.mjs --packages=external
ENV PORT=8802
EXPOSE 8802 8804
CMD ["node", "dist/sealed-chat.mjs"]
