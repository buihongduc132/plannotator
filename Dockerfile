# Runtime image: uses pre-built dist files (no rebuild needed)
# Built dist dirs were generated locally with: bun run build:hook && bun run build:review
FROM oven/bun:1-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*

# Copy lockfile + workspace config
COPY package.json bun.lock .npmrc* ./

# Install workspace dependencies
RUN bun install

# Copy source + built dist
COPY apps ./apps
COPY packages ./packages
COPY test-multi-session.ts ./

ENV HOME=/app/home
RUN mkdir -p $HOME

WORKDIR /app

CMD ["bun", "run", "test-multi-session.ts"]
