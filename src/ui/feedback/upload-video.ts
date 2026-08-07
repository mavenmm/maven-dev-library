import { Upload } from "tus-js-client";

// Resumable (tus) upload of the recorded blob directly from the browser to the
// Vimeo upload link minted server-side. The Vimeo token never reaches the
// browser — `uploadLink` is a one-time tus resource URL.

/** Upload failure with the HTTP detail tus already had but used to discard. */
export class VideoUploadError extends Error {
  readonly name = "VideoUploadError";
  readonly httpStatus?: number;
  readonly responseBody?: string;
  readonly cause?: unknown;

  constructor(message: string, opts: { httpStatus?: number; responseBody?: string; cause?: unknown } = {}) {
    super(message);
    this.httpStatus = opts.httpStatus;
    this.responseBody = opts.responseBody;
    this.cause = opts.cause;
    Object.setPrototypeOf(this, VideoUploadError.prototype);
  }
}

/**
 * tus surfaces HTTP failures as a DetailedError carrying `originalResponse`.
 * Reading it turns "tus: failed to upload chunk" — which tells a developer
 * nothing — into the status and body Vimeo actually replied with. The shape is
 * probed defensively because it is not part of tus's typed public API.
 */
function describeTusError(err: unknown): VideoUploadError {
  const detailed = err as { originalResponse?: { getStatus?: () => number; getBody?: () => string } };
  const res = detailed?.originalResponse;
  const httpStatus = typeof res?.getStatus === "function" ? res.getStatus() : undefined;
  let responseBody: string | undefined;
  try {
    responseBody = typeof res?.getBody === "function" ? String(res.getBody()).slice(0, 300) : undefined;
  } catch {
    responseBody = undefined;
  }

  const base = err instanceof Error ? err.message : String(err);
  const suffix = httpStatus ? ` (HTTP ${httpStatus}${responseBody ? ` — ${responseBody}` : ""})` : "";
  return new VideoUploadError(`Vimeo upload failed: ${base}${suffix}`, { httpStatus, responseBody, cause: err });
}

export function uploadToVimeoTus(uploadLink: string, file: Blob, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!uploadLink) {
      reject(new VideoUploadError("Vimeo upload failed: no upload link was issued."));
      return;
    }
    const upload = new Upload(file, {
      uploadUrl: uploadLink,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      metadata: { filename: "feedback-recording.webm", filetype: "video/webm" },
      onError: (err) => reject(describeTusError(err)),
      onProgress: (sent, total) => { if (onProgress && total > 0) onProgress(sent / total); },
      onSuccess: () => resolve(),
    });
    // A synchronous throw from start() (bad URL, blocked by CSP) would otherwise
    // escape the promise entirely and surface as an unhandled rejection.
    try {
      upload.start();
    } catch (err) {
      reject(describeTusError(err));
    }
  });
}
