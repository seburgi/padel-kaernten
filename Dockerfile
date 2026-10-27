# syntax=docker/dockerfile:1
#
# Padel Kärnten's one image: the Go API, serving the React app's dist/
# (burgstaller-platform standards/architecture/one-image.md). Built from the
# repository root:
#
#   docker build --secret id=kit_token,env=GH_TOKEN --build-arg BUILD_REVISION=<sha> .
#
# What goes into the context is .dockerignore's allow-list.

# The platform's kit (kit/go and kit/web in seburgi/burgstaller-platform) is
# private. CI hands in a token that reads only that repository as the secret
# kit_token; it lives for one RUN only and never reaches a layer. pnpm's
# lockfile names the repository by its SSH address, so both are rewritten.

FROM node:22-alpine AS app
WORKDIR /src/services/app
RUN apk add --no-cache git && corepack enable
COPY services/app/package.json services/app/pnpm-lock.yaml ./
RUN --mount=type=secret,id=kit_token,required=true \
    token="$(cat /run/secrets/kit_token)" && \
    GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0="url.https://x-access-token:${token}@github.com/seburgi/burgstaller-platform.insteadOf" \
    GIT_CONFIG_VALUE_0="https://github.com/seburgi/burgstaller-platform" \
    GIT_CONFIG_KEY_1="url.https://x-access-token:${token}@github.com/seburgi/burgstaller-platform.insteadOf" \
    GIT_CONFIG_VALUE_1="git@github.com:seburgi/burgstaller-platform" \
    pnpm install --frozen-lockfile
COPY api/openapi.yaml /src/api/openapi.yaml
COPY services/app/ ./
ARG BUILD_REVISION=dev
RUN VITE_COMMIT="${BUILD_REVISION}" pnpm build

FROM golang:1.27-alpine AS build
WORKDIR /src
RUN apk add --no-cache ca-certificates git
COPY services/api/go.mod services/api/go.sum ./
ENV GOPRIVATE=github.com/seburgi/*
RUN --mount=type=secret,id=kit_token,required=true \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="url.https://x-access-token:$(cat /run/secrets/kit_token)@github.com/seburgi/burgstaller-platform.insteadOf" \
    GIT_CONFIG_VALUE_0="https://github.com/seburgi/burgstaller-platform" \
    go mod download
COPY services/api/ ./
ARG BUILD_REVISION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath \
      -ldflags="-s -w -X main.buildRevision=${BUILD_REVISION:-dev}" \
      -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
COPY --from=app /src/services/app/dist /app
USER nonroot:nonroot
ENV PORT=8080 APP_DIST=/app
EXPOSE 8080
ENTRYPOINT ["/api"]
