import type { VideoUploadTarget } from "./types";

const VIMEO_API = "https://api.vimeo.com";

function vheaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.vimeo.*+json;version=3.4", ...extra };
}

export function vimeoWatchUrl(videoId: string): string { return `https://vimeo.com/${videoId}`; }

/** Create a Vimeo video + a resumable (tus) upload target of the given byte size. Unlisted privacy. */
export async function createVimeoUpload(token: string, name: string, sizeBytes: number): Promise<VideoUploadTarget> {
  const res = await fetch(`${VIMEO_API}/me/videos`, {
    method: "POST",
    headers: vheaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ upload: { approach: "tus", size: sizeBytes }, name: name.slice(0, 128), privacy: { view: "unlisted" } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vimeo create-upload failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  const j = JSON.parse(text) as { uri?: string; upload?: { upload_link?: string } };
  const uploadLink = j.upload?.upload_link ?? "";
  const videoUri = j.uri ?? "";
  const videoId = videoUri.split("/").pop() ?? "";
  if (!uploadLink || !videoId) throw new Error("Vimeo create-upload returned no upload link or id.");
  return { videoId, videoUri, uploadLink };
}

/** Best-effort: file the video into a folder BY ID (bug B2 fix — no name-match/pagination). Never throws. */
export async function moveVideoToFolder(token: string, videoId: string, folderId?: string): Promise<boolean> {
  if (!folderId) return false;
  try {
    const res = await fetch(`${VIMEO_API}/me/projects/${folderId}/videos/${videoId}`, { method: "PUT", headers: vheaders(token) });
    return res.ok;
  } catch { return false; }
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

/** Fetch the auto-transcript as plain text, or null if not ready yet. */
export async function fetchTranscript(token: string, videoId: string): Promise<string | null> {
  const res = await fetch(`${VIMEO_API}/videos/${videoId}/texttracks`, { headers: vheaders(token) });
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: Array<{ link?: string; active?: boolean }> };
  const track = (data.data ?? []).find((t) => t.link);
  if (!track?.link) return null;
  const vttRes = await fetch(track.link);
  if (!vttRes.ok) return null;
  const text = vttToText(await vttRes.text());
  return text || null;
}
