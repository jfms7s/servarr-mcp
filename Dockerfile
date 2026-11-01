FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
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
