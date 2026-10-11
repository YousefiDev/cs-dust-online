# راه‌اندازی نسخه Cloudflare از طریق GitHub

## چه چیزی تغییر کرده؟
- مسیر `POST /api/maps/custom/save` اکنون در Worker پیاده‌سازی شده و دیگر به Express/Node یا `child_process` وابسته نیست.
- فایل‌های اصلی JSON و BIN بدون تبدیل در Cloudflare R2 نگه‌داری می‌شوند.
- متادیتا و نقاط روی Durable Object ذخیره می‌شوند و بعد از deploy مجدد باقی می‌مانند.
- فایل JSON اصلی از مسیر `/custom-maps/...` سرو می‌شود؛ موتور 3D همان JSON و BIN اصلی را می‌خواند.

## مرحله ۱ — ساخت R2 bucket
1. در Cloudflare Dashboard برو به **R2 Object Storage**.
2. یک bucket با نام دقیق `cs-dust-online-map-assets` بساز.
3. اگر اسم دیگری انتخاب کردی، مقدار `bucket_name` در `wrangler.toml` را هم عوض کن.

## مرحله ۲ — تنظیم GitHub/Workers
1. commit و push فایل‌های این پروژه به repository متصل‌شده بزن.
2. در Workers & Pages، پروژه `cs-dust-online` را باز کن و مطمئن شو build/deploy از همین repository و branch انجام می‌شود.
3. در بخش Settings > Bindings بررسی کن R2 binding با نام `MAP_ASSETS` وجود داشته باشد؛ با `wrangler.toml` معمولاً از تنظیمات پروژه می‌آید.
4. `GAME` Durable Object binding و migration موجود در `wrangler.toml` را حذف نکن.
5. اگر از Dashboard برای deploy مستقیم استفاده می‌کنی، مطمئن شو پروژه به‌صورت Worker با Wrangler config deploy می‌شود؛ صرفاً آپلود static assets کافی نیست.

## مرحله ۳ — کلید مدیریت
اگر پنل مدیریت از `ADMIN_KEY` استفاده می‌کند، در Settings > Variables and Secrets یک secret با نام `ADMIN_KEY` تنظیم کن. این کلید برای APIهای مدیریتی است؛ endpoint ذخیره مپ فعلاً به آن وابسته نیست.

## مرحله ۴ — تست بعد از deploy
این مسیرها را در مرورگر باز کن:
- `/health` باید JSON با `ok: true` بدهد.
- `/api/maps/health` باید JSON با `ok: true` بدهد.
- `/api/maps/custom` باید JSON برگرداند (در ابتدا ممکن است `{}` باشد).

سپس در `/advanced-map-editor` فایل JSON و BIN اصلی را انتخاب کن و ذخیره را بزن. بعد از موفقیت، صفحه را تازه کن و فهرست مپ‌های بازی را بررسی کن.

## نکته مهم درباره گیم‌پلی
این نسخه فایل اصلی JSON/BIN را برای نمایش سه‌بعدی ذخیره می‌کند و نقاط T Spawn، CT Spawn، A/B و calloutها را در metadata قرار می‌دهد. چون مبدل فعلی `packedmap2game.cjs` به Node.js و `child_process` وابسته است و داخل Worker اجرا نمی‌شود، برخوردها/مسیر حرکت فعلاً از grid پیش‌فرض Dust II به‌عنوان fallback استفاده می‌کنند. یعنی نمایش مدل اصلی ممکن است، اما برای collision دقیقِ هر مپ جدید باید بعداً مبدل هندسه به grid به نسخه سازگار با Workers تبدیل شود.

## محدودیت حجم
Cloudflare Worker body-size limits بسته به پلن فرق می‌کند. فایل‌های حدود 64MB به‌علاوه JSON معمولاً در محدودیت 100MB پلن‌های Free/Pro جا می‌شوند، اما اگر حجم کل از حد پلن بگذرد، آپلود توسط Cloudflare رد می‌شود.
