# Audio assets integrated from supplied archives

- `public/audio/cs2/source/` contains the WAV files extracted from the supplied `CS2_WAV.zip` (all 1,168 WAV files).
- `public/audio/cs2/manifest.json` maps actual extracted WAV samples to game events where the source archive has a suitable sound.
- `public/audio/footstep_1.wav` through `footstep_6.wav` use extracted CS2 concrete footsteps.
- `source-assets/CS2-compiled-sounds.zip` preserves the supplied `sounds.zip` archive.

Important technical limitation:
The supplied `sounds.zip` contains Source 2 compiled `.vsnd_c` assets, not browser-ready WAV/OGG. A browser Web Audio decoder cannot play those compiled files directly. The supplied `CS2_WAV.zip` does not contain per-weapon firing/reload/draw sound WAVs; it contains footsteps, player reactions, physics/impact sounds, item sounds, etc. So per-weapon gunfire/reload events without a matching extracted WAV still use the game's existing synthesized fallback. To use the compiled CS2 gunfire sounds, those `.vsnd_c` files must first be decoded with a Source 2 asset tool, then mapped into the manifest.
