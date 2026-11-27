# renovate: datasource=npm depName=corepack
ARG COREPACK_VERSION=0.36.0

FROM node:26-alpine AS builder

WORKDIR /app

ARG COREPACK_VERSION
RUN npm install -g corepack@${COREPACK_VERSION} && corepack enable

# Manifests first: the install layer is reused until a dependency changes.
COPY package.json yarn.lock .yarnrc.yml ./
COPY back/package.json ./back/
COPY eslint-rules/package.json ./eslint-rules/
COPY front/package.json ./front/
COPY integration-tests/package.json ./integration-tests/
COPY module/package.json ./module/
COPY utils/package.json ./utils/

RUN yarn install

COPY tsconfig.base.json ./
COPY back ./back
COPY front ./front
COPY module ./module
COPY utils ./utils

RUN yarn workspace @app/front build

RUN yarn workspace @app/back build

# Stage 2: Prepare production dependencies
FROM node:26-alpine AS deps

WORKDIR /app

ARG COREPACK_VERSION
RUN npm install -g corepack@${COREPACK_VERSION} && corepack enable

# minimal package.json from the build
COPY --from=builder /app/back/dist/package.json ./package.json
COPY .yarnrc.yml yarn.lock ./

RUN yarn install

# Stage 3: Third-party notices, written by the Flow checker (GDL-XTM-0002-R007, R009)
FROM ghcr.io/astral-sh/uv:python3.13-bookworm AS notices

# Only what the checker reads, so a change to the application code never reruns it.
COPY package.json yarn.lock .yarnrc.yml /src/
COPY back/package.json /src/back/
COPY eslint-rules/package.json /src/eslint-rules/
COPY front/package.json /src/front/
COPY integration-tests/package.json /src/integration-tests/
COPY module/package.json /src/module/
COPY utils/package.json /src/utils/
COPY .flow /src/.flow

# A cache mount is not part of the layer's cache key, so what the registries answered can grow
# between builds without rerunning this stage. CI fills it before the build; a local builder keeps
# its own from one build to the next.
RUN --mount=type=cache,id=flow-cache,target=/cache \
    cd /src && uv run .flow/checkers/GDL-XTM-0002/check.py . --licenses .flow/licenses.yaml --notices --cache /cache/licenses.json

# Stage 4: Final image
FROM node:26-alpine

# The published image is built without reading the layer cache, so this layer is always fresh.
RUN apk --no-cache upgrade

# The base image ships npm and npx, the runtime only calls node.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app

ENV NODE_ENV=production
ENV FRONT_PATH=/app/public

COPY --from=builder /app/back/dist /app/

COPY LICENSE NOTICE /app/
COPY --from=notices /src/THIRD_PARTY_NOTICES /app/THIRD_PARTY_NOTICES

COPY --from=builder /app/front/dist /app/public

COPY --from=deps /app/node_modules /app/node_modules

# Last: the version changes on every commit, and every layer after it would be rebuilt.
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION
ARG APP_COMMIT_TIME
ENV APP_COMMIT_TIME=$APP_COMMIT_TIME

EXPOSE 3002
EXPOSE 8444

CMD ["node", "index-pm.mjs"]
