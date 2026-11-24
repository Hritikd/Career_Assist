"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onTranscript: (text: string) => void;
  disabled?: boolean;
};

function pickMime(): { mime: string; filename: string } {
  if (typeof MediaRecorder === "undefined") {
    return { mime: "", filename: "recording.webm" };
  }
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return { mime: "audio/webm;codecs=opus", filename: "recording.webm" };
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return { mime: "audio/webm", filename: "recording.webm" };
  }
  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    return { mime: "audio/mp4", filename: "recording.m4a" };
  }
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
    return { mime: "audio/ogg;codecs=opus", filename: "recording.ogg" };
  }
  return { mime: "", filename: "recording.webm" };
}

export default function VoiceButton({ onTranscript, disabled }: Props) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      !!window.isSecureContext &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined";
    setSupported(ok);
    return () => {
      cleanupTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanupTracks() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRef.current = null;
    setRecording(false);
    stoppingRef.current = false;
  }

  async function uploadBlob(blob: Blob, filename: string) {
    if (blob.size < 500) {
      throw new Error("Recording was empty. Tap to talk, speak clearly, then stop.");
    }
    const form = new FormData();
    form.append("file", blob, filename);
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (data && data.error) || "Transcription failed. Please type instead."
      );
    }
    if (!data.transcript) {
      throw new Error("No speech detected. Try again or type instead.");
    }
    onTranscript(String(data.transcript));
  }

  async function start() {
    setError(null);
    stoppingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;
      const { mime, filename } = pickMime();
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = () => {
        setError("Recording failed. Please type instead.");
        cleanupTracks();
      };
      recorder.onstop = async () => {
        if (stoppingRef.current) return;
        stoppingRef.current = true;
        setBusy(true);
        try {
          const type = recorder.mimeType || mime || "audio/webm";
          const blob = new Blob(chunksRef.current, { type });
          await uploadBlob(blob, filename);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not transcribe.");
        } finally {
          setBusy(false);
          cleanupTracks();
        }
      };
      mediaRef.current = recorder;
      // timeslice keeps chunks flowing on mobile Safari/Chrome
      recorder.start(250);
      setRecording(true);
      timerRef.current = window.setTimeout(() => {
        stopRecording();
      }, 20000);
    } catch {
      setError("Microphone permission denied. You can keep typing.");
      cleanupTracks();
    }
  }

  function stopRecording() {
    const recorder = mediaRef.current;
    if (!recorder) return;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (recorder.state === "recording") {
      try {
        recorder.requestData();
      } catch {
        /* ignore */
      }
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  function toggle() {
    if (disabled || busy) return;
    if (recording) {
      stopRecording();
      return;
    }
    void start();
  }

  if (!supported) {
    return (
      <p className="muted" style={{ marginTop: 8, fontSize: "0.9rem" }}>
        Voice input needs a supported mobile/desktop browser over HTTPS. Typing
        still works.
      </p>
    );
  }

  return (
    <div className="voice-wrap">
      <button
        type="button"
        className={`btn ghost voice ${recording ? "recording" : ""}`}
        onClick={toggle}
        disabled={disabled || busy}
        aria-pressed={recording}
      >
        {busy
          ? "Transcribing…"
          : recording
            ? "Stop recording"
            : "Tap to talk (max 20s)"}
      </button>
      {error ? <p className="error-inline">{error}</p> : null}
    </div>
  );
}
