FROM node:24-slim AS builder
WORKDIR /app

RUN npm install -g pnpm@12.14.0
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json LICENSE ./
COPY src ./src
COPY scripts ./scripts
COPY public/icon-512.png ./public/icon-512.png
RUN pnpm build && pnpm run build:mcpb && pnpm prune --prod

FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY skills ./skills
COPY --from=builder /app/public/downloads/shopcart-mcp.mcpb ./public/downloads/shopcart-mcp.mcpb

USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
