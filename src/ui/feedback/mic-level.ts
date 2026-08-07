// Live microphone level, sampled from the recording stream.
//
// Why a continuous meter rather than a check: the failure we care about is a user
// who muted without noticing and talks through a whole recording for nothing. A
// verdict at t+4s tells them late and can only ever guess. Four bars that move
// while they speak tell them *instantly*, need no words, and cost them nothing to
// ignore — a muted mic just sits flat in their peripheral vision.
//
// Deliberately framework-free so it can be tested without React and without jsdom
// pretending to have Web Audio.

/** What we can tell about the mic, cheapest signal first. */
export type MicState =
  | "live" // a track is delivering audio (or at least not muted at the OS level)
  | "no-device" // no audioinput exists at all
  | "denied" // the user (or policy) refused the mic prompt
  | "muted" // track exists but the OS/hardware reports it muted
  | "unavailable"; // getUserMedia failed for some other reason

export interface MicLevelMeter {
  /** Smoothed 0..1 level. 0 when there is nothing to measure. */
  level(): number;
  /** True once the input has ever crossed the silence floor during this take. */
  sawSound(): boolean;
  stop(): void;
}

/**
 * Below this RMS we treat the input as silence. Room tone and mic self-noise sit
 * around 0.002–0.005; quiet speech clears 0.02 comfortably. Set it too low and a
 * muted mic looks alive because of dither; too high and a softly-spoken person is
 * told they're silent — which would be worse than saying nothing.
 */
export const SILENCE_FLOOR = 0.01;

type AudioCtor = typeof AudioContext;

function audioContextCtor(): AudioCtor | null {
  const w = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** A meter that measures nothing — used when there's no mic or no Web Audio. */
export function nullMeter(): MicLevelMeter {
  return { level: () => 0, sawSound: () => false, stop: () => {} };
}

/**
 * Start measuring `stream`. Never throws: a browser without Web Audio, or an
 * AudioContext the autoplay policy refuses to start, degrades to a flat meter
 * rather than taking the recording down with it.
 */
export function createMicLevelMeter(stream: MediaStream | null): MicLevelMeter {
  if (!stream || stream.getAudioTracks().length === 0) return nullMeter();
  const Ctor = audioContextCtor();
  if (!Ctor) return nullMeter();

  let ctx: AudioContext;
  let analyser: AnalyserNode;
  let source: MediaStreamAudioSourceNode;
  try {
    ctx = new Ctor();
    analyser = ctx.createAnalyser();
    // Small FFT: we want a loudness number, not a spectrum. Cheap per read.
    analyser.fftSize = 512;
    source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    // NOT connected to ctx.destination — routing the mic to the speakers would
    // give the user a feedback howl the moment they start recording.
  } catch {
    return nullMeter();
  }

  const buf = new Uint8Array(analyser.fftSize);
  let smoothed = 0;
  let sawSound = false;
  let stopped = false;

  return {
    level() {
      if (stopped) return 0;
      try {
        analyser.getByteTimeDomainData(buf);
      } catch {
        return 0;
      }
      // RMS around the 128 midpoint of unsigned 8-bit PCM.
      let sumSquares = 0;
      for (let i = 0; i < buf.length; i++) {
        const deviation = (buf[i] - 128) / 128;
        sumSquares += deviation * deviation;
      }
      const rms = Math.sqrt(sumSquares / buf.length);
      if (rms >= SILENCE_FLOOR) sawSound = true;
      // Asymmetric smoothing: jump up fast so a syllable registers immediately,
      // fall slowly so the bars read as a level rather than a strobe.
      smoothed = rms > smoothed ? rms : smoothed * 0.8 + rms * 0.2;
      return Math.min(1, smoothed);
    },
    sawSound: () => sawSound,
    stop() {
      if (stopped) return;
      stopped = true;
      try { source.disconnect(); } catch { /* already torn down */ }
      try { void ctx.close(); } catch { /* already closed */ }
    },
  };
}

/**
 * Tidy a raw MediaDeviceInfo/track label for display.
 *
 * Browsers hand back things like "Default - MacBook Pro Microphone (Built-in)" or
 * "Yeti Stereo Microphone (b58e:9e84)". The user only needs the device, not
 * Chrome's routing prefix or a USB vendor id.
 */
export function prettyDeviceLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/^(default|communications)\s*[-–]\s*/i, "")
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "")
    .trim();
  return cleaned || null;
}

/**
 * Label of the microphone that will actually be used, or null if unknown.
 *
 * Labels are only exposed AFTER the origin has been granted mic permission, so
 * this returns null on a first visit — callers must treat that as "don't show a
 * name", never as "no mic".
 */
export async function defaultAudioInputLabel(): Promise<string | null> {
  const md = globalThis.navigator?.mediaDevices;
  if (!md?.enumerateDevices) return null;
  try {
    const inputs = (await md.enumerateDevices()).filter((d) => d.kind === "audioinput");
    if (!inputs.length) return null;
    // Chrome lists the active choice first as deviceId "default".
    const preferred = inputs.find((d) => d.deviceId === "default") ?? inputs[0];
    return prettyDeviceLabel(preferred.label);
  } catch {
    return null;
  }
}

/**
 * Is there an audio input at all? Answers BEFORE any permission prompt — browsers
 * expose device *presence* without labels pre-permission — so the widget can warn
 * before the user records rather than after.
 *
 * Returns null when it can't tell, which callers must treat as "assume fine"
 * rather than as "no mic".
 */
export async function hasAudioInputDevice(): Promise<boolean | null> {
  const md = globalThis.navigator?.mediaDevices;
  if (!md?.enumerateDevices) return null;
  try {
    const devices = await md.enumerateDevices();
    // Some browsers report a single blank-deviceId entry pre-permission; that
    // still proves an input exists.
    return devices.some((d) => d.kind === "audioinput");
  } catch {
    return null;
  }
}

/**
 * Where THIS user unmutes their microphone.
 *
 * The path differs per OS, and naming the wrong one is worse than staying vague —
 * a Windows user told to open "System Settings → Sound → Input" concludes the
 * message isn't for them. Falls back to neutral wording when we can't tell.
 */
export function unmuteHint(): string {
  const nav = globalThis.navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined;
  // userAgentData is Chromium-only; userAgent is the portable fallback. We match
  // on both rather than the deprecated navigator.platform alone.
  const raw = `${nav?.userAgentData?.platform ?? ""} ${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`.toLowerCase();
  // Order matters: iPadOS reports "mac" in its UA, and Android reports "linux".
  if (/android/.test(raw)) return "your device's sound settings";
  if (/iphone|ipad|ipod/.test(raw)) return "Settings → Privacy & Security → Microphone";
  if (/mac os|macintosh|macos/.test(raw)) return "System Settings → Sound → Input";
  if (/windows|win32|win64/.test(raw)) return "Settings → System → Sound → Input";
  if (/linux|x11|cros/.test(raw)) return "your system sound settings";
  return "your system sound settings";
}
