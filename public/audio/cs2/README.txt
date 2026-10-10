REAL CS2 SOUNDS (optional)
==========================
The game already ships with synthesized CS2-style sounds. If you own CS2 and extract its sound files
yourself (e.g. with Source 2 Viewer, converting to .wav/.mp3/.ogg), put them in this folder and list
them in manifest.json. Any name listed there replaces the synthesized sound. A name may be a single
file or a list (a random variant is played each time).

Example manifest.json:
{
  "ak47": ["ak47_1.wav", "ak47_2.wav"],
  "awp": "awp.wav",
  "c4_beep": "c4_beep.wav",
  "c4_explode": "c4_explode.wav"
}

Available names:
  Weapons : ak47 galil sg553 m4a4 m4a1s famas aug awp mac10 mp9 p90 deagle glock usp knife
  Reload  : reload  (generic)  or  reload_<weapon>  e.g. reload_ak47
  Other   : dry  hit_head  hit_body  hurt  nade_throw  he  flash  smoke
  Bomb    : c4_plant (keypad)  c4_planted  c4_beep  c4_beep_fast (last 5s)
            c4_defuse  c4_defused  c4_explode
Footsteps are separate: footstep_1.wav ... footstep_6.wav in /audio/
