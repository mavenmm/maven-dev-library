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

/**
 * Where in the recording to grab frames, as fractions of duration.
 *
 * Not 0 and not 1: a screen recording opens on whatever was on screen before the
 * user got going, and ends with them reaching for Stop. 20% and 70% land inside
 * the part where they're actually demonstrating the problem.
 */
const FRAME_POSITIONS = [0.2, 0.7];
/** Widest size we ask Vimeo for. 1920 exists but is needless weight in a comment. */
const FRAME_TARGET_WIDTH = 1280;

/** Video length in seconds, or null if it can't be read. */
async function videoDurationSec(token: string, videoId: string): Promise<number | null> {
  try {
    const res = await fetch(`${VIMEO_API}/videos/${videoId}?fields=duration`, { headers: vheaders(token) });
    if (!res.ok) return null;
    const j = (await res.json()) as { duration?: number };
    const d = Number(j.duration);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/** Pick the size closest to FRAME_TARGET_WIDTH without going under it. */
function pickSize(sizes: Array<{ width?: number; link?: string }> | undefined): string | null {
  const usable = (sizes ?? []).filter((s) => s.link);
  if (!usable.length) return null;
  const atLeastTarget = usable.filter((s) => (s.width ?? 0) >= FRAME_TARGET_WIDTH);
  const chosen = atLeastTarget.length
    ? atLeastTarget.reduce((a, b) => ((a.width ?? 0) <= (b.width ?? 0) ? a : b))
    : usable.reduce((a, b) => ((a.width ?? 0) >= (b.width ?? 0) ? a : b));
  return chosen.link ?? null;
}

/**
 * Public image URLs for still frames from the recording.
 *
 * Why this exists: the videos are unlisted and private to our Vimeo account, so
 * nothing outside it can see them — but Vimeo's thumbnail CDN serves these frame
 * URLs with **no auth at all** (verified 2026-08-11: HTTP 200, image/jpeg). So an
 * `<img>` in a Teamwork comment just works, for a human or for an LLM reading the
 * task, which is exactly what Dave asked for.
 *
 * Frames are generated with `active: false` so we never overwrite the video's own
 * poster image as a side effect. Note the API returns an EMPTY `link` for inactive
 * pictures — the usable URLs are in `sizes[]`.
 *
 * Best-effort: never throws. A missing frame is a warning, not a failed comment.
 */
export async function fetchVideoFrames(token: string, videoId: string, count: number, warnings?: WarningSink): Promise<string[]> {
  if (!Number.isFinite(count) || count <= 0) return [];

  const duration = await videoDurationSec(token, videoId);
  if (duration === null) {
    // Fall back to whatever Vimeo auto-generated — one frame of its choosing beats none.
    const auto = await fetchExistingFrame(token, videoId);
    if (!auto) pushWarning(warnings, { step: "vimeo.frames", message: `Could not read duration or any existing thumbnail for video ${videoId}; task comment will have no frames.` });
    return auto ? [auto] : [];
  }

  const positions = FRAME_POSITIONS.slice(0, count);
  const urls: string[] = [];
  for (const fraction of positions) {
    const time = Math.max(0, Math.min(duration - 0.1, duration * fraction));
    const url = await createFrameAt(token, videoId, time, warnings);
    if (url) urls.push(url);
  }

  if (!urls.length) {
    const auto = await fetchExistingFrame(token, videoId);
    if (auto) return [auto];
    pushWarning(warnings, { step: "vimeo.frames", message: `No frames could be generated for video ${videoId}; task comment will have no frames.` });
  }
  return urls;
}

/** Generate one frame at `time`. Returns its public URL, or null. */
async function createFrameAt(token: string, videoId: string, time: number, warnings?: WarningSink): Promise<string | null> {
  try {
    const res = await fetch(`${VIMEO_API}/videos/${videoId}/pictures`, {
      method: "POST",
      headers: vheaders(token, { "Content-Type": "application/json" }),
      // active:false — additive only. Setting it true would silently replace the
      // video's poster image every time we file a comment.
      body: JSON.stringify({ time: Number(time.toFixed(2)), active: false }),
    });
    if (!res.ok) {
      pushWarning(warnings, {
        step: "vimeo.frames",
        message: `Vimeo would not generate a frame at ${time.toFixed(1)}s for video ${videoId}: HTTP ${res.status} — ${await safeBodyText(res, 160)}`,
        httpStatus: res.status,
      });
      return null;
    }
    const j = (await res.json()) as { sizes?: Array<{ width?: number; link?: string }> };
    return pickSize(j.sizes);
  } catch (err) {
    pushWarning(warnings, { step: "vimeo.frames", message: `Frame generation at ${time.toFixed(1)}s could not reach the Vimeo API: ${messageOf(err)}` });
    return null;
  }
}

/** The video's already-existing (auto-generated) thumbnail URL, or null. */
async function fetchExistingFrame(token: string, videoId: string): Promise<string | null> {
  try {
    const res = await fetch(`${VIMEO_API}/videos/${videoId}/pictures`, { headers: vheaders(token) });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: Array<{ active?: boolean; sizes?: Array<{ width?: number; link?: string }> }> };
    const pics = j.data ?? [];
    const preferred = pics.find((p) => p.active) ?? pics[0];
    return pickSize(preferred?.sizes);
  } catch {
    return null;
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
