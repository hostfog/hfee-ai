#!/usr/bin/env bash
# Container entrypoint: starts HFee, downloads models on first run, starts the
# engines this image has, then the website. If any of them stops, the
# container stops too and Docker restarts it.
set -euo pipefail

DATA=/data
ENG="$DATA/engines"
export HFEE_HOST=127.0.0.1:11500
: "${AI_MODEL:?AI_MODEL must be set}"
mkdir -p "$DATA/models" "$DATA/site"

pids=()
trap 'kill "${pids[@]}" 2>/dev/null; wait' TERM INT

fetch() {
  [[ -s "$2" ]] && return
  echo "Downloading $(basename "$2") (first start only)"
  curl -fL --retry 3 -C - --progress-bar -o "$2.part" "$1"
  mv "$2.part" "$2"
}

hfee serve &
pids+=($!)
until curl -fs "http://$HFEE_HOST/api/version" >/dev/null; do sleep 0.5; done

if ! hfee show "$AI_MODEL" >/dev/null 2>&1; then
  echo "Downloading $AI_MODEL (first start only)"
  hfee pull "$AI_MODEL"
fi

if [[ "${ENGINES:-false}" == true ]]; then
  # shellcheck source-path=SCRIPTDIR source=../deploy/versions.sh
  . /usr/local/share/hfee/versions.sh
  mkdir -p "$ENG"
  fetch "$WHISPER_DOWNLOAD" "$ENG/$WHISPER_MODEL"
  fetch "$VISION_REPO/$VISION_MODEL_FILE" "$ENG/$VISION_MODEL_FILE"
  fetch "$VISION_REPO/$VISION_PROJ" "$ENG/$VISION_PROJ"
  fetch "$SD_DOWNLOAD" "$ENG/$SD_MODEL_FILE"
  [[ -s "$ENG/$VOICE.onnx" ]] || /opt/piper/bin/python -m piper.download_voices "$VOICE" --data-dir "$ENG" >/dev/null

  threads="$(nproc)"
  whisper-server -m "$ENG/$WHISPER_MODEL" --host 127.0.0.1 --port 8091 -t 4 >/dev/null 2>&1 &
  pids+=($!)
  llama-server -m "$ENG/$VISION_MODEL_FILE" --mmproj "$ENG/$VISION_PROJ" --host 127.0.0.1 --port 8092 \
    -c 8192 -t "$threads" --alias qwen2.5-vl --log-disable &
  pids+=($!)

  export WHISPER_URL=http://127.0.0.1:8091
  export VISION_BASE_URL=http://127.0.0.1:8092/v1 VISION_MODEL=qwen2.5-vl
  export PIPER_BIN=/opt/piper/bin/piper PIPER_VOICE="$ENG/$VOICE.onnx"
  export SD_BIN=/usr/local/bin/sd-cli SD_MODEL="$ENG/$SD_MODEL_FILE"
  export SD_SIZE="${SD_SIZE:-768}" SD_STEPS=4 SD_CFG=1 SD_SAMPLER=euler SD_SCHEDULER=sgm_uniform
fi

node --disable-warning=ExperimentalWarning server/index.js &
pids+=($!)

wait -n
echo "A service stopped; restarting the container." >&2
kill "${pids[@]}" 2>/dev/null || true
exit 1
