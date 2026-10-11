# Dust II (CS) - playable grid map

1. Copy shared/maps.js over BOTH shared/maps.js and public/shared/maps.js (adds def.grid support to buildMap).
2. Load maps/dust2_cs.json in /map-editor.html (JSON import) and save (id dust2_cs).
3. Rebuild from the mesh:
   node tools/gltf2game.cjs world.gltf --bin de_dust2.bin -o dust2_cs.json --gameplay dust2_real.json
   (tools use .cjs because the project is "type": "module").
