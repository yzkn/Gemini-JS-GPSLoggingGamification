/**
 * main.js
 * アプリケーションのエントリーポイント。各モジュールの統合とUI制御。
 */
import { HighwayStorage } from './storage.js';
import { GpsManager } from './gps.js';
import { MapManager } from './map.js';

// ルート定義データ (実際には外部JSONからfetchも可)
const ROUTES = [
  {
    id: "kan-etsu-down",
    routeName: "関越川越（下り）",
    checkpoints: [
      { name: "川越IC", latitude: 35.893205, longitude: 139.459547 },
      { name: "三芳PA", latitude: 35.844391, longitude: 139.503090 },
      { name: "所沢IC", latitude: 35.809777, longitude: 139.529614 }
    ]
  },
  {
    "id": "kan-etsu-up",
    "routeName": "関越川越（上り）",
    "checkpoints": [
      { name: "所沢IC", latitude: 35.807816, longitude: 139.530606 },
      { name: "三芳PA", latitude: 35.839042, longitude: 139.503693 },
      { name: "川越IC", latitude: 35.892501, longitude: 139.459501 }
    ]
  }
];

class App {
  constructor() {
    this.storage = new HighwayStorage();
    this.mapManager = new MapManager('map');
    this.gpsManager = null;
    this.wakeLock = null;
    this.currentSessionId = null;

    this.init();
  }

  async init() {
    await this.storage.init();
    this.setupRouteSelect();
    this.bindEvents();
    this.setupServiceWorker();
  }

  setupRouteSelect() {
    const select = document.getElementById('route-select');
    ROUTES.forEach(route => {
      const opt = document.createElement('option');
      opt.value = route.id;
      opt.textContent = route.routeName;
      select.appendChild(opt);
    });
  }

  bindEvents() {
    // 同意して開始ボタン
    document.getElementById('btn-agree-start').addEventListener('click', () => this.startApp());

    // 終了ボタン
    document.getElementById('btn-stop').addEventListener('click', () => this.stopApp());

    // 画面復帰時のWake Lock再取得用
    document.addEventListener('visibilitychange', () => {
      if (this.wakeLock !== null && document.visibilityState === 'visible') {
        this.requestWakeLock();
      }
    });
  }

  /**
   * アプリ開始処理（ユーザー操作がトリガー）
   */
  async startApp() {
    try {
      // 1. スリープ防止
      await this.requestWakeLock();

      // 2. セッション作成
      const routeId = document.getElementById('route-select').value;
      const route = ROUTES.find(r => r.id === routeId);
      this.currentSessionId = await this.storage.startSession(routeId);

      // 3. GPS開始
      this.gpsManager = new GpsManager(this.storage, route, {
        onPositionUpdate: (pos) => this.updateUI(pos),
        onCPPass: (cpResult) => this.handleCPPass(cpResult)
      });
      await this.gpsManager.start(this.currentSessionId);

      // 4. UI切り替え
      document.getElementById('start-modal').classList.add('hidden');
      document.getElementById('btn-start').classList.add('hidden');
      document.getElementById('btn-stop').classList.remove('hidden');

      this.speak(`${route.routeName}の計測を開始します。安全運転を心がけてください。`);
    } catch (err) {
      alert(`エラーが発生しました: ${err.message}`);
    }
  }

  /**
   * リアルタイムUI更新
   */
  updateUI(position) {
    const { latitude, longitude, speed } = position.coords;
    this.mapManager.updateCurrentLocation(latitude, longitude);

    const kmh = speed ? Math.round(speed * 3.6) : 0;
    document.getElementById('current-speed').textContent = kmh;

    if (this.gpsManager) {
      const cpIndex = this.gpsManager.targetCPIndex;
      const totalCP = this.gpsManager.route.checkpoints.length;
      const target = this.gpsManager.route.checkpoints[cpIndex];

      if (target) {
        const distM = this.gpsManager.calculateDistance(latitude, longitude, target.latitude, target.longitude);
        document.getElementById('next-cp-name').textContent = target.name;
        document.getElementById('next-cp-dist').textContent = (distM / 1000).toFixed(2);
        document.getElementById('target-index').textContent = `CP ${cpIndex + 1}/${totalCP}`;
      }
    }
  }

  handleCPPass(cpResult) {
    // 通過情報を左下に表示
    const lastInfo = document.getElementById('last-cp-info');
    lastInfo.classList.remove('hidden');
    document.getElementById('last-cp-name').textContent = cpResult.name;

    // ミリ秒を MM:SS.s 形式に変換
    const ms = cpResult.splitTime;
    const m = Math.floor(ms / 60000);
    const s = ((ms % 60000) / 1000).toFixed(1);
    document.getElementById('last-cp-time').textContent = `${m}:${s.padStart(4, '0')}`;

    this.speak(`${cpResult.name}を通過しました。`);
    if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
  }

  /**
   * 音声合成
   */
  speak(text) {
    if (!window.speechSynthesis) return;
    const uttr = new SpeechSynthesisUtterance(text);
    uttr.lang = 'ja-JP';
    uttr.rate = 1.2; // 少し早めに
    window.speechSynthesis.speak(uttr);
  }

  /**
   * スリープ防止 (Wake Lock API)
   */
  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock is active');
      } catch (err) {
        console.error(`${err.name}, ${err.message}`);
      }
    }
  }

  /**
   * 計測終了
   */
  async stopApp() {
    if (this.gpsManager) this.gpsManager.stop();
    if (this.currentSessionId) await this.storage.endSession(this.currentSessionId);
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
    location.reload(); // 簡易的に初期状態へ
  }

  setupServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    }
  }
}

// アプリ起動
window.addEventListener('DOMContentLoaded', () => {
  new App();
});