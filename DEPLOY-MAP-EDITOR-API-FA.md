# رفع خطای 404 در API ادیتور مپ

این نسخه دو endpoint تشخیصی/ورود را مستقیماً در Worker پاسخ می‌دهد:

- `GET /api/maps/health` باید JSON شامل `"route":"worker-api"` برگرداند.
- `POST /api/maps/auth` باید JSON برگرداند: برای کلید درست `200` و برای کلید اشتباه `401`؛ پاسخ `404 Not found` یعنی این Worker روی مسیر سایت فعال نیست یا نسخه‌ی جدید Deploy نشده.

## استقرار صحیح

از پوشه‌ای که `wrangler.toml` و `worker.js` در آن قرار دارند اجرا کن:

```bash
npx wrangler login
npx wrangler deploy
```

در Cloudflare Workers > Settings > Variables، متغیر `ADMIN_KEY` را به‌صورت Secret تنظیم کن و سپس دوباره Deploy کن. مقدار کلید را در کد یا فایل عمومی قرار نده.

پس از استقرار، این آدرس را در مرورگر باز کن:

`https://YOUR-DOMAIN/api/maps/health`

اگر به‌جای JSON همچنان `Not found` دیدی، دامنه به Worker دیگری متصل است یا سایت از Cloudflare Pages/static hosting جداگانه سرو می‌شود. در آن حالت باید Custom Domain/Route دامنه را به همین Worker متصل کنی؛ صرف آپلود فایل‌های `public` کافی نیست.
