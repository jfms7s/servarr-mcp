FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Numeric, not `USER node`. A Kubernetes runAsNonRoot check cannot resolve a
# user *name* to a uid, so it refuses to start a container whose image
# declares one: "has runAsNonRoot and image has non-numeric user (node),
# cannot verify user is non-root". 1000:1000 is what node:20-alpine's own
# `node` user already resolves to, so this changes nothing but the encoding.
USER 1000:1000
EXPOSE 3000
ENV SERVARR_MCP_TRANSPORT=http
CMD ["node", "dist/index.js"]
