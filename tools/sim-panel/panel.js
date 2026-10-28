// The panel is a dumb output device: it blits frames the server rasterized and
// plays the clips the server tells it to. It is never the authority on what is
// playing -- that lives in Node, so the mixer readout stays right even if this
// tab was opened halfway through a story.
const lcd = document.getElementById("lcd");
const ctx = lcd.getContext("2d");
const image = ctx.createImageData(lcd.width, lcd.height);

const el = (id) => document.getElementById(id);
const serial = el("serial");

// --- audio -----------------------------------------------------------------
// Channel 1 is pre-mixed at 40% so sfx sit under the narration, matching the
// firmware. audio.set_volume drives the shared master and preserves that ratio.
const SFX_GAIN = 0.4;
let audioCtx = null;
let master = null;
const channelGain = {};
const sources = {};
const buffers = new Map();
let toneOsc = null;
// Per-channel token: bumped by stopChannel (which also fires on every new
// playClip, before its awaits) so an in-flight play can tell, after it
// resumes, whether it is still the most recent request for that channel.
const channelTokens = {};

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  master = audioCtx.createGain();
  master.gain.value = 1;
  master.connect(audioCtx.destination);
  for (const ch of [0, 1]) {
    const g = audioCtx.createGain();
    g.gain.value = ch === 1 ? SFX_GAIN : 1;
    g.connect(master);
    channelGain[ch] = g;
  }
}

async function clipFor(path) {
  if (buffers.has(path)) return buffers.get(path);
  const res = await fetch(`/audio/${path}`);
  if (!res.ok) return null;
  try {
    const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
    buffers.set(path, buf);
    return buf;
  } catch {
    // A clip that fails to decode must not block what follows: log it and
    // leave that channel silent.
    log("error", `could not decode ${path}`);
    return null;
  }
}

function nextToken(ch) {
  return (channelTokens[ch] = (channelTokens[ch] || 0) + 1);
}

function stopChannel(ch) {
  // Bump the token first, so a play waiting on an await for this channel
  // sees that it was superseded.
  nextToken(ch);
  const s = sources[ch];
  if (!s) return;
  try {
    s.stop();
  } catch {
    /* already ended */
  }
  delete sources[ch];
}

