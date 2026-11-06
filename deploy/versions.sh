# Engine versions and model files, shared by engines.sh and the Docker image
# so every install builds and downloads the same thing.
# shellcheck shell=bash disable=SC2034

WHISPER_REF=v1.9.5
LLAMA_REF=b12169
SD_REF=f5df5f8b84f139f1e80496902da90798a0d92896

HF=https://huggingface.co
WHISPER_MODEL=ggml-small-q5_1.bin
WHISPER_DOWNLOAD=$HF/ggerganov/whisper.cpp/resolve/main/$WHISPER_MODEL
VISION_MODEL_FILE=Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf
VISION_PROJ=mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf
VISION_REPO=$HF/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main
SD_MODEL_FILE=sdxl_lightning_4step.safetensors
SD_DOWNLOAD=$HF/ByteDance/SDXL-Lightning/resolve/main/$SD_MODEL_FILE
VOICE=en_GB-alba-medium
