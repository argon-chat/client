FROM oven/bun:1 AS builder
WORKDIR /app

COPY bun.lockb* package.json ./
RUN bun install --frozen-lockfile --no-progress --silent --frozen-lockfile --concurrent=false

COPY . .
RUN bun run build

FROM busybox:1.36
WORKDIR /www

COPY --from=builder /app/dist .

EXPOSE 3000
CMD ["busybox", "httpd", "-f", "-v", "-p", "3000"]
