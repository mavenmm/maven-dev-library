import type { VideoUploadTarget } from "./types";
import { FeedbackError, isPermanentHttpStatus, messageOf, pushWarning, readBodyText, safeBodyText, snip, type WarningSink } from "./errors";

const VIMEO_API = "https://api.vimeo.com";

function vheaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.vimeo.*+json;version=3.4", ...extra };
}

export function vimeoWatchUrl(videoId: string): string { return `https://vimeo.com/${videoId}`; }

/** Create a Vimeo video + a resumable (tus) upload target of the given byte size. Unlisted privacy. */
export async function createVimeoUpload(token: string, name: string, sizeBytes: number): Promise<VideoUploadTarget> {
  let res: Response;
  try {
    res = await fetch(`${VIMEO_API}/me/videos`, {
      method: "POST",
      headers: vheaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ upload: { approach: "tus", size: sizeBytes }, name: name.slice(0, 128), privacy: { view: "unlisted" } }),
    });
  } catch (err) {
    throw new FeedbackError({ step: "vimeo.createUpload", message: `Vimeo create-upload could not reach the API: ${messageOf(err)}`, cause: err });
  }

  // FULL body — it gets parsed below. Truncate only when quoting it in a message.
  const text = await readBodyText(res);
  if (!res.ok) {
    throw new FeedbackError({
      step: "vimeo.createUpload",
      message: `Vimeo create-upload failed: HTTP ${res.status} — ${snip(text)}`,
      httpStatus: res.status,
      responseBody: snip(text),
    });
  }

  let j: { uri?: string; upload?: { upload_link?: string } };
  try {
    j = JSON.parse(text) as typeof j;
  } catch (err) {
    throw new FeedbackError({ step: "vimeo.createUpload", message: `Vimeo create-upload returned unparseable JSON — ${snip(text)}`, httpStatus: res.status, responseBody: snip(text), cause: err, retryable: false });
  }

  const uploadLink = j.upload?.upload_link ?? "";
  const videoUri = j.uri ?? "";
  const videoId = videoUri.split("/").pop() ?? "";
  if (!uploadLink || !videoId) {
    // Previously threw without the body, so "why did Vimeo not give us a link?"
    // was unanswerable from the log alone.
    throw new FeedbackError({
      step: "vimeo.createUpload",
      message: `Vimeo create-upload returned no upload link or id — ${snip(text)}`,
      httpStatus: res.status,
      responseBody: snip(text),
      retryable: false,
    });
  }
  return { videoId, videoUri, uploadLink };
}

/** Best-effort: file the video into a folder BY ID. Never throws; pass `warnings` for the reason. */
export async function moveVideoToFolder(token: string, videoId: string, folderId?: string, warnings?: WarningSink): Promise<boolean> {
  if (!folderId) return false;
  try {
    const res = await fetch(`${VIMEO_API}/me/projects/${folderId}/videos/${videoId}`, { method: "PUT", headers: vheaders(token) });
    if (!res.ok) {
      pushWarning(warnings, {
        step: "vimeo.moveToFolder",
        message: `Video ${videoId} uploaded but not filed into folder ${folderId}: HTTP ${res.status}`,
        httpStatus: res.status,
      });
    }
    return res.ok;
  } catch (err) {
    pushWarning(warnings, { step: "vimeo.moveToFolder", message: `Video ${videoId} folder move could not reach the API: ${messageOf(err)}` });
    return false;
  }
}

/** VTT → plain text: drop header/timestamps/tags + consecutive duplicate cues. */
export function vttToText(vtt: string): string {
  const out: string[] = [];
  let last = "";
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === "WEBVTT" || line.includes("-->")) continue;
    if (/^\d+$/.test(line) || /^NOTE\b/.test(line)) continue;
    const t = line.replace(/<[^>]+>/g, "").trim();
    if (!t || t === last) continue;
    out.push(t); last = t;
  }
  return out.join(" ").trim();
}

/**
 * Outcome of asking Vimeo for a video's auto-transcript.
 *
 * The three cases used to collapse into `string | null`, and that single missing
 * distinction is what hid a six-day outage: an expired token answered 401 on every
 * poll, `null` said "not ready yet", and the poller patiently retried a request
 * that could never succeed until it ran out of attempts ~80 minutes later. A
 * "pending" that can never resolve must not look like a "pending" that will.
 */
export type TranscriptResult =
  | { status: "ready"; text: string }
  | { status: "pending" }
  | { status: "error"; error: FeedbackError };

function transcriptError(message: string, httpStatus?: number, body?: string): TranscriptResult {
  return { status: "error", error: new FeedbackError({ step: "vimeo.fetchTranscript", message, httpStatus, responseBody: body }) };
}

/** Fetch the auto-transcript, distinguishing "not ready yet" from "will never work". */
export async function fetchTranscriptResult(token: string, videoId: string): Promise<TranscriptResult> {
  let res: Response;
  try {
    res = await fetch(`${VIMEO_API}/videos/${videoId}/texttracks`, { headers: vheaders(token) });
  } catch (err) {
    return { status: "error", error: new FeedbackError({ step: "vimeo.fetchTranscript", message: `Vimeo texttracks could not reach the API: ${messageOf(err)}`, cause: err }) };
  }

  if (!res.ok) {
    const body = await safeBodyText(res, 200);
    const permanent = isPermanentHttpStatus(res.status);
    return transcriptError(
      permanent
        ? `Vimeo texttracks rejected the request (HTTP ${res.status}) — check the Vimeo token or that video ${videoId} still exists. Retrying cannot help. ${body}`
        : `Vimeo texttracks failed: HTTP ${res.status} — ${body}`,
      res.status,
      body,
    );
  }

  let data: { data?: Array<{ link?: string; active?: boolean }> };
  try {
    data = (await res.json()) as typeof data;
  } catch (err) {
    return { status: "error", error: new FeedbackError({ step: "vimeo.fetchTranscript", message: `Vimeo texttracks returned unparseable JSON: ${messageOf(err)}`, httpStatus: res.status, cause: err }) };
  }

  const track = (data.data ?? []).find((t) => t.link);
  // No track yet is the genuine "still transcribing" case — and also the terminal
  // state for a video with no speech at all. Vimeo gives us no way to tell them
  // apart, which is why the caller needs its own attempt budget.
  if (!track?.link) return { status: "pending" };

  let vttRes: Response;
  try {
    vttRes = await fetch(track.link);
  } catch (err) {
    return { status: "error", error: new FeedbackError({ step: "vimeo.fetchTranscript", message: `Vimeo VTT download could not reach the CDN: ${messageOf(err)}`, cause: err }) };
  }
  if (!vttRes.ok) return transcriptError(`Vimeo VTT download failed: HTTP ${vttRes.status}`, vttRes.status);

  const text = vttToText(await vttRes.text());
  return text ? { status: "ready", text } : { status: "pending" };
}

/**
 * @deprecated Collapses "not ready" and "permanently broken" into the same `null`.
 * Use {@link fetchTranscriptResult}. Kept so existing hosts keep compiling.
 */
export async function fetchTranscript(token: string, videoId: string): Promise<string | null> {
  const out = await fetchTranscriptResult(token, videoId);
  return out.status === "ready" ? out.text : null;
}
