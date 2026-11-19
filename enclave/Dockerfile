# ArcHive enclave image for the sealed-chat and sealed-x402 products. Deployable on Phala Cloud (dstack TDX).
# One image, two entry points: node dist/sealed-chat.mjs (sessions, port 8802) or node dist/sealed-x402.mjs
# (x402 pay-per-call, port 8804 by default). Each service has its own keys and its own PRODUCT_ID.
# The Sealed Bounty has its own image (Dockerfile.bounty): it is neither built nor copied here.
#
# Reproducible build:
#  - the base image is pinned by digest (the same one as Dockerfile.copilot and the services behind the site);
#  - no system package and no apt-get: Node ships its own certificate authorities (HTTPS calls to Arc's RPC and to
#    RedPill were checked in this base image, without /etc/ssl/certs or the ca-certificates package);
#  - dependencies are pinned by the lockfile (npm ci), and npm's and V8's caches are removed (/root/.npm: a timestamped
#    index and logs; /tmp/node-compile-cache: V8's code cache), because they differed from one build to the next;
#  - only the two products' sources are copied (their imports, as listed by esbuild): a change to the Sealed Bounty
#    (bounty.ts, predicate.ts, anvil-fork.ts, products/sealed-bounty) does not change this image. A new import outside
#    this list makes the build fail (esbuild), never silently.
# Build, from enclave/:
#   docker build --platform linux/amd64 -t ghcr.io/<account>/archive-sealed-chat:<version> .
# Two no-cache builds give the same manifest and config (checked on linux/arm64). To check the deployed platform, run
# the same two builds with --platform linux/amd64. File timestamps must be fixed too:
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
