/**
 * Plays a streamed 16-bit mono PCM WAV (open-ended length, as /api/messages/:id/audio
 * returns for Kokoro and Gemini) through Web Audio, scheduling each chunk as it
 * arrives. An <audio> element buffers several seconds of such a stream before it
 * starts; this starts as soon as the first sentence is synthesised.
 */
export type PcmPlayback = { done: Promise<void>; stop: () => void };

let sharedCtx: AudioContext | null = null;

function audioContext() {
  sharedCtx ??= new AudioContext();
  return sharedCtx;
}

/** Call from a click handler so later playback isn't blocked by autoplay rules. */
export function unlockAudio() {
  void audioContext().resume().catch(() => {});
}

export function playPcmWav(body: ReadableStream<Uint8Array>): PcmPlayback {
  const ctx = audioContext();
  const reader = body.getReader();
  const sources = new Set<AudioBufferSourceNode>();
  let stopped = false;

  const stop = () => {
    stopped = true;
    reader.cancel().catch(() => {});
    for (const s of sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {}
    }
    sources.clear();
  };

  const done = (async () => {
    // Without a prior user gesture resume() can stay pending; fail fast so the caller falls back.
    await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1000))]);
    if (ctx.state !== "running") {
      reader.cancel().catch(() => {});
      throw new Error("audio_locked");
    }
    let header = new Uint8Array(0);
    let sampleRate = 0;
    let carry: Uint8Array | null = null;
    let nextAt = 0;
    let last: Promise<void> = Promise.resolve();

    const schedule = (bytes: Uint8Array) => {
      const samples = Math.floor(bytes.length / 2);
      if (!samples) return;
      const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
      const buf = ctx.createBuffer(1, samples, sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < samples; i++) ch[i] = view.getInt16(i * 2, true) / 0x8000;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      // Small lead-in on the first chunk (and after an underrun) so scheduling never lands in the past.
      nextAt = Math.max(nextAt, ctx.currentTime + 0.05);
      src.start(nextAt);
      nextAt += buf.duration;
      sources.add(src);
      last = new Promise((r) => (src.onended = () => (sources.delete(src), r())));
    };

    for (;;) {
      const { done: eof, value } = await reader.read();
      if (stopped) return new Promise<void>(() => {}); // like a paused <audio>: never resolves
      if (eof) break;
      let bytes = value;
      if (!sampleRate) {
        header = concat(header, bytes);
        if (header.length < 44) continue;
        const h = new DataView(header.buffer, header.byteOffset, 44);
        if (h.getUint32(0, false) !== 0x52494646 || h.getUint16(22, true) !== 1 || h.getUint16(34, true) !== 16) {
          throw new Error("unsupported_wav");
        }
        sampleRate = h.getUint32(24, true);
        bytes = header.subarray(44);
      }
      if (carry) {
        bytes = concat(carry, bytes);
        carry = null;
      }
      if (bytes.length % 2) {
        carry = bytes.slice(-1);
        bytes = bytes.subarray(0, -1);
      }
      schedule(bytes);
    }
    if (!sampleRate) throw new Error("empty_audio");
    await last;
    if (stopped) return new Promise<void>(() => {});
  })();

  return { done, stop };
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
