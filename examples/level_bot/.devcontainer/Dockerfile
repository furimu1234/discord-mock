FROM mcr.microsoft.com/devcontainers/typescript-node:24
RUN apt-get update && apt-get install -y --no-install-recommends locales curl \
    && locale-gen ja_JP.UTF-8 \
    && rm -rf /var/lib/apt/lists/*
ENV LANG=ja_JP.UTF-8
ENV LANGUAGE=ja_JP:ja
ENV LC_ALL=ja_JP.UTF-8
# Pin pnpm 11, and keep installation inside the disposable dev container.
RUN npm install -g corepack@latest && corepack enable && corepack prepare pnpm@11.0.0 --activate
WORKDIR /workspaces/discord-mock
