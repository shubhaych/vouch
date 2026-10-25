/** Shared judge-session helpers for the QR → phone → desktop handoff. */

export type HandoffStatus =
  | "waiting_phone"
  | "video_received"
  | "checking"
  | "result_ready";

export const HANDOFF_LABEL: Record<HandoffStatus, string> = {
  waiting_phone: "Waiting for phone",
  video_received: "Video received",
  checking: "Checking evidence and policy",
  result_ready: "Result ready",
};

export const HANDOFF_STEPS: HandoffStatus[] = [
  "waiting_phone",
  "video_received",
  "checking",
  "result_ready",
];

/** Prefer an explicit public origin so a phone can open the QR off the laptop. */
export function publicOrigin(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "";
  }
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (env) return env;
  // localhost QR codes do not open on a phone — surface that honestly.
  return window.location.origin;
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  } catch {
    return true;
  }
}
