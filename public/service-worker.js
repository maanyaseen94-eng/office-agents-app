// service-worker.js — تخزين مؤقت بسيط لتفعيل التثبيت على الشاشة الرئيسية والعمل دون اتصال جزئياً
//
// ملاحظة مهمة: كانت النسخة السابقة تعتمد استراتيجية "الكاش أولاً" (Cache First)
// مما تسبب بمشكلة حقيقية — المستخدمون ظلّوا يرون نسخة قديمة من app.js حتى بعد
// نشر تحديثات جديدة فعلياً على الخادم، لأن اسم الكاش لم يتغيّر فيُعاد استخدامه
// بدل تحديثه. الآن الاستراتيجية "الشبكة أولاً" (Network First): يُجلب أحدث نسخة
// من الخادم دائماً عند توفر اتصال، ولا يُستخدم الكاش إلا عند انقطاع الاتصال.
const CACHE_NAME = 'office-agents-cache-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // لا تخزّن طلبات API مؤقتاً — يجب أن تبقى حية دائماً
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
