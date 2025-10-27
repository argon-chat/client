FROM oven/bun:1 AS builder
WORKDIR /app

COPY bun.lockb* package.json ./
RUN bun install --frozen-lockfile --no-progress --silent --concurrent=false

COPY . .
RUN bun run build

FROM busybox:1.36 AS runner
WORKDIR /www

COPY --from=builder /app/dist /www

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 443
ENTRYPOINT ["/entrypoint.sh"]
