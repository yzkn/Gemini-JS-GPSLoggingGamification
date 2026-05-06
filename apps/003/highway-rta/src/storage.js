/**
 * storage.js
 * IndexedDBの初期化およびGPS生ログ・ラップタイムの保存・管理を担当
 */

export class GPStorage {
  constructor() {
    this.dbName = "HighwayRTADB";
    this.dbVersion = 1;
    this.db = null;
    this.currentSessionId = null;
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
        if (!db.objectStoreNames.contains("sessions")) {
          db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
        }

        // GPS生ログ用（sessionIdでインデックスを貼る）
        if (!db.objectStoreNames.contains("gps_logs")) {
          const gpsStore = db.createObjectStore("gps_logs", { keyPath: "id", autoIncrement: true });
          gpsStore.createIndex("sessionId", "sessionId", { unique: false });
        }

        // ラップ記録用
        if (!db.objectStoreNames.contains("lap_logs")) {
          const lapStore = db.createObjectStore("lap_logs", { keyPath: "id", autoIncrement: true });
          lapStore.createIndex("sessionId", "sessionId", { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(`IndexedDB Error: ${event.target.errorCode}`);
      };
    });
  }

  /**
   * 新しい計測セッションを開始
   * @param {string} routeName - ルート名（例: "関越川越（下り）"）
   */
  async startSession(routeName) {
    const session = {
      routeName,
      startTime: Date.now(),
      endTime: null,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["sessions"], "readwrite");
      const store = transaction.objectStore("sessions");
      const request = store.add(session);

      request.onsuccess = () => {
        this.currentSessionId = request.result;
        resolve(this.currentSessionId);
      };
      request.onerror = () => reject("Failed to start session");
    });
  }

  /**
   * GPSの生ログを保存
   * @param {GeolocationCoordinates} coords - Web APIのcoordsオブジェクト
   */
  async saveGPSLog(coords) {
    if (!this.currentSessionId) return;

    const logEntry = {
      sessionId: this.currentSessionId,
      timestamp: Date.now(),
      latitude: coords.latitude,
      longitude: coords.longitude,
      speed: coords.speed, // m/s
      accuracy: coords.accuracy,
      altitude: coords.altitude,
    };

    return this._addData("gps_logs", logEntry);
  }

  /**
   * CP通過ログを保存
   * @param {Object} lapData - { cpName, lapTime, splitTime }
   */
  async saveLapLog(lapData) {
    if (!this.currentSessionId) return;

    const lapEntry = {
      sessionId: this.currentSessionId,
      timestamp: Date.now(),
      ...lapData,
    };

    return this._addData("lap_logs", lapEntry);
  }

  /**
   * セッションを終了
   */
  async endSession() {
    if (!this.currentSessionId) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["sessions"], "readwrite");
      const store = transaction.objectStore("sessions");
      const request = store.get(this.currentSessionId);

      request.onsuccess = () => {
        const data = request.result;
        data.endTime = Date.now();
        store.put(data);
        this.currentSessionId = null;
        resolve();
      };
      request.onerror = () => reject("Failed to end session");
    });
  }

  /**
   * エクスポート用：特定セッションの全データを取得
   * @param {number} sessionId
   */
  async getSessionFullData(sessionId) {
    const logs = await this._getAllByIndex("gps_logs", "sessionId", sessionId);
    const laps = await this._getAllByIndex("lap_logs", "sessionId", sessionId);
    return { logs, laps };
  }

  // --- 内部ヘルパーメソッド ---

  _addData(storeName, data) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.add(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(`Error adding to ${storeName}`);
    });
  }

  _getAllByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(`Error fetching from ${storeName}`);
    });
  }

  // storage.js の GPStorage クラス内に追加
  async getAllSessions() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["sessions"], "readonly");
      const store = transaction.objectStore("sessions");
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject("Failed to get sessions");
    });
  }

  async deleteSession(sessionId) {
    const transaction = this.db.transaction(["sessions", "gps_logs", "lap_logs"], "readwrite");
    transaction.objectStore("sessions").delete(sessionId);
    // 関連するログも削除（実際はindexを使って削除するのが望ましい）
    resolve();
  }
}