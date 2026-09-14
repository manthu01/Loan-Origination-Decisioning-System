FROM node:22-slim AS build

WORKDIR /repo
COPY package.json ./
COPY packages/db/package.json packages/db/
COPY apps/orchestrator/package.json apps/orchestrator/
RUN npm install

COPY packages/db packages/db
COPY apps/orchestrator apps/orchestrator
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma
RUN npm run build --workspace=apps/orchestrator

FROM node:22-slim
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/orchestrator/dist ./dist
COPY --from=build /repo/apps/orchestrator/package.json ./
COPY --from=build /repo/packages/db/prisma ./prisma

EXPOSE 3001
# apply pending migrations, then start -- the append-only DecisionEvent rule and every
# other schema change ships as a migration, never as `prisma db push` against prod
CMD ["sh", "-c", "npx prisma migrate deploy --schema=./prisma/schema.prisma && node dist/main.js"]
