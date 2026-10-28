# Renders spoken lines with Kokoro-82M (the kokoro-onnx package). Called by
# tools/gen-line-audio.ts, never by hand: it reads a JSON list of jobs on stdin,
# {text, voice, speed, lang, pause, accent, out}, and writes each as a 24 kHz
# mono 16-bit WAV. One process renders every line, so the model loads once.
#
# The model files live in $KOKORO_HOME (default ~/.local/share/kokoro); run
# `npm run setup:kokoro` to fetch them.
import json
import os
import re
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

home = os.environ.get("KOKORO_HOME") or os.path.expanduser("~/.local/share/kokoro")
kokoro = Kokoro(os.path.join(home, "kokoro-v1.0.onnx"), os.path.join(home, "voices-v1.0.bin"))

# A light Southern drawl: "I" loses its glide ("ah") except before a voiceless
# consonant, and -ing drops its g. Applied to US phonemes.
VOICELESS = "ptkfsθʃ"


def southern(phonemes):
    p = re.sub(r"aɪ(?![ˈˌ]?[" + VOICELESS + "])", "aː", phonemes)
    return re.sub(r"ɪŋ\b", "ɪn", p)


for job in json.load(sys.stdin):
    text, as_phonemes = job["text"], False
    if job["accent"] == "southern":
        text, as_phonemes = southern(kokoro.tokenizer.phonemize(text, "en-us")), True
    samples, rate = kokoro.create(
        text,
        voice=job["voice"],
        speed=job["speed"],
        lang=job["lang"],
        is_phonemes=as_phonemes,
        sentence_pause=job["pause"],
    )
    sf.write(job["out"], samples, rate, subtype="PCM_16")
