import { Upload } from "tus-js-client";

// Resumable (tus) upload of the recorded blob directly from the browser to the
// Vimeo upload link minted server-side. The Vimeo token never reaches the
// browser — `uploadLink` is a one-time tus resource URL.
export function uploadToVimeoTus(uploadLink: string, file: Blob, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      uploadUrl: uploadLink,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      metadata: { filename: "feedback-recording.webm", filetype: "video/webm" },
      onError: (err) => reject(err),
      onProgress: (sent, total) => { if (onProgress && total > 0) onProgress(sent / total); },
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}
