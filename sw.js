/* 进销存管理系统 Service Worker：缓存静态资源，支持离线/添加到主屏幕
   注意：业务页面(js/pages/*)与体积较大的 echarts/xlsx 改为按需加载，
   不在此处预拉取（否则安装时会一次性下载，抵消懒加载收益）；
   它们会在首次被请求时由 fetch 处理器自动缓存。 */
const CACHE = 'jxc-v4';
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.json',
  './icon-192.png', './icon-512.png',
  './vendor/vue.global.prod.js', './vendor/supabase.js',
  './js/utils.js', './js/config.js', './js/cloud.js', './js/perm.js', './js/sync.js',
  './js/store.js', './js/demo-data.js', './js/components.js', './js/app.js',
  './js/compute-core.js'
];

self.addEventListener('install', e => {
  // 逐个容错安装：任一资源 404/失败都不影响其他资源与整体激活，
  // 避免此前因 icon.svg 被删除导致 addAll 整体 reject、jxc-v4 永远装不上的问题。
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
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

  /* 网络优先策略：每次都向服务器取最新资源，本地缓存仅作无网兜底。
     这样后续所有 CSS/JS 改动都会在用户手机自动生效，无需清缓存或加版本号。 */
  e.respondWith(
    fetch(req)
      .then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(req))
  );
});
