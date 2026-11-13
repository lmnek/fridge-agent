# 9. Brand and the orb: the ice tesseract

Every beat. This is the one place in the app to go all-out (CLAUDE.md, Design taste).

## Goal

The product is **Coldex**, and its mark is an ice cube. Coldex's "orb" becomes an **ice cube with endless
dimensions, like a tesseract**: a see-through cube of ice that folds through itself, with cubes inside cubes
receding without end. It has to be smooth, sexy, impressive and see-through. It's the face of the demo, on the
projector for three minutes, so it should make people want to talk to it.

## How it behaves

- **Floating freely (idle and listening):** it drifts and bobs slowly and turns through its fourth dimension,
  so the inner cubes fold out and back in. Light glints off the edges. It's calm, but never still.
- **Listening:** the mic level makes it lean in slightly and the ice catch more light, so you can see it hears you.
- **Thinking (tools running):** the inner cubes cycle inward, like it's looking deeper.
- **Talking:** Coldex's voice level drives it. The 4D rotation speeds up with the voice, the inner cubes pulse
  outward on stressed syllables, and the refraction and edge light swell. It should feel like the voice comes
  from inside the ice.
- **Every transition is smooth**: eased and springy, with no jumps between states.
- **The look:** clear ice, with refraction, a little frost on the edges, cool whites and a hint of ice blue.
  No purple, no neon, no sparkles. The background shows through the cube.

## Done when

- The orb component keeps today's interface (`status`, `levels`, `onToggle` in `app/src/Orb.tsx`), so parts 1
  and 2 don't change, and it reacts to all four states above.
- It runs at a smooth 60 fps on the stage laptop and the kitchen tablet. A lighter fallback kicks in
  automatically on weak hardware.
- **The ice cube logo:** a simple mark that reads at favicon size. A still, line-drawn frame of the
  tesseract fits well. The wordmark is "Coldex".
- **The brand in the app:** the page title, the favicon and every visible string say Coldex (today the title
  says "Fridge").

## Experiment first

Build 2–3 variants in parallel behind a URL switch (for example `?orb=a`), compare them on the real projector
at 14:00, pick one and polish it. Directions worth trying:
1. **Glass mesh:** a 4D hypercube rotated and projected to 3D every frame, rendered with a transmission/refraction
   material (three.js with react-three-fiber), with soft bloom.
2. **Raymarched shader:** one fragment shader that raymarches an ice tesseract with refraction. No 3D library.
3. **Nested cubes:** recursive cubes inside cubes with the endless-depth illusion, cheaper and very smooth.

## Where

`app/src/Orb.tsx` (or `app/src/orb/`), `app/public/` for the logo and favicon, and `app/index.html`.
A 3D library is a fair new dependency for this piece only.

## Parallelize

One subagent per variant. Once one is picked: one subagent on the talking reaction, one on the logo and brand
pass, and one on the performance fallback.

## Risks

- Performance on the tablet.
- Over-designing it into slop. Keep it to one object, one material and one light story.
- Echo and silence: the talking reaction needs Coldex's output level, not the mic level.
