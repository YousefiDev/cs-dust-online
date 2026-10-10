CS2-style browser audio samples

Runtime audio files are encoded as Ogg Vorbis (.ogg) to reduce download size. The manifest maps game events to the corresponding samples, and audio.js loads these samples through Web Audio API.

The separately supplied sounds.zip contains Source 2 compiled .vsnd_c resources. Browsers cannot decode those files directly. They must first be extracted/converted with a compatible Source 2 resource tool before they can replace these runtime samples. They were not copied into the runtime audio folder because doing so would not make them playable and would greatly increase package size.
