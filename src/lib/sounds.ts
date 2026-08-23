/** Web UI sound cues — mp3 in public/sounds (ogg when ffmpeg conversion is available). */

export type RoutySound = "gold" | "route_finish";

const SOUND_VOLUME = 0.4;
const SOUND_EXT = "mp3";

const cache = new Map<RoutySound, HTMLAudioElement>();

function soundSrc(name: RoutySound): string {
  return `/sounds/${name}.${SOUND_EXT}`;
}

function getAudio(name: RoutySound): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(soundSrc(name));
    audio.volume = SOUND_VOLUME;
    cache.set(name, audio);
  }
  return audio;
}

/** Play a short cue; safe to call repeatedly (restarts the clip). */
export function playRoutySound(name: RoutySound): void {
  const audio = getAudio(name);
  if (!audio) return;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    /* autoplay policy — ignore */
  });
}
