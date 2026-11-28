'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeBlob } from './files';

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceOptions {
  engine: 'browser' | 'whisper';
  lang: string;
  /** Called with the full text dictated so far in this session (live preview, then final). */
  onText: (text: string, final: boolean) => void;
  onError: (message: string) => void;
}

export function useVoice(opts: VoiceOptions) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const recRef = useRef<RecognitionLike | null>(null);
  const wantRef = useRef(false);
  const finalRef = useRef('');
  const mediaRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[] } | null>(null);

  const supported = opts.engine === 'whisper' ? typeof MediaRecorder !== 'undefined' : recognitionCtor() !== null;

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    const m = mediaRef.current;
    if (m && m.recorder.state !== 'inactive') m.recorder.stop();
    setListening(false);
  }, []);

  const startBrowser = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      optsRef.current.onError('Voice typing is not supported in this browser. Open the app in Chrome, or switch to Whisper in Settings.');
      return;
    }
    finalRef.current = '';
    wantRef.current = true;
    const begin = () => {
      const rec = new Ctor();
      recRef.current = rec;
      rec.lang = optsRef.current.lang;
      rec.continuous = false; // restarted manually: Android Chrome duplicates text in continuous mode
      rec.interimResults = true;
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const t = r[0]?.transcript ?? '';
          if (r.isFinal) finalRef.current += (finalRef.current && !finalRef.current.endsWith(' ') ? ' ' : '') + t.trim();
          else interim += t;
        }
        optsRef.current.onText((finalRef.current + (interim ? ' ' + interim : '')).trim(), false);
      };
      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        wantRef.current = false;
        setListening(false);
        optsRef.current.onError(e.error === 'not-allowed' ? 'Microphone permission was denied. Allow it in the browser site settings.' : 'Voice typing error: ' + (e.error ?? 'unknown'));
      };
      rec.onend = () => {
        if (wantRef.current) {
          setTimeout(() => wantRef.current && begin(), 120);
        } else {
          setListening(false);
          optsRef.current.onText(finalRef.current.trim(), true);
        }
      };
      try {
        rec.start();
      } catch {
        /* already started */
      }
    };
    begin();
    setListening(true);
  }, []);

  const startWhisper = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 24000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        mediaRef.current = null;
        if (blob.size < 800) return;
        setBusy(true);
        try {
          optsRef.current.onText(await transcribeBlob(new File([blob], 'voice.webm', { type: blob.type }), optsRef.current.lang.slice(0, 2)), true);
        } catch (e) {
          optsRef.current.onError(e instanceof Error ? e.message : 'Transcription failed.');
        } finally {
          setBusy(false);
        }
      };
      mediaRef.current = { recorder, stream, chunks };
      recorder.start();
      setListening(true);
    } catch {
      optsRef.current.onError('Could not open the microphone. Allow microphone access for this site.');
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else if (optsRef.current.engine === 'whisper') void startWhisper();
    else startBrowser();
  }, [listening, startBrowser, startWhisper, stop]);

  useEffect(() => () => stop(), [stop]);
  return { supported, listening, busy, toggle, stop };
}

/* -------------------------------------------------------------------------- */
/*                               read aloud (TTS)                             */
/* -------------------------------------------------------------------------- */

export interface SpeakHandlers {
  onStart?: () => void;
  /** Called when reading finishes OR is stopped/replaced (so every button can reset). */
  onEnd?: () => void;
  onError?: (message: string) => void;
}

let session = 0;
let current: SpeakHandlers | null = null;

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Removes everything that sounds bad when read out: code, links, markdown marks, emoji. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '. ')
    .replace(/\.{2,}/g, '.')
    .replace(/([.!?])\s*\.\s*/g, '$1 ')
    .trim();
}

/** Short pieces: browsers cut off or stall on one very long utterance. */
export function chunkText(text: string, max = 170): string[] {
  const sentences = text.match(/[^.!?\u0964\u061F]+[.!?\u0964\u061F]*\s*/g) ?? [text];
  const out: string[] = [];
  let buf = '';
  const push = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };
  for (const raw of sentences) {
    let sentence = raw;
    while (sentence.length > max) {
      let cut = sentence.lastIndexOf(', ', max);
      if (cut < max * 0.4) cut = sentence.lastIndexOf(' ', max);
      if (cut < 1) cut = max;
      if (buf.length + cut > max) push();
      buf += sentence.slice(0, cut + 1);
      push();
      sentence = sentence.slice(cut + 1);
    }
    if (buf.length + sentence.length > max) push();
    buf += sentence;
  }
  push();
  return out;
}

