/* 进销存管理系统 Service Worker：缓存静态资源，支持离线/添加到主屏幕 */
const CACHE = 'jxc-v1';
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './icon.svg',
  './vendor/vue.global.prod.js', './vendor/echarts.min.js', './vendor/xlsx.full.min.js', './vendor/supabase.js',
  './js/utils.js', './js/config.js', './js/cloud.js', './js/perm.js', './js/sync.js',
  './js/store.js', './js/demo-data.js', './js/components.js', './js/app.js',
  './js/compute-core.js',
  './js/pages/dashboard.js', './js/pages/goods.js', './js/pages/customers.js',
  './js/pages/partners.js', './js/pages/warehouse.js', './js/pages/purchase.js',
  './js/pages/inventory.js', './js/pages/sales.js', './js/pages/finance.js',
  './js/pages/complaint.js', './js/pages/report.js', './js/pages/commission.js',
  './js/pages/members.js', './js/pages/settings.js', './js/pages/opening.js',
  './js/pages/capital.js', './js/pages/report-center.js', './js/pages/recipientmgr.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;            // 只缓存 GET（POST 的 Supabase 写操作放行到网络）
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return fetch(req); // 跨域（Supabase API）不缓存，直接走网络

  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => cached);
    })
  );
});
