
FROM node:18-slim AS builder

WORKDIR /app

# pnpm インストール
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY packages/bot/package.json ./packages/bot/

RUN pnpm install --frozen-lockfile

# ソースコードをすべてコピー
COPY . .

# ほんとはビルドしたほうがいい気がする
CMD ["pnpm", "dev"]