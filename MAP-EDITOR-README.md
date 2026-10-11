# CS Online Map Editor (separate page)

- Open `/map-editor.html` or click **ویرایشگر مپ** in the lobby.
- The editor is separate from the live FPS runtime and never takes over player controls.
- Switch between 2D and 3D views, add/move/delete areas, crates, roofs and spawn points.
- Editor WebSocket `/editor-ws` broadcasts edits to other open editor sessions; `/api/maps/save` persists custom definitions in Durable Object storage.
- Existing game map definitions are used as the starting templates. The current build saves custom map JSON in editor storage; it does not yet automatically register every custom map into the playable server map rotation.
- 3D rendering is a preview generated from the game's shared map definitions. This first iteration approximates areas as volumes; ramps and detailed prop geometry still need dedicated editable primitives for a full WOW-style editor.

- **بارگذاری JSON مپ (CS2):** خروجی `tools/map2json.js` (دو فایل `.json` + `.bin`، و تکسچرها در صورت وجود) را هم‌زمان با Ctrl+کلیک انتخاب کن. مپ فقط برای مشاهده/پیش‌نمایش در نمای سه‌بعدی ادیتور است؛ هنوز وارد بازی قابل‌بازی (برخورد، اسپاون، بات‌ها) نمی‌شود.

- **ورود JSON (نقشه‌ی قابل‌بازی):** خروجی `tools/gltf2game.cjs` (فیلد `grid`) را وارد می‌کند؛ پیش‌نمایش ۲بعدی از روی ارتفاع واقعی خانه‌ها کشیده می‌شود، نمای ۳بعدی با `buildWorld` ساخته می‌شود و دکمه‌ی «بررسی نقشه» اسپاون‌ها و دسترسی T→CT/سایت‌ها را چک می‌کند. برای نقشه‌های `grid` ناحیه‌های `areas` فقط جنس کف را تعیین می‌کنند و قابل‌جابجایی نیستند؛ اسپاون‌ها، سایت‌ها و جعبه‌ها قابل ویرایش‌اند.
- **ذخیره:** فقط نقشه‌های جدید/تغییرکرده فرستاده می‌شوند و هر نقشه‌ی سفارشی زیر کلید جدا (`cm:<id>`) ذخیره می‌شود.

## واردکردن خودکار فایل‌های خام CS2
پس از اجرای معمول سرور، صفحهٔ `/advanced-import.html` را باز کن. دو فایل `dust2.json` و `dust2.bin` را با انتخاب فایل در مرورگر وارد کن و روی «پردازش خودکار و ساخت مپ» بزن. نیازی به ترمینال یا دستور تبدیل نیست. پس از اتمام، `dust2_playable.json` را دانلود کن و از ورودی JSON ویرایشگر وارد کن.

این مسیر فایل‌ها را روی سرور موقت پردازش می‌کند و فایل‌های موقت را پس از پایان حذف می‌کند. پردازش خودکار شبکهٔ ارتفاع/سقف را از هندسه استخراج می‌کند؛ نام‌های معنایی کال‌اوت‌ها (مثل Short/Long A) از هندسهٔ ادغام‌شده به‌طور قطعی قابل استنتاج نیستند و باید با ویرایشگر سه‌بعدی نشانه‌گذاری شوند.
