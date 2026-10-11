# Dust II (CS) - playable grid map pipeline

mesh (Source 2 Viewer: world.gltf + .bin) --tools/gltf2game.cjs--> map JSON (def.grid) --Map Editor "ورود JSON"--> save --> game

1. Build the JSON from the mesh (Node 18+):
   node tools/gltf2game.cjs world.gltf --bin de_dust2.bin -o dust2_cs.json --gameplay maps/dust2_cs.json
   (tools use .cjs because the project is "type": "module". --gameplay copies spawns/sites/routes/materials from an existing JSON.)
2. Open /map-editor, log in, click "ورود JSON" (NOT "بارگذاری JSON مپ (CS2)", which is only a mesh viewer) and pick the file.
   The editor accepts: one map def, {maps:{id:def}} bundles, or a dictionary of defs; several files at once; it merges them with the existing list.
   After import it prints a check: walkable cells, spawns on floor, T->CT and T->site reachability. "بررسی نقشه" re-runs it.
3. "ذخیره‌ی همه‌ی تغییرات" sends only new/changed maps (not the built-in ones). Each custom map is stored under its own key (cm:<id>).
4. shared/maps.js and public/shared/maps.js must be identical (npm run sync) and the Worker must be redeployed (wrangler deploy).

## مسیر ب: از خروجی map2json (json + bin) به مپ قابل‌بازی

خروجی `tools/map2json.cjs` (`format: "cs-map-bin"`) فقط «مش برای نمایش» است و بازی آن را نمی‌خواند؛ بازی فقط `def.grid` (+ spawns/sites/buy/holds/theme) را می‌فهمد.
برای تبدیلش:

    node tools/map2json.cjs de_dust2.glb -o out/dust2.json            # مش (نمایشی)
    node tools/bin2game.cjs out/dust2.json -o maps/dust2_game.json --id dust2_game --name "Dust II"

- `--info` فقط محدوده‌ی خودکار و آمار را چاپ می‌کند. اگر اسکای‌باکس/آبجکت دور وارد محدوده شد: `--bounds x0,z0,x1,z1 --ymin .. --ymax ..`
- اسپاون‌ها/سایت‌ها حدسی‌اند؛ با `--gameplay maps/dust2_cs.json` از یک JSON قبلی (با همان مبدأ مختصات) برداشته می‌شوند، یا در ادیتور اصلاح کن.
- بعدش مثل مسیر الف: ادیتور → «ورود JSON» (نه «بارگذاری JSON مپ (CS2)») → ذخیره → `npm run sync` + `wrangler deploy`.
