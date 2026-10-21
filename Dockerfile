# The bot, ready to run with compose.yaml (see the README). It runs the bot, or `manifest` or `clean-db` instead.

FROM node:26-alpine AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global "$(node -p 'require("./package.json").packageManager')" \
  && pnpm install --prod --frozen-lockfile

FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json LICENSE ./
COPY locales ./locales
COPY src ./src
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/agora
# The database, in a volume so it outlives the container.
RUN mkdir data && chown node:node data
VOLUME /app/data
USER node
# Node reads .env itself, as `pnpm start` does: Docker's --env-file would keep the quotes around values.
ENTRYPOINT ["agora"]
CMD ["start"]
