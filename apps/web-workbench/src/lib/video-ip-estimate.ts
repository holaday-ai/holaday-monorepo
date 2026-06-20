/**
 * Render-time estimate for the IP「真人换口型」"生成中" hint.
 *
 * latentsync is ~12-14× realtime (measured: a 185-字 / ~35s clip took ~7min
 * end-to-end, incl. Qwen synth + compose). The real audioMs lives only on the
 * backend (ffprobe, same source as fal's maxWaitMs); the panel can't fetch it
 * without a new field, so we ESTIMATE audio length from the 文案 char count
 * (Qwen TTS-VC ~5 字/秒). We deliberately OVER-estimate so users aren't let
 * down by a longer-than-promised wait.
 */

/** Estimated spoken length (seconds) of the IP copy, from char count. */
export function estimateIpAudioSec(text: string): number {
  const chars = [...(text ?? '').trim()].length; // code points — counts CJK chars
  return Math.max(1, Math.ceil(chars / 5)); // ~5 字/秒 (实测 185字≈35-37s)
}

/**
 * Estimated total render time in WHOLE minutes, floored at 2.
 * `ceil((audioSec × 11 + 70) / 60)` — ~11× realtime fal + ~70s synth/compose,
 * rounded up. e.g. 185字→37s→8min (actual ~7min, so we over-promise the wait).
 */
export function estimateIpRenderMinutes(text: string): number {
  const audioSec = estimateIpAudioSec(text);
  const totalSec = audioSec * 11 + 70;
  return Math.max(2, Math.ceil(totalSec / 60));
}

/** The full hint string shown only in the ip_person 生成中 panel. */
export function ipRenderingHint(text: string): string {
  return `真人换口型较慢，预计约 ${estimateIpRenderMinutes(text)} 分钟，请耐心等待。`;
}
