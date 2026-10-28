#!/bin/sh
# Installs Kokoro-82M for gen:audio: a Python 3.12 venv with kokoro-onnx, and
# the v1.0 model files, in $KOKORO_HOME (default ~/.local/share/kokoro).
# Python 3.12, because onnxruntime has no wheel for newer Pythons on every
# platform. Safe to run again: it skips what is already there.
set -eu

HOME_DIR="${KOKORO_HOME:-$HOME/.local/share/kokoro}"
RELEASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
mkdir -p "$HOME_DIR"

if [ ! -x "$HOME_DIR/venv/bin/python" ]; then
  python3 -m venv "$HOME_DIR/uv"
  "$HOME_DIR/uv/bin/pip" install -q uv
  "$HOME_DIR/uv/bin/uv" venv -q --python 3.12 "$HOME_DIR/venv"
  VIRTUAL_ENV="$HOME_DIR/venv" "$HOME_DIR/uv/bin/uv" pip install -q "kokoro-onnx==0.6.1" "soundfile==0.14.0"
fi

fetch() {
  if [ ! -f "$HOME_DIR/$1" ]; then
    curl -sSLf -o "$HOME_DIR/$1.part" "$RELEASE/$1"
    mv "$HOME_DIR/$1.part" "$HOME_DIR/$1"
  fi
}
fetch kokoro-v1.0.onnx
fetch voices-v1.0.bin

(cd "$HOME_DIR" && shasum -a 256 -c - <<'EOF'
7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5  kokoro-v1.0.onnx
bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  voices-v1.0.bin
EOF
)
echo "Kokoro is ready in $HOME_DIR"