async function playClip({ path, channel, offsetMs }) {
  const token = nextToken(channel);
  ensureAudio();
  if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
  if (channelTokens[channel] !== token) return; // superseded while resuming audio
  const buffer = await clipFor(path);
  if (channelTokens[channel] !== token) return; // superseded while loading the clip
  if (!buffer) return;
  // Stop whatever is currently sounding on this channel directly, rather
  // than via stopChannel -- that would bump the token again and make this
  // still-current play look stale to itself.
  const prev = sources[channel];
  if (prev) {
    try {
      prev.stop();
    } catch {
      /* already ended */
    }
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  // channelGain covers only the two modelled channels; any other index plays
  // through master rather than vanish.
  src.connect(channelGain[channel] ?? master);
  src.start(0, Math.max(0, (offsetMs || 0) / 1000));
  sources[channel] = src;
}

async function beep(freq, ms) {
  ensureAudio();
  if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = "square";
  g.gain.value = 0.15;
  osc.connect(g).connect(master);
  osc.start();
  osc.stop(audioCtx.currentTime + ms / 1000);
}

// tone/tone_stop are the buzzer-gesture pair (sustained note until told to
// stop), distinct from beep's fire-and-forget pulse -- sim.ts emits both, and
// an app built on sfx.lua rather than audio.lua can reach for either.
async function startTone(freq) {
  ensureAudio();
  if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
  stopTone();
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = "square";
  g.gain.value = 0.15;
  osc.connect(g).connect(master);
  osc.start();
  toneOsc = osc;
}

function stopTone() {
  if (!toneOsc) return;
  try {
    toneOsc.stop();
  } catch {
    /* already ended */
  }
  toneOsc = null;
}

// --- rendering -------------------------------------------------------------
async function drawFrame(seq) {
  const res = await fetch(`/frame/${seq}`);
  if (!res.ok) return; // superseded already; the next frame is moments away
  const rgb = new Uint8Array(await res.arrayBuffer());
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) {
    image.data[p] = rgb[i];
    image.data[p + 1] = rgb[i + 1];
    image.data[p + 2] = rgb[i + 2];
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

// --- telemetry -------------------------------------------------------------
let lastFrames = 0;
let lastAt = performance.now();

function onTelemetry(t) {
  el("frames").textContent = t.frames;
  el("dt").textContent = t.dtMs;
  el("volume").textContent = t.volume;

  const now = performance.now();
  if (now - lastAt >= 500) {
    el("fps").textContent = (((t.frames - lastFrames) * 1000) / (now - lastAt)).toFixed(1);
    lastFrames = t.frames;
    lastAt = now;
  }

  for (const ch of [0, 1]) {
    const state = (t.channels || []).find((c) => c.channel === ch);
    const bar = el(`ch${ch}-bar`);
    const name = el(`ch${ch}-name`);
    if (state) {
      const pct = state.durationMs > 0 ? (state.elapsedMs / state.durationMs) * 100 : 0;
      bar.style.width = `${Math.min(100, pct)}%`;
      name.textContent = `ch${ch} ${state.path.split("/").pop()}`;
    } else {
      bar.style.width = "0%";
      name.textContent = ch === 0 ? "ch0 narration" : "ch1 sfx @40%";
    }
  }

  if (t.unpreloaded > 0) {
    el("stall").classList.remove("hidden");
    el("stall-n").textContent = t.unpreloaded;
  }
}

function log(level, message) {
  const li = document.createElement("li");
  li.className = level;
  li.textContent = message;
  serial.append(li);
  while (serial.children.length > 200) serial.firstChild.remove();
  serial.scrollTop = serial.scrollHeight;
}

// --- input -----------------------------------------------------------------
function post(body) {
  return fetch("/input", { method: "POST", body: JSON.stringify(body) });
}

function press(index) {
  ensureAudio();
  post({ button: index }).catch(() => {});
}

for (const b of document.querySelectorAll(".pbtn")) {
  b.addEventListener("click", () => press(Number(b.dataset.index)));
}
el("restart").addEventListener("click", () => press(0));

// The freeze control stops the whole simulator (clock, tick loop, audio) for
// debugging. It is not a device input: it posts {freeze}, which sim.ts reads
// directly, while the chassis buttons reach the Lua app through press(). The
// server owns the frozen state; this copy mirrors the last "hello".
let frozen = false;
el("freeze").addEventListener("click", () => {
  frozen = !frozen;
  el("freeze").classList.toggle("on", frozen);
  post({ freeze: frozen }).catch(() => {});
});

window.addEventListener("keydown", (e) => {
  if (e.key === "1") press(0);
  if (e.key === "2") press(1);
});

// Browsers gate AudioContext on a user gesture, and not every control goes
// through press(), so any click on the page resumes audio.
document.addEventListener("click", () => {
  ensureAudio();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
});

// --- wire ------------------------------------------------------------------
const events = new EventSource("/events");

function setIdent(d) {
  el("ident").textContent = `${d.deviceId} · ${d.bundle}`;
  document.title = `${d.bundle} — Improv sim`;
}

events.addEventListener("hello", (e) => {
  const d = JSON.parse(e.data);
  setIdent(d);
  // Adopt the server's frozen flag: `hello` fires on first load and on every
  // reconnect, so a tab opened while frozen shows it.
  frozen = Boolean(d.frozen);
  el("freeze").classList.toggle("on", frozen);
});
events.addEventListener("frame", (e) => drawFrame(JSON.parse(e.data).seq).catch(() => {}));
events.addEventListener("telemetry", (e) => onTelemetry(JSON.parse(e.data)));
events.addEventListener("log", (e) => {
  const d = JSON.parse(e.data);
  log(d.level, d.message);
});
events.addEventListener("sound", (e) => {
  const s = JSON.parse(e.data);
  if (s.kind === "play") playClip(s).catch(() => {});
  else if (s.kind === "stop") {
    if (s.channel < 0) {
      stopChannel(0);
      stopChannel(1);
    } else stopChannel(s.channel);
  } else if (s.kind === "volume") {
    ensureAudio();
    master.gain.value = s.volume / 255;
  } else if (s.kind === "beep") beep(s.freq, s.ms).catch(() => {});
  else if (s.kind === "tone") startTone(s.freq).catch(() => {});
  else if (s.kind === "tone_stop") stopTone();
});
