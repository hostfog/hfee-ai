# HFee AI in one image: the HFee model runner, the website and (in the
# default "full" target) the voice, vision and image engines.
#
#   docker compose up -d            # see compose.yaml
#   docker build --target lite .    # chat only, much smaller

ARG NODE_VERSION=22
ARG HFEE_REF=main

# --- HFee model runner (pure Go) -------------------------------------------
# Source comes from GitHub; to use a local checkout instead:
#   docker build --build-context hfee=../hfee .
FROM alpine/git AS hfee-git
ARG HFEE_REF
RUN git clone --depth 1 --branch "$HFEE_REF" https://github.com/hostfog/hfee /hfee

FROM scratch AS hfee
COPY --from=hfee-git /hfee /

FROM golang:1.24-bookworm AS runner
COPY --from=hfee / /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/hfee ./cmd/hfee

# --- Website ----------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY index.html vite.config.js ./
COPY public public
COPY src src
RUN npm run build && npm ci --omit=dev --no-audit --no-fund --loglevel=error

# --- Engines (whisper.cpp, llama.cpp, stable-diffusion.cpp) -----------------
# Built for a common CPU baseline, not the build machine, so the image runs
# anywhere. On amd64 that baseline is AVX2 (any CPU from the last ~10 years).
FROM debian:bookworm AS engines
ARG TARGETARCH
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends build-essential cmake git ca-certificates >/dev/null
COPY deploy/versions.sh /tmp/versions.sh
RUN set -eu; . /tmp/versions.sh; \
    cpu="-DGGML_NATIVE=OFF"; \
    if [ "$TARGETARCH" = amd64 ]; then cpu="$cpu -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON"; fi; \
    build() { \
      git init -q "/src/$1" && cd "/src/$1"; \
      git fetch -q --depth 1 "https://github.com/$2" "$3" && git checkout -q FETCH_HEAD; \
      git submodule update -q --init --recursive --depth 1; \
      cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF $cpu \
        -DLLAMA_CURL=OFF -DWHISPER_BUILD_TESTS=OFF -DLLAMA_BUILD_TESTS=OFF >build.log 2>&1 \
      && cmake --build build -j "$(nproc)" --target "$4" >>build.log 2>&1 \
      || { tail -n 40 build.log; exit 1; }; \
      install -D -m 755 "build/bin/$4" "/out/$4"; \
    }; \
    build whisper ggml-org/whisper.cpp "$WHISPER_REF" whisper-server; \
    build llama ggml-org/llama.cpp "$LLAMA_REF" llama-server; \
    build sd leejet/stable-diffusion.cpp "$SD_REF" sd-cli

# --- Chat only --------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS lite
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl >/dev/null \
 && rm -rf /var/lib/apt/lists/*
COPY --from=runner /out/hfee /usr/local/bin/hfee
WORKDIR /app
COPY --from=web /app/node_modules node_modules
COPY --from=web /app/dist dist
COPY package.json ./
COPY server server
COPY docker/start.sh /usr/local/bin/hfee-start
ENV HFEE_MODELS=/data/models \
    DB_PATH=/data/site/hfee.db \
    HOST=0.0.0.0 \
    PORT=3001 \
    AI_BASE_URL=http://127.0.0.1:11500/v1 \
    AI_MODEL=qwen2.5:3b
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --start-period=30m CMD curl -fs http://127.0.0.1:3001/api/health || exit 1
CMD ["hfee-start"]

# --- Everything (default) ---------------------------------------------------
FROM lite AS full
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg python3-venv libgomp1 >/dev/null \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/piper && /opt/piper/bin/pip install -q --no-cache-dir piper-tts
COPY --from=engines /out/ /usr/local/bin/
COPY deploy/versions.sh /usr/local/share/hfee/versions.sh
ENV ENGINES=true
