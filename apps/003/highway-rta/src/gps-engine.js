/**
 * gps-engine.js
 * GPSの取得、フィルタリング、CP判定ロジックを担当
 */
import { GPStorage } from './storage.js';

// // geographiclib の読み込み（npm経由を想定）
// // import { Geodesic } from 'geographiclib';
// // ブラウザ向けにCDN等で読み込む場合は window.Geodesic を使用
// const geod = window.Geodesic ? window.Geodesic.WGS84 : null;
import { Geodesic } from 'geographiclib'; // npm経由なのでこれだけでOK
const geod = Geodesic.WGS84;

export class GPSEngine {
  constructor(cpList) {
    this.storage = new GPStorage();
    this.cpList = cpList; // 現在のルートのCP配列
    this.currentCPIndex = 0;
    this.watchId = null;
    this.lastPosition = null;

    // 状態管理
    this.isTracking = false;
    this.minDistanceToCP = Infinity;
    this.bestPassTime = null;
    this.inCPRange = false; // 50m圏内フラグ

    // 移動平均用（直近3点）
    this.positionHistory = [];

    // コールバック（UI更新用）
    this.onUpdate = null;
    this.onCPPass = null;
  }

  async start(routeName) {
    await this.storage.init();
    await this.storage.startSession(routeName);
    this.isTracking = true;
    this.currentCPIndex = 0;

    if (!("geolocation" in navigator)) {
      throw new Error("GPSが利用できません");
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos),
      (err) => console.error(err),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000,
      }
    );
  }

  stop() {
    if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
    this.storage.endSession();
    this.isTracking = false;
  }

  /**
   * 測位データのメイン処理
   */
  async handlePosition(position) {
    if (!this.isTracking) return;

    const { latitude, longitude, speed, accuracy } = position.coords;
    const timestamp = position.timestamp;

    // 1. フィルタリング
    if (!this.isValidPosition(latitude, longitude, speed, accuracy, timestamp)) {
      return;
    }

    // 2. 生データの保存
    await this.storage.saveGPSLog(position.coords);

    // 3. 移動平均の計算（地図プロット用）
    this.positionHistory.push({ latitude, longitude });
    if (this.positionHistory.length > 3) this.positionHistory.shift();
    const smoothedPos = this.getMovingAverage();

    // 4. チェックポイント判定
    this.checkCPProximity(latitude, longitude, timestamp);

    // 5. UI更新通知
    if (this.onUpdate) {
      const nextCP = this.cpList[this.currentCPIndex];
      const distToNext = nextCP ? this.calculateDistance(latitude, longitude, nextCP.latitude, nextCP.longitude) : 0;

      this.onUpdate({
        coords: position.coords,
        smoothedPos,
        nextCP,
        distToNext,
        currentCPIndex: this.currentCPIndex
      });
    }

    this.lastPosition = { latitude, longitude, timestamp };
  }

  /**
   * バリデーション: 精度100m以内、かつ時速180km以内か
   */
  isValidPosition(lat, lon, speed, accuracy, timestamp) {
    if (accuracy > 100) return false;

    if (this.lastPosition) {
      const dist = this.calculateDistance(this.lastPosition.latitude, this.lastPosition.longitude, lat, lon);
      const timeDiff = (timestamp - this.lastPosition.timestamp) / 1000; // 秒
      if (timeDiff > 0) {
        const calcSpeedKmH = (dist / timeDiff) * 3.6;
        if (calcSpeedKmH > 180) return false;
      }

      // 5秒間隔 または 5m以上の移動制限（要件）
      if (timeDiff < 5 && dist < 5) return false;
    }

    return true;
  }

  /**
   * チェックポイント判定ロジック
   */
  checkCPProximity(lat, lon, timestamp) {
    const targetCP = this.cpList[this.currentCPIndex];
    if (!targetCP) return;

    const dist = this.calculateDistance(lat, lon, targetCP.latitude, targetCP.longitude);

    // 50m以内に入った場合、最短距離地点を記録開始
    if (dist < 50) {
      this.inCPRange = true;
      if (dist < this.minDistanceToCP) {
        this.minDistanceToCP = dist;
        this.bestPassTime = timestamp;
      }
    }
    // 50m圏外に出た、かつ圏内にいた場合
    else if (this.inCPRange) {
      // 離れ始めた瞬間に確定（または1km圏内での更新ルール）
      if (dist > this.minDistanceToCP + 10) { // 10m以上離れたら一旦「通過」とみなす
        this.confirmCPPass(targetCP.name);
        this.inCPRange = false;
      }
    }

    // 補正ルール: 1km以内であれば、より短い距離が観測された場合に上書き（GPS揺らぎ対策）
    if (dist < 1000 && dist < this.minDistanceToCP) {
      this.minDistanceToCP = dist;
      this.bestPassTime = timestamp;
    }

    // 1kmを超えたら次のCPへ（またはトンネル補完ロジックへ）
    if (dist > 1000 && this.minDistanceToCP !== Infinity) {
      if (this.inCPRange || this.bestPassTime) {
        this.currentCPIndex++;
        this.minDistanceToCP = Infinity;
        this.bestPassTime = null;
      }
    }
  }

  /**
   * CP通過確定処理
   */
  async confirmCPPass(cpName) {
    const lapData = {
      cpName: cpName,
      passTime: this.bestPassTime,
      // ラップタイム計算などはUI側またはstorage側で行う
    };
    await this.storage.saveLapLog(lapData);

    if (this.onCPPass) {
      this.onCPPass(lapData);
    }
  }

  /**
   * 2点間の距離計算 (geographiclib 使用)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    if (geod) {
      const r = geod.Inverse(lat1, lon1, lat2, lon2);
      return r.s12; // 距離(m)
    }
    // フォールバック: ハバサイン公式（簡易計算）
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * 直近3点の移動平均を取得
   */
  getMovingAverage() {
    if (this.positionHistory.length === 0) return null;
    const sum = this.positionHistory.reduce((acc, curr) => ({
      latitude: acc.latitude + curr.latitude,
      longitude: acc.longitude + curr.longitude
    }), { latitude: 0, longitude: 0 });

    return {
      latitude: sum.latitude / this.positionHistory.length,
      longitude: sum.longitude / this.positionHistory.length
    };
  }
}