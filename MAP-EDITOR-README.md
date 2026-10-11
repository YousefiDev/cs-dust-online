# CS Online Map Editor (separate page)

- Open `/map-editor.html` or click **ویرایشگر مپ** in the lobby.
- The editor is separate from the live FPS runtime and never takes over player controls.
- Switch between 2D and 3D views, add/move/delete areas, crates, roofs and spawn points.
- Editor WebSocket `/editor-ws` broadcasts edits to other open editor sessions; `/api/maps/save` persists custom definitions in Durable Object storage.
- Existing game map definitions are used as the starting templates. The current build saves custom map JSON in editor storage; it does not yet automatically register every custom map into the playable server map rotation.
- 3D rendering is a preview generated from the game's shared map definitions. This first iteration approximates areas as volumes; ramps and detailed prop geometry still need dedicated editable primitives for a full WOW-style editor.

- **بارگذاری JSON مپ (CS2):** خروجی `tools/map2json.cjs` (دو فایل `.json` + `.bin`، و تکسچرها در صورت وجود) را هم‌زمان با Ctrl+کلیک انتخاب کن. مپ فقط برای مشاهده/پیش‌نمایش در نمای سه‌بعدی ادیتور است. برای قابل‌بازی کردنش خروجی را با `node tools/bin2game.cjs <name>.json -o maps/<id>.json` به `def.grid` تبدیل کن و آن را با «ورود JSON» وارد کن (جزئیات: README-grid.md).

- **ورود JSON (نقشه‌ی قابل‌بازی):** خروجی `tools/gltf2game.cjs` (فیلد `grid`) را وارد می‌کند؛ پیش‌نمایش ۲بعدی از روی ارتفاع واقعی خانه‌ها کشیده می‌شود، نمای ۳بعدی با `buildWorld` ساخته می‌شود و دکمه‌ی «بررسی نقشه» اسپاون‌ها و دسترسی T→CT/سایت‌ها را چک می‌کند. برای نقشه‌های `grid` ناحیه‌های `areas` فقط جنس کف را تعیین می‌کنند و قابل‌جابجایی نیستند؛ اسپاون‌ها، سایت‌ها و جعبه‌ها قابل ویرایش‌اند.
- **ذخیره:** فقط نقشه‌های جدید/تغییرکرده فرستاده می‌شوند و هر نقشه‌ی سفارشی زیر کلید جدا (`cm:<id>`) ذخیره می‌شود.
