/**
 * HACK(demo): fake speech levels for judging the orb without a live session. Shaped like
 * `FridgeBrain.levels()`: raw, jittery, 0..~0.85, syllables at ~4-5 Hz with stressed peaks and
 * short pauses between phrases.
 */
export function fakeVoice(t: number, loud = 1): number {
  const phrase = t % 3.4;
  if (phrase > 2.7) return 0.015 * Math.random();
  const fadeIn = Math.min(1, phrase / 0.12);
  const syllable = Math.max(0, Math.sin(t * Math.PI * 2 * 2.2 + Math.sin(t * 1.3) * 2.2));
  const stress = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.9 + Math.sin(t * 0.7) * 3));
  const v = syllable ** 1.4 * stress * fadeIn * (0.75 + 0.25 * Math.random());
  return Math.min(1, v * 0.85 * loud);
}