/** Bengali, Hindi and Arabic text is read with a matching voice even if the setting says English. */
export function detectLang(text: string, fallback: string): string {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters) return fallback;
  const share = (re: RegExp) => (letters.match(re)?.length ?? 0) / letters.length;
  if (share(/[\u0980-\u09FF]/g) > 0.3) return 'bn-BD';
  if (share(/[\u0900-\u097F]/g) > 0.3) return 'hi-IN';
  if (share(/[\u0600-\u06FF]/g) > 0.3) return 'ar-SA';
  return fallback;
}

export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const norm = (l: string) => l.replace('_', '-').toLowerCase();
  const want = norm(lang);
  const base = want.split('-')[0];
  const exact = voices.filter((v) => norm(v.lang) === want);
  const loose = voices.filter((v) => norm(v.lang).split('-')[0] === base);
  const pool = exact.length ? exact : loose;
  if (!pool.length) return null;
  return pool.find((v) => v.localService && v.default) ?? pool.find((v) => v.localService) ?? pool.find((v) => v.default) ?? pool[0];
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done);
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(done, 1200);
  });
}

function friendlyError(code: string): string {
  if (code === 'not-allowed') return 'The browser blocked speech. Tap Read aloud again after touching the page.';
  if (code === 'language-unavailable' || code === 'voice-unavailable') return 'No voice for this language is installed on this device. Add one in your phone text-to-speech settings.';
  if (code === 'synthesis-unavailable') return 'This device has no text-to-speech engine available. Install or enable one in Android settings.';
  return 'Read aloud failed (' + code + ').';
}

/** Ends the current reading and tells its button to reset. */
function finishCurrent(): void {
  const h = current;
  current = null;
  session++;
  h?.onEnd?.();
}

export function speak(text: string, lang: string, handlers: SpeakHandlers = {}): void {
  if (!speechSupported()) {
    handlers.onError?.('This browser cannot read aloud. Open the app in Chrome.');
    return;
  }
  const synth = window.speechSynthesis;
  const busy = synth.speaking || synth.pending || current !== null;
  finishCurrent();
  const chunks = chunkText(cleanForSpeech(text).slice(0, 12000));
  if (chunks.length === 0) {
    handlers.onEnd?.();
    return;
  }
  const id = session;
  current = handlers;
  const useLang = detectLang(text, lang);
  let started = false;

  const begin = (voices: SpeechSynthesisVoice[]) => {
    if (id !== session) return;
    const voice = pickVoice(voices, useLang);
    let i = 0;
    const next = () => {
      if (id !== session) return;
      if (i >= chunks.length) {
        current = null;
        session++;
        handlers.onEnd?.();
        return;
      }
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = voice?.lang ?? useLang;
      if (voice) u.voice = voice;
      u.onstart = () => {
        if (id === session && !started) {
          started = true;
          handlers.onStart?.();
        }
      };
      u.onend = next;
      u.onerror = (e) => {
        if (id !== session) return;
        const code = String((e as SpeechSynthesisErrorEvent).error ?? 'unknown');
        if (code === 'canceled' || code === 'interrupted') return;
        current = null;
        session++;
        synth.cancel();
        handlers.onError?.(friendlyError(code));
        handlers.onEnd?.();
      };
      synth.speak(u);
    };
    next();
    // Silent failure guard: some phones have no engine and never fire anything.
    setTimeout(() => {
      if (id === session && !started && !synth.speaking) {
        current = null;
        session++;
        synth.cancel();
        handlers.onError?.('Nothing was spoken. Check the media volume and that a text-to-speech engine is installed (Android: Settings > Text-to-speech).');
        handlers.onEnd?.();
      }
    }, 5000);
  };

  const go = () => void loadVoices().then(begin);
  if (busy) {
    // Chrome ignores speak() right after cancel(): wait a beat. The normal (idle) path stays inside the tap.
    synth.cancel();
    setTimeout(go, 90);
  } else if (synth.getVoices().length > 0) {
    begin(synth.getVoices());
  } else {
    go();
  }
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  finishCurrent();
}
