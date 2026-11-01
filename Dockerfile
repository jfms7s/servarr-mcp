# Both build stages run on the build machine's own platform ($BUILDPLATFORM), so the
# multi-arch build compiles TypeScript and installs node_modules once, natively, instead
# of under QEMU for arm64. That is safe only because nothing in the production
# dependency tree is native: if a native dependency is ever added, the deps stage must
# move back to the target platform. The digest pins the multi-arch index (both arches);
# Dependabot keeps it current.
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The runtime stage runs nothing, so it needs no emulation either: it only copies.
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Numeric, not `USER node`. A Kubernetes runAsNonRoot check cannot resolve a
# user *name* to a uid, so it refuses to start a container whose image
# declares one: "has runAsNonRoot and image has non-numeric user (node),
# cannot verify user is non-root". 1000:1000 is what node:22-alpine's own
# `node` user already resolves to, so this changes nothing but the encoding.
USER 1000:1000
EXPOSE 3000
ENV SERVARR_MCP_TRANSPORT=http
# The server binds to 127.0.0.1 by default; in a container it must listen on every
# interface so the port mapping or a Kubernetes Service can reach it. `*` is every
# interface, IPv4 and IPv6 (dual-stack where the pod has IPv6), not 0.0.0.0 (IPv4 only).
ENV SERVARR_MCP_HOST=*
CMD ["node", "dist/index.js"]
