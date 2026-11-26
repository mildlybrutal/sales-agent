"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Hands-free microphone capture with a simple energy-based voice activity
 * detector (VAD).
 *
 *   listening ──(speech ≥150 ms)──▶ recording ──(silence ≥1.2 s)──▶ onUtterance(blob)
 *
 * The MediaRecorder runs for the whole listening window so the first syllable
 * is never clipped; Whisper ignores the leading silence.
 */
export interface VoiceCaptureOptions {
  onSpeechStart: () => void;
  onUtterance: (audio: Blob) => void;
  onLevel?: (level: number) => void;
}

const FRAME_MS = 50;
const SPEECH_FRAMES = 3; // 150 ms above threshold → speech
const SILENCE_MS = 1200; // end of utterance
const MAX_UTTERANCE_MS = 30_000;
const IDLE_RESET_MS = 20_000; // restart the recorder if nobody speaks
const CALIBRATION_MS = 600;

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

export function useVoiceCapture(opts: VoiceCaptureOptions) {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);

  const vad = useRef({ active: false, speaking: false, aboveFrames: 0, lastVoiceAt: 0, startedAt: 0, listenStartedAt: 0, threshold: 0.02, floorSamples: [] as number[] });

  /** Ask for the mic. Throws a DOMException (NotAllowedError, NotFoundError…) on failure. */
  const open = useCallback(async () => {
    if (streamRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    streamRef.current = stream;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    ctxRef.current = ctx;
    analyserRef.current = analyser;
  }, []);

  const stopRecorder = useCallback((discard: boolean) => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      discardRef.current = discard;
      rec.stop();
    }
    recorderRef.current = null;
  }, []);

  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    discardRef.current = false;
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      if (discardRef.current) return;
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size > 1000) optsRef.current.onUtterance(blob);
    };
    rec.start(250);
    recorderRef.current = rec;
  }, []);

  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    const v = vad.current;
    if (!analyser || !v.active) return;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const x of buf) sum += x * x;
    const rms = Math.sqrt(sum / buf.length);
    optsRef.current.onLevel?.(Math.min(1, rms / 0.15));
    const now = performance.now();

    // Calibrate the noise floor during the first moments of each listening window.
    if (now - v.listenStartedAt < CALIBRATION_MS && !v.speaking) {
      v.floorSamples.push(rms);
      const floor = v.floorSamples.reduce((a, b) => a + b, 0) / v.floorSamples.length;
      v.threshold = Math.min(0.08, Math.max(0.012, floor * 3));
      return;
    }

    if (!v.speaking) {
      v.aboveFrames = rms > v.threshold ? v.aboveFrames + 1 : 0;
      if (v.aboveFrames >= SPEECH_FRAMES) {
        v.speaking = true;
        v.startedAt = now;
        v.lastVoiceAt = now;
        optsRef.current.onSpeechStart();
      } else if (now - v.listenStartedAt > IDLE_RESET_MS) {
        // Nobody spoke: recycle the recorder so blobs stay small.
        stopRecorder(true);
        startRecorder();
        v.listenStartedAt = now - CALIBRATION_MS;
      }
      return;
    }

    if (rms > v.threshold * 0.8) v.lastVoiceAt = now;
    if (now - v.lastVoiceAt > SILENCE_MS || now - v.startedAt > MAX_UTTERANCE_MS) {
      v.active = false;
      stopRecorder(false);
    }
  }, [startRecorder, stopRecorder]);

  /** Begin a listening window (recorder + VAD). */
  const listen = useCallback(() => {
    if (!streamRef.current) return;
    void ctxRef.current?.resume();
    stopRecorder(true);
    vad.current = { active: true, speaking: false, aboveFrames: 0, lastVoiceAt: 0, startedAt: 0, listenStartedAt: performance.now(), threshold: 0.02, floorSamples: [] };
    startRecorder();
    if (!timerRef.current) timerRef.current = setInterval(tick, FRAME_MS);
  }, [startRecorder, stopRecorder, tick]);

  /** Stop listening. `send` = deliver what was captured; otherwise discard. */
  const pause = useCallback(
    (send = false) => {
      vad.current.active = false;
      stopRecorder(!send);
      optsRef.current.onLevel?.(0);
    },
    [stopRecorder],
  );

  const close = useCallback(() => {
    pause(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
  }, [pause]);

  useEffect(() => close, [close]);

  return { open, listen, pause, close };
}
