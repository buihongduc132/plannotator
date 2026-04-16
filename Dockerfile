# ============================================================
# Plannotator — multi-session server (local + remote access)
#
# Multi-stage build:
#   Stage 1 — install deps + build dist (review + hook HTML bundles)
#   Stage 2 — slim runtime (no source, just the built app)
#
# Usage:
#   docker compose --profile smoke-test up --abort-on-container-exit
#   docker compose --profile server up --detach
#   docker compose --profile server logs -f
#   docker compose --profile server down
# ============================================================

# --- Build stage ---
FROM oven/bun:1 AS builder

WORKDIR /app

# Workspace files
COPY package.json bun.lock .npmrc* ./
COPY apps ./apps
COPY packages ./packages

# Install deps (some optional packages may fail — that's OK, main deps install fine)
RUN bun install || true

# Build review HTML (needed by hook build)
RUN cd apps/review && bun run build && cd ..

# Build hook HTML (embeds review.html + copies index.html)
RUN bun run build:hook

# Copy test
COPY test-multi-session.ts ./

# --- Runtime stage ---
FROM oven/bun:1-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*

# Copy built app from builder
COPY --from=builder /app /app

ENV HOME=/app/home
RUN mkdir -p $HOME

WORKDIR /app

# Default CMD: smoke test (overridden per-profile in docker-compose.yml)
CMD ["bun", "run", "test-multi-session.ts"]
