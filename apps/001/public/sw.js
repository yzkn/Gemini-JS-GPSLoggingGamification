const CACHE_NAME = 'rta-app-v2';
const TILE_CACHE_NAME = 'gsi-map-tiles';

// アプリ本体の静的ファイル
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './src/main.js',
    './src/logic.js',
    'https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.css',
    'https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.js',
    'https://unpkg.com/geographiclib@1.52.0/geographiclib.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME && key !== TILE_CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 地理院タイルのリクエスト判定
    if (url.hostname === 'cyberjapandata.gsi.go.jp') {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((response) => {
                    // キャッシュがあればそれを返し、なければネットワークから取得してキャッシュに保存
                    return response || fetch(event.request).then((networkResponse) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                });
            })
        );
    } else {
        // それ以外のリソース（Stale-While-Revalidate戦略）
        event.respondWith(
            caches.match(event.request).then((response) => {
                const fetchPromise = fetch(event.request).then((networkResponse) => {
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                    });
                    return networkResponse;
                });
                return response || fetchPromise;
            })
        );
    }
});