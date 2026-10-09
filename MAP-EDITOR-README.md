# CS Online Map Editor (separate page)

- Open `/map-editor.html` or click **ویرایشگر مپ** in the lobby.
- The editor is separate from the live FPS runtime and never takes over player controls.
- Switch between 2D and 3D views, add/move/delete areas, crates, roofs and spawn points.
- Editor WebSocket `/editor-ws` broadcasts edits to other open editor sessions; `/api/maps/save` persists custom definitions in Durable Object storage.
- Existing game map definitions are used as the starting templates. The current build saves custom map JSON in editor storage; it does not yet automatically register every custom map into the playable server map rotation.
- 3D rendering is a preview generated from the game's shared map definitions. This first iteration approximates areas as volumes; ramps and detailed prop geometry still need dedicated editable primitives for a full WOW-style editor.
