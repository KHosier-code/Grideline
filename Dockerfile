# Production image for hosting Gridline outside Replit (Railway, Render, Fly.io...).
# Runs the API, the approved data worker, and the website in one container;
# see deploy/start.mjs for how requests are routed.
FROM node:24-slim

RUN npm install -g pnpm@10.33.0

WORKDIR /app

# Build-time values. VITE_* are baked into the website bundle, so they must be
# present when the image is built (Railway passes service variables as build args).
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PROXY_URL
ARG PUBLIC_SITE_URL=https://gridelineanalytics.com
ARG RAILWAY_GIT_COMMIT_SHA

COPY . .
RUN pnpm install --frozen-lockfile
RUN NODE_ENV=production pnpm --filter @workspace/api-server run build \
  && NODE_ENV=production BASE_PATH=/ pnpm --filter @workspace/nfl-analytics run build

# Many development-only tools refuse to run when REPLIT_DEPLOYMENT is set (in
# addition to NODE_ENV !== "development"). Keep both set so every one of those
# guards stays closed in production after leaving Replit.
ENV NODE_ENV=production \
  REPLIT_DEPLOYMENT=1 \
  PUBLIC_SITE_URL=${PUBLIC_SITE_URL}

EXPOSE 3000
CMD ["node", "deploy/start.mjs"]
