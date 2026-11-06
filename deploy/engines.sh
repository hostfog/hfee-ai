#!/usr/bin/env bash
# Builds and starts the optional engines behind HFee AI, all bound to
# 127.0.0.1: speech (whisper.cpp, Piper), vision (llama.cpp), images
# (stable-diffusion.cpp), web search (SearXNG) and the Python sandbox.
# Run by install.sh; safe to run again (finished steps are skipped).
set -euo pipefail

ENG=/opt/hfee-engines
DATA=/var/lib/hfee/engines
ENV_FILE=/opt/hfee-ai/.env

# shellcheck source-path=SCRIPTDIR source=os.sh
. "$(dirname "$0")/os.sh"
# shellcheck source-path=SCRIPTDIR source=versions.sh
. "$(dirname "$0")/versions.sh"

step "Installing build tools"
enable_extra_repos
pkg_install build-essential cmake git ffmpeg bubblewrap python3-venv openssl util-linux
install_containers
mkdir -p "$ENG/bin" "$ENG/src" "$DATA"
THREADS="$(nproc)"

# build <name> <repo> <ref> <target...>: static release build, native CPU features.
build() {
  local name=$1 repo=$2 ref=$3
  shift 3
  local src="$ENG/src/$name"
  if [[ -f "$src/.built" && "$(cat "$src/.built")" == "$ref" ]]; then
    return
  fi
  step "Building $name ($ref), takes a few minutes"
  rm -rf "$src"
  git init -q "$src"
  git -C "$src" fetch -q --depth 1 "https://github.com/$repo" "$ref"
  git -C "$src" checkout -q FETCH_HEAD
  git -C "$src" submodule update -q --init --recursive --depth 1
  # Compiler output goes to build.log and is only shown if the build fails.
  if ! {
    cmake -S "$src" -B "$src/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=ON \
      -DLLAMA_CURL=OFF -DWHISPER_BUILD_TESTS=OFF -DLLAMA_BUILD_TESTS=OFF &&
      cmake --build "$src/build" -j "$THREADS" --target "$@"
  } >"$ENG/src/$name.log" 2>&1; then
    tail -n 40 "$ENG/src/$name.log" >&2
    echo "Building $name failed; full log: $ENG/src/$name.log" >&2
    exit 1
  fi
  for target in "$@"; do
    install -m 755 "$src/build/bin/$target" "$ENG/bin/$target"
  done
  echo "$ref" >"$src/.built"
}

# fetch <url> <file>: download once.
fetch() {
  if [[ ! -s "$2" ]]; then
    step "Downloading $(basename "$2")"
    curl -fL --retry 3 -C - -o "$2.part" "$1"
    mv "$2.part" "$2"
  fi
}

build whisper.cpp ggml-org/whisper.cpp "$WHISPER_REF" whisper-server
build llama.cpp ggml-org/llama.cpp "$LLAMA_REF" llama-server
build stable-diffusion.cpp leejet/stable-diffusion.cpp "$SD_REF" sd-cli

fetch "$WHISPER_DOWNLOAD" "$DATA/$WHISPER_MODEL"
fetch "$VISION_REPO/$VISION_MODEL_FILE" "$DATA/$VISION_MODEL_FILE"
fetch "$VISION_REPO/$VISION_PROJ" "$DATA/$VISION_PROJ"
fetch "$SD_DOWNLOAD" "$DATA/$SD_MODEL_FILE"

step "Setting up Python (Piper voice and the code sandbox)"
[[ -x "$ENG/py/bin/python" ]] || python3 -m venv "$ENG/py"
"$ENG/py/bin/pip" install -q --upgrade pip
"$ENG/py/bin/pip" install -q piper-tts numpy pandas matplotlib
[[ -s "$DATA/$VOICE.onnx" ]] || "$ENG/py/bin/python" -m piper.download_voices "$VOICE" --data-dir "$DATA" >/dev/null

step "Setting up web search (SearXNG)"
mkdir -p "$DATA/searxng"
if [[ ! -f "$DATA/searxng/settings.yml" ]]; then
  cat >"$DATA/searxng/settings.yml" <<EOF
use_default_settings: true
server:
  secret_key: "$(openssl rand -hex 32)"
  limiter: false
  image_proxy: false
search:
  formats: [html, json]
EOF
fi
docker pull -q docker.io/searxng/searxng:latest >/dev/null

chown -R hfee:hfee "$DATA"

step "Starting engine services"
unit() {
  local name=$1 desc=$2 exec=$3
  cat >"/etc/systemd/system/$name.service" <<EOF
[Unit]
Description=$desc
After=network-online.target

[Service]
User=hfee
Group=hfee
ExecStart=$exec
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
}

unit hfee-whisper "HFee speech recognition" \
  "$ENG/bin/whisper-server -m $DATA/$WHISPER_MODEL --host 127.0.0.1 --port 8091 -t 4"
unit hfee-vision "HFee image understanding" \
  "$ENG/bin/llama-server -m $DATA/$VISION_MODEL_FILE --mmproj $DATA/$VISION_PROJ --host 127.0.0.1 --port 8092 -c 8192 -t $THREADS --alias qwen2.5-vl"

cat >/etc/systemd/system/hfee-search.service <<EOF
[Unit]
Description=HFee web search (SearXNG)
$(container_unit_deps)

[Service]
ExecStartPre=-/usr/bin/docker rm -f hfee-searxng
ExecStart=/usr/bin/docker run --rm --name hfee-searxng -e GRANIAN_HOST=0.0.0.0 -p 127.0.0.1:8093:8080 -v $DATA/searxng:/etc/searxng:Z docker.io/searxng/searxng:latest
ExecStop=/usr/bin/docker stop hfee-searxng
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
for s in hfee-whisper hfee-vision hfee-search; do
  systemctl enable --now "$s" >/dev/null
  systemctl restart "$s"
done

step "Turning the features on in HFee AI"
# Replace the engines block in .env, keeping everything else.
sed -i '/^# --- engines/,/^# --- end engines/d' "$ENV_FILE"
cat >>"$ENV_FILE" <<EOF
# --- engines (written by engines.sh)
VISION_BASE_URL=http://127.0.0.1:8092/v1
VISION_MODEL=qwen2.5-vl
WHISPER_URL=http://127.0.0.1:8091
PIPER_BIN=$ENG/py/bin/piper
PIPER_VOICE=$DATA/$VOICE.onnx
SD_BIN=$ENG/bin/sd-cli
SD_MODEL=$DATA/$SD_MODEL_FILE
SD_SIZE=768
SD_STEPS=4
SD_CFG=1
SD_SAMPLER=euler
SD_SCHEDULER=sgm_uniform
SEARXNG_URL=http://127.0.0.1:8093
SANDBOX_PYTHON=$ENG/py/bin/python
# --- end engines
EOF
