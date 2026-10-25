"use client";

import { useEffect, useRef, useState } from "react";
import { WORKER_URL } from "@/lib/stdb/config";

const MAX_SECONDS = 20;
type Phase = "idle" | "opening" | "ready" | "recording" | "preview" | "uploading" | "processing" | "done";
const MIME_TYPES = ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"];

// 1.2 Mbit/s at 720p is plenty to judge an item and keeps a 20 s clip near 3 MB, so it uploads quickly over a phone tunnel.
const VIDEO_BITS = 1_200_000;
const AUDIO_BITS = 64_000;

/** `extra` is the customer's one additional clip; `asks` is what the review asked them to show in it. */
export function Recorder({ claimId, nonce, fingers, extra = false, asks = [] }: { claimId: bigint; nonce: string; fingers: number; extra?: boolean; asks?: string[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const mounted = useRef(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; name: string } | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [silent, setSilent] = useState(false);
  const [redo, setRedo] = useState<string | null>(null);
  const busy = phase === "opening" || phase === "uploading" || phase === "processing";

  const stopTracks = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current) recorder.current.onstop = null;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stopTracks();
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!clip) { setPreview(""); return; }
    const url = URL.createObjectURL(clip.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);
  useEffect(() => {
    if (phase !== "recording") return;
    const started = Date.now();
    const timer = setInterval(() => {
      const seconds = (Date.now() - started) / 1000;
      setElapsed(seconds);
      if (seconds >= MAX_SECONDS && recorder.current?.state === "recording") recorder.current.stop();
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);

  const prepare = async () => {
    setError(null);
    setRedo(null);
    setClip(null);
    setElapsed(0);
    setPhase("opening");
    stopTracks();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
        // Preserve item sounds as well as speech. Do not silently fall back to a muted recording.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (!mounted.current) { s.getTracks().forEach((t) => t.stop()); return; }
      stream.current = s;
      if (!s.getAudioTracks().some((t) => t.readyState === "live")) throw new Error("No microphone track");
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setPhase("ready");
    } catch {
      stopTracks();
      setPhase("idle");
      setError("Allow both camera and microphone access, then try again. Or choose a video with sound below.");
    }
  };

  const start = () => {
    if (phase !== "ready" || !stream.current) return;
    try {
      const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream.current, {
        ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS,
      });
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        stopTracks();
        if (video.current) video.current.srcObject = null;
        if (!mounted.current) return;
        const type = r.mimeType || mimeType || "video/webm";
        setClip({ blob: new Blob(chunks, { type }), name: type.includes("mp4") ? "claim.mp4" : "claim.webm" });
        setPhase("preview");
      };
      r.onerror = () => {
        r.onstop = null;
        stopTracks();
        setPhase("idle");
        setError("Recording failed. Please try again or choose a video.");
      };
      recorder.current = r;
      r.start(250);
      setElapsed(0);
      setPhase("recording");
    } catch {
      stopTracks();
      setPhase("idle");
      setError("This browser cannot record here. Choose a video with sound instead.");
    }
  };

  const upload = () => {
    if (!clip || busy) return;
    setError(null);
    setPhase("uploading");
    setProgress(0);
    const form = new FormData();
    form.append("video", clip.blob, clip.name);
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open("POST", `${WORKER_URL}/upload/${claimId}?nonce=${encodeURIComponent(nonce)}`);
    xhr.timeout = 180_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(e.loaded / e.total);
    };
    xhr.upload.onload = () => { setProgress(1); setPhase("processing"); };
    const fail = (msg: string) => { setPhase("preview"); setError(msg); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { setSilent((JSON.parse(xhr.responseText) as { checks?: { has_audio?: boolean } }).checks?.has_audio === false); } catch { /* no checks in the reply */ }
        setPhase("done");
        return;
      }
      let message = `Upload failed (${xhr.status}). Your recording is kept; retry below.`;
      let code = "";
      try { const body = JSON.parse(xhr.responseText) as { error?: string; code?: string }; message = body.error || message; code = body.code ?? ""; } catch { /* use HTTP status */ }
      // A missed finger challenge needs a new recording, not a retry of this one.
      if (code === "fingers") { setClip(null); setPhase("idle"); setRedo(message); return; }
      fail(message);
    };
    xhr.onerror = () => fail("Could not reach the upload server. Your recording is kept; check the connection and retry.");
    xhr.ontimeout = () => fail("Upload timed out. Check the claim status before retrying; the server may have received it.");
    xhr.send(form);
  };

  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-line bg-bg p-4" data-testid="recorder">
      {extra ? (
        <div className="space-y-1 text-sm">
          <p className="font-semibold">Your extra clip (one allowed), 10 to 20 seconds:</p>
          {asks.length ? <ul className="list-disc pl-5">{asks.map((a) => <li key={a}>{a}</li>)}</ul> : <p>Show the item and the problem clearly, up close, and say what is wrong.</p>}
          <p><b>At the end, hold up {fingers} {fingers === 1 ? "finger" : "fingers"} next to the item.</b></p>
        </div>
      ) : (
        <p className="text-sm">Record 10 to 20 seconds. Show the whole item and demonstrate the problem up close. Explain what happened aloud and let us hear any relevant sound. <b>At the end, hold up {fingers} {fingers === 1 ? "finger" : "fingers"} next to the item.</b></p>
      )}
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={video} src={preview || undefined} playsInline muted={!preview} controls={!!preview}
          className="block aspect-video max-h-80 w-full max-w-full object-contain" data-testid="recording-preview" />
        {phase === "recording" ? <span className="absolute right-3 top-3 rounded bg-red-700 px-2 py-1 text-sm text-white" role="timer">{Math.ceil(MAX_SECONDS - elapsed)}s remaining · microphone on</span> : null}
      </div>
      {phase === "ready" ? <p className="text-sm font-semibold" role="status">Camera and microphone ready. Not recording yet. Frame the item, then confirm below.</p> : null}
      <div className="flex flex-wrap gap-2">
        {phase === "idle" || phase === "preview" ? <button className="btn btn--primary btn--sm" onClick={() => void prepare()} data-testid="start-recording">{clip ? "Record again" : extra ? "Record extra clip" : "Record video"}</button> : null}
        {phase === "ready" ? <>
          <button className="btn btn--primary btn--sm" onClick={start} data-testid="confirm-recording">Start recording now</button>
          <button className="btn btn--ghost btn--sm" onClick={() => { stopTracks(); if (video.current) video.current.srcObject = null; setPhase("idle"); }}>Cancel</button>
        </> : null}
        {phase === "recording" ? <button className="btn btn--fraud btn--sm" onClick={() => { if (recorder.current?.state === "recording") recorder.current.stop(); }} data-testid="stop-recording">Stop and preview</button> : null}
        {phase === "preview" && clip ? <button className="btn btn--primary btn--sm" onClick={upload} data-testid="upload-recording">Upload video ({(clip.blob.size / 1_000_000).toFixed(1)} MB)</button> : null}
        <label className={`btn btn--ghost btn--sm ${busy || phase === "recording" || phase === "done" ? "opacity-50" : "cursor-pointer"}`}>
          Choose video with sound
          <input type="file" accept="video/*" capture="environment" className="hidden" data-testid="claim-video-input"
            disabled={busy || phase === "recording" || phase === "done"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                stopTracks();
                if (video.current) video.current.srcObject = null;
                setClip({ blob: f, name: f.name }); setError(null); setRedo(null); setPhase("preview");
              }
              e.target.value = "";
            }} />
        </label>
      </div>
      {phase === "opening" ? <p role="status" className="text-sm">Opening camera and microphone…</p> : null}
      {phase === "uploading" || phase === "processing" || phase === "done" ? <>
        <progress value={progress} max={1} className="w-full" data-testid="upload-progress" aria-label="Video transfer" />
        <p role="status" className="text-sm">{phase === "uploading" ? `Uploading ${Math.round(progress * 100)}%…` : phase === "processing" ? `Video transferred. Checking that you held up ${fingers} ${fingers === 1 ? "finger" : "fingers"} at the end…` : "Upload checked. Review is starting."}</p>
        {phase === "done" && silent ? <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" data-testid="upload-silent">That video has no sound, so what you said cannot be transcribed. The footage is still reviewed.</p> : null}
      </> : null}
      {redo ? (
        <div role="alert" className="space-y-1 rounded-lg border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950" data-testid="fingers-redo">
          <p className="font-bold">Please record your video again</p>
          <p>{redo}</p>
        </div>
      ) : null}
      {error ? <div role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800" data-testid="upload-error">{error}</div> : null}
    </div>
  );
}
