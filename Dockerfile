# Standalone deployment alternative; VibeX source uploads remain a separate workflow.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    UPLOAD_DIR=/var/lib/suiyuan/uploads
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/scripts/start-prod.mjs ./scripts/start-prod.mjs
COPY --from=build --chown=node:node /app/scripts/neon-migrate.mjs ./scripts/neon-migrate.mjs
COPY --from=build --chown=node:node /app/scripts/neon-schema.sql ./scripts/neon-schema.sql
COPY --from=build --chown=node:node /app/scripts/neon-migrations.sql ./scripts/neon-migrations.sql
RUN mkdir -p /var/lib/suiyuan/uploads && chown -R node:node /var/lib/suiyuan
USER node
VOLUME ["/var/lib/suiyuan/uploads"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=8s --start-period=55s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/ready',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-prod.mjs"]
