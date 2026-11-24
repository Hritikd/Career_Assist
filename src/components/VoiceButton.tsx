"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onTranscript: (text: string) => void;
  disabled?: boolean;
};

export default function VoiceButton({ onTranscript, disabled }: Props) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined"
    );
    return () => stopTracks();
  }, []);

  function stopTracks() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      try {
        mediaRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRef.current = null;
    setRecording(false);
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        setBusy(true);
        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          const form = new FormData();
          form.append("file", blob, "recording.webm");
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Transcription failed");
          onTranscript(data.transcript || "");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not transcribe.");
        } finally {
          setBusy(false);
          stopTracks();
        }
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
      timerRef.current = window.setTimeout(() => {
        if (mediaRef.current && mediaRef.current.state === "recording") {
          mediaRef.current.stop();
        }
      }, 20000);
    } catch {
      setError("Microphone permission denied. You can keep typing.");
      stopTracks();
    }
  }

  function toggle() {
    if (disabled || busy) return;
    if (recording) {
      mediaRef.current?.stop();
      return;
    }
    void start();
  }

  if (!supported) return null;

  return (
    <div className="voice-wrap">
      <button
        type="button"
        className={`btn ghost voice ${recording ? "recording" : ""}`}
        onClick={toggle}
        disabled={disabled || busy}
        aria-pressed={recording}
      >
        {busy ? "Transcribing…" : recording ? "Stop (max 20s)" : "Hold mic / tap to talk"}
      </button>
      {error ? <p className="error-inline">{error}</p> : null}
    </div>
  );
}
