/**
 * sw.js
 * PWA用サービスワーカー：アセットと地理院タイルのキャッシュ管理
 */

const CACHE_NAME = 'highway-rta-v1';
const TILE_CACHE_NAME = 'gsi-tiles-v1';

// プリキャッシュする静的アセット
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/src/main.js',
    '/manifest.json',
    // ビルド後のJS/CSSはビルドツールによって自動生成されるため、
    // 実際にはWorkbox等のプラグインを使うか、手動でパスを指定します。
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 国土地理院タイルのリクエストかどうかを判定
    if (url.hostname === 'cyberjapandata.gsi.go.jp') {
        event.respondWith(handleTileRequest(event.request));
    } else {
        // 通常のアセットは Network-First または Stale-While-Revalidate
        event.respondWith(
            caches.match(event.request).then((response) => {
                return response || fetch(event.request);
            })
        );
    }
});

/**
 * 地図タイルのキャッシュ戦略: Cache-First
 * オフラインでの走行を支えるため、一度取得したタイルはキャッシュから返す
 */
async function handleTileRequest(request) {
    const cache = await caches.open(TILE_CACHE_NAME);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
        return cachedResponse;
    }

    try {
        const networkResponse = await fetch(request);
        // レスポンスが正常な場合のみキャッシュに保存
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        // ネットワークエラーかつキャッシュもない場合
        return new Response('Offline tile not available', { status: 404 });
    }
}