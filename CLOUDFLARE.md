# اجرای Counter-Strike روی GitHub + Cloudflare

این نسخه برای **Cloudflare Workers + Durable Objects + Assets** آماده شده است.
GitHub فقط محل نگهداری کد است؛ خود بازی از دامنه Cloudflare اجرا می‌شود.

## ساختار

- `public/` رابط بازی، Three.js و فایل‌های استاتیک
- `shared/` منطق مشترک بازی
- `worker.js` سرور WebSocket و Durable Object
- `wrangler.toml` تنظیمات Cloudflare
- `/ws` کانال WebSocket چندنفره
- `/admin` پنل مدیریت

## انتشار مستقیم از GitHub

در Cloudflare Dashboard:

1. Workers & Pages → Create → Workers
2. گزینهٔ اتصال به Git repository را انتخاب کن و ریپوی GitHub را وصل کن.
3. اگر Cloudflare از شما Build command خواست:
   - Build command: `npx wrangler deploy`
   - Root directory: `/`
4. در تنظیمات پروژه، یک Secret با نام `ADMIN_KEY` بساز.
5. Deploy را بزن.

> برای روش CLI می‌توانی از `npm install`، سپس `npx wrangler login` و `npm run deploy` استفاده کنی.

## Secret ادمین

کلید پنل `/admin` باید فقط به عنوان Secret در Cloudflare ذخیره شود:

```bash
npx wrangler secret put ADMIN_KEY
```

بعد بازی را روی:

```text
https://YOUR-WORKER-DOMAIN/
```

باز کن و پنل را در:

```text
https://YOUR-WORKER-DOMAIN/admin
```

ببین.

## نکتهٔ معماری

نسخهٔ اصلی پروژه با Node.js و Socket.IO بود. Cloudflare Worker نمی‌تواند یک Socket.IO/Express server معمولی را مثل Node اجرا کند؛ بنابراین این نسخه:

- Socket.IO کلاینت را با WebSocket استاندارد جایگزین می‌کند.
- منطق `ServerCore` را بدون وابستگی Node قابل اجرا می‌کند.
- همهٔ روم‌های آنلاین را داخل یک Durable Object نگه می‌دارد.
- اطلاعات سرورها، پروفایل، بن و تنظیمات را در Durable Object Storage ذخیره می‌کند.
- فایل‌های بازی را از Cloudflare Assets سرو می‌کند.

## توسعهٔ محلی

```bash
npm install
npm run dev
```

برای اجرای نسخهٔ قدیمی Node هم:

```bash
npm start
```

`server.js` نسخهٔ Node اصلی پروژه است و برای اجرای محلی/سرورهای سنتی نگه داشته شده است.

## ذخیره‌سازی و مپ‌های ادیتور (v8)

- لیست سرورها، بن‌ها، پروفایل‌ها و تنظیمات در Durable Object Storage به‌صورت جدا (`d:servers`، `d:profiles`، …) ذخیره می‌شود و فقط بخشی که تغییر کرده نوشته می‌شود.
- ساخت/حذف/روشن/خاموش کردن سرور و تغییرات مهم، **قبل از جواب دادن به پنل** روی دیسک نوشته می‌شود؛ پس ریست ورکر چیزی را از بین نمی‌برد.
- مپ‌هایی که در ادیتور ذخیره می‌کنی هنگام بوت، **قبل از راه‌اندازی روم‌ها** ثبت می‌شوند؛ سرور روی مپ سفارشی بعد از ریست همان مپ را برمی‌گرداند. کلاینت هم مپ‌های سفارشی را از `/api/maps/custom` می‌گیرد.
- بعد از تغییر فایل‌های `shared/` دستور `npm run sync` را بزن تا نسخهٔ `public/shared/` هم هم‌گام شود.
