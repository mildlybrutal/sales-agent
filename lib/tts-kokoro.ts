import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { KokoroTTS } from "kokoro-js";

/**
 * Local text-to-speech with Kokoro-82M (ONNX, q8) via kokoro-js, which runs on the
 * same transformers.js / onnxruntime-node as the embeddings. Free, unlimited and
 * offline after the one-time ~90 MB model download. Output: 24 kHz mono float32.
 */
export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const KOKORO_SAMPLE_RATE = 24_000;

const g = globalThis as unknown as { __kokoro?: Promise<KokoroTTS>; __kokoroQueue?: Promise<unknown> };

export function getKokoro(): Promise<KokoroTTS> {
  if (!g.__kokoro) {
    g.__kokoro = import("kokoro-js").then(async ({ KokoroTTS }) => usePackageVoices(await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: "q8", device: "cpu" })));
    // Allow a retry on the next call if loading failed (e.g. offline first run).
    g.__kokoro.catch(() => {
      g.__kokoro = undefined;
    });
  }
  return g.__kokoro;
}

type StyleInputs = Parameters<KokoroTTS["generate_from_ids"]>;

/**
 * kokoro-js locates its voice files via `__dirname`, but the generated Prisma
 * client sets a global `__dirname` (lib/generated/prisma/client.ts), so it looks in
 * the wrong folder. Replace generate_from_ids, the same few lines as upstream, with
 * one that reads voices from the package's own `voices/` directory.
 */
function usePackageVoices(tts: KokoroTTS): KokoroTTS {
  const voices = new Map<string, Promise<Float32Array>>();
  const loadVoice = (voice: string) => {
    if (!/^[a-z]{2}_[a-z]+$/.test(voice)) throw new Error(`invalid kokoro voice "${voice}"`);
    if (!voices.has(voice)) {
      const file = path.join(process.cwd(), "node_modules", "kokoro-js", "voices", `${voice}.bin`);
      const p = readFile(file).then((b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))); // copy: Float32Array needs 4-byte alignment
      p.catch(() => voices.delete(voice));
      voices.set(voice, p);
    }
    return voices.get(voice)!;
  };
  tts.generate_from_ids = async function (inputIds: StyleInputs[0], { voice = "af_heart", speed = 1 }: StyleInputs[1] = {}) {
    const { Tensor, RawAudio } = await import("@huggingface/transformers");
    const tokens = Math.min(Math.max(inputIds.dims.at(-1)! - 2, 0), 509);
    const style = (await loadVoice(voice)).slice(256 * tokens, 256 * tokens + 256);
    const { waveform } = await this.model({
      input_ids: inputIds,
      style: new Tensor("float32", style, [1, 256]),
      speed: new Tensor("float32", [speed], [1]),
    });
    return new RawAudio(waveform.data, KOKORO_SAMPLE_RATE);
  };
  return tts;
}

/** Start loading the model in the background so the first reply isn't delayed by the download. */
export function warmKokoro() {
  getKokoro().catch((e) => console.warn("[tts] kokoro warm-up failed:", e instanceof Error ? e.message.slice(0, 120) : e));
}

/**
 * Synthesises `text` sentence by sentence, yielding 16-bit PCM for each one as soon
 * as it's ready. Synthesis is serialised across requests so concurrent replies
 * don't compete for the CPU (each would otherwise get slower than real time).
 */
export async function* kokoroPcm(text: string, voice: string): AsyncGenerator<Uint8Array> {
  const prev = g.__kokoroQueue ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  g.__kokoroQueue = prev.then(() => mine);
  await prev.catch(() => {});
  try {
    const [tts, { TextSplitterStream }] = await Promise.all([getKokoro(), import("kokoro-js")]);
    // A closed splitter is required: stream(string) never yields the final sentence.
    const splitter = new TextSplitterStream();
    splitter.push(text);
    splitter.close();
    for await (const { audio } of tts.stream(splitter, { voice: voice as "af_heart" })) {
      // Mono output is a single Float32Array; take the first channel if it's ever split.
      yield floatToPcm16(Array.isArray(audio.audio) ? audio.audio[0] : audio.audio);
    }
  } finally {
    release();
  }
}

function floatToPcm16(f: Float32Array): Uint8Array {
  const out = new DataView(new ArrayBuffer(f.length * 2));
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}
