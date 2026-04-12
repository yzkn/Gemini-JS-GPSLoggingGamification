/**
 * storage.js
 * IndexedDBの初期化およびGPSログ・セッションデータの永続化を担当するクラス

IndexedDB 設計
以下の3つのオブジェクトストア（テーブル相当）で構成します。
    sessions:
        計測セッションごとのメタデータ（開始時刻、終了時刻、選択されたルートIDなど）を保存します。
        キー: id (自動増分)
    gps_logs:
        生のGPSデータ（緯度、経度、速度、精度、高度など）を保存します。
        キー: id (自動増分)
        インデックス: sessionId（セッションごとの抽出用）
    cp_results:
        チェックポイント（CP）の通過記録（通過時刻、ラップタイム、スプリットタイムなど）を保存します。
        キー: id (自動増分)
        インデックス: sessionId（セッションごとの抽出用）

 */

export class HighwayStorage {
    constructor() {
        this.dbName = 'HighwayRTADB';
        this.dbVersion = 1;
        this.db = null;
    }

    /**
     * データベースの初期化
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // セッション管理用
                if (!db.objectStoreNames.contains('sessions')) {
                    db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
                }

                // GPS生ログ保存用
                if (!db.objectStoreNames.contains('gps_logs')) {
                    const logStore = db.createObjectStore('gps_logs', { keyPath: 'id', autoIncrement: true });
                    logStore.createIndex('sessionId', 'sessionId', { unique: false });
                }

                // CP通過記録用
                if (!db.objectStoreNames.contains('cp_results')) {
                    const cpStore = db.createObjectStore('cp_results', { keyPath: 'id', autoIncrement: true });
                    cpStore.createIndex('sessionId', 'sessionId', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * 新しい計測セッションを開始する
     * @param {string} routeId - 走行ルートのID
     * @returns {Promise<number>} sessionId
     */
    async startSession(routeId) {
        const session = {
            routeId,
            startTime: new Date().getTime(),
            endTime: null,
            status: 'active'
        };
        return this._add('sessions', session);
    }

    /**
     * セッションを終了する
     * @param {number} sessionId
     */
    async endSession(sessionId) {
        const session = await this._get('sessions', sessionId);
        if (session) {
            session.endTime = new Date().getTime();
            session.status = 'completed';
            return this._put('sessions', session);
        }
    }

    /**
     * 生のGPSログを保存する
     * @param {number} sessionId - セッションID
     * @param {GeolocationPosition} position - Geolocation APIから取得したpositionオブジェクト
     */
    async saveGpsLog(sessionId, position) {
        const logEntry = {
            sessionId,
            timestamp: position.timestamp,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            speed: position.coords.speed, // m/s
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            heading: position.coords.heading
        };
        return this._add('gps_logs', logEntry);
    }

    /**
     * CP通過情報を保存する
     * @param {number} sessionId
     * @param {Object} cpData - CP名、通過時刻、ラップ等
     */
    async saveCPResult(sessionId, cpData) {
        const result = {
            sessionId,
            ...cpData, // name, timestamp, lapTime, splitTime 等を含む
            createdAt: new Date().getTime()
        };
        return this._add('cp_results', result);
    }

    /**
     * 特定セッションの全ログを取得（CSV/GeoJSON出力用）
     * @param {number} sessionId
     */
    async getLogsBySession(sessionId) {
        return this._getAllByIndex('gps_logs', 'sessionId', sessionId);
    }

    /**
     * 全セッション履歴を取得（設定画面用）
     */
    async getAllSessions() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['sessions'], 'readonly');
            const store = transaction.objectStore('sessions');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * セッションおよび関連する全データの削除
     * @param {number} sessionId
     */
    async deleteSession(sessionId) {
        // 簡易化のため直列に実行
        await this._deleteByIndex('gps_logs', 'sessionId', sessionId);
        await this._deleteByIndex('cp_results', 'sessionId', sessionId);
        return this._delete('sessions', sessionId);
    }

    // --- 内部ヘルパーメソッド ---

    _add(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _put(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _get(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _getAllByIndex(storeName, indexName, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(IDBKeyRange.only(value));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _delete(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async _deleteByIndex(storeName, indexName, value) {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const index = store.index(indexName);
        const request = index.openKeyCursor(IDBKeyRange.only(value));

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
}