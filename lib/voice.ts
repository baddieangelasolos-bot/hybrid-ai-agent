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

export function speak(text: string, lang: string): void {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const clean = text.replace(/```[\s\S]*?```/g, ' code block ').replace(/[*_#`>|~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 3000);
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = lang;
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
