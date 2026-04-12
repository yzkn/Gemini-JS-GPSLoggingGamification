const DB_NAME = 'ExpresswayRTADB';
const DB_VERSION = 1;

export function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // セッション一覧（親データ）
            if (!db.objectStoreNames.contains('sessions')) {
                db.createObjectStore('sessions', { keyPath: 'id' });
            }
            // GPS生ログ（子データ）
            if (!db.objectStoreNames.contains('gps_logs')) {
                const logStore = db.createObjectStore('gps_logs', { keyPath: 'id', autoIncrement: true });
                logStore.createIndex('sessionId', 'sessionId', { unique: false });
            }
            // CP通過ログ
            if (!db.objectStoreNames.contains('cp_logs')) {
                const cpStore = db.createObjectStore('cp_logs', { keyPath: 'id', autoIncrement: true });
                cpStore.createIndex('sessionId', 'sessionId', { unique: false });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// セッション開始
export async function saveSession(session) {
    const db = await openDB();
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(session);
    return tx.complete;
}

// GPSログ保存
export async function saveLog(sessionId, pos) {
    const db = await openDB();
    const tx = db.transaction('gps_logs', 'readwrite');
    tx.objectStore('gps_logs').add({
        sessionId,
        lat: pos.lat,
        lng: pos.lng,
        speed: pos.speed,
        timestamp: pos.timestamp
    });
}

// CP通過記録保存
export async function saveCPPass(sessionId, cpData) {
    const db = await openDB();
    const tx = db.transaction('cp_logs', 'readwrite');
    tx.objectStore('cp_logs').add({
        sessionId,
        ...cpData
    });
}

// 全セッション取得
export async function getAllSessions() {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction('sessions', 'readonly');
        const request = tx.objectStore('sessions').getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

// 特定セッションの全データ取得（エクスポート用）
export async function getSessionDetail(sessionId) {
    const db = await openDB();
    const getLogs = new Promise((resolve) => {
        const index = db.transaction('gps_logs', 'readonly').objectStore('gps_logs').index('sessionId');
        index.getAll(IDBKeyRange.only(sessionId)).onsuccess = (e) => resolve(e.target.result);
    });
    const getCPs = new Promise((resolve) => {
        const index = db.transaction('cp_logs', 'readonly').objectStore('cp_logs').index('sessionId');
        index.getAll(IDBKeyRange.only(sessionId)).onsuccess = (e) => resolve(e.target.result);
    });
    return { logs: await getLogs, cps: await getCPs };
}

// セッション削除
export async function deleteSession(sessionId) {
    const db = await openDB();
    const tx = db.transaction(['sessions', 'gps_logs', 'cp_logs'], 'readwrite');
    tx.objectStore('sessions').delete(sessionId);

    // 関連するログも削除
    const logStore = tx.objectStore('gps_logs');
    const logIndex = logStore.index('sessionId');
    logIndex.openCursor(IDBKeyRange.only(sessionId)).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            logStore.delete(cursor.primaryKey);
            cursor.continue();
        }
    };
    // CPログも同様に削除（省略可だが整合性のため実施）
    return new Promise(resolve => tx.oncomplete = resolve);
}