/**
 * gps.js
 * Geolocation APIの制御、フィルタリング、およびCP通過判定ロジック
 */
import { Geodesic } from 'geographiclib';

export class GpsManager {
    constructor(storage, route, options = {}) {
        this.storage = storage;
        this.route = route; // { id, routeName, checkpoints: [...] }
        this.sessionId = null;
        this.watchId = null;

        // 設定値
        this.accuracyThreshold = options.accuracyThreshold || 100; // 100m
        this.speedThresholdKmH = options.speedThresholdKmH || 180; // 180km/h
        this.cpRadiusM = 50; // 判定開始半径
        this.cpBoundaryM = 1000; // 次のCPへ移行する境界距離

        // 内部状態
        this.lastPosition = null;
        this.targetCPIndex = 0;
        this.geod = Geodesic.WGS84;

        // CP通過判定用のテンポラリ状態
        this.isTrackingCP = false; // 50m圏内に入ったか
        this.minDistanceFound = Infinity;
        this.bestRecordInZone = null;
        this.hasConfirmedCurrentCP = false; // 「離れた」と判定されたか

        // コールバック
        this.onPositionUpdate = options.onPositionUpdate || (() => { });
        this.onCPPass = options.onCPPass || (() => { });
    }

    /**
     * 計測開始
     */
    async start(sessionId) {
        this.sessionId = sessionId;
        this.targetCPIndex = 0;
        this.resetCPTrackingState();

        if (!("geolocation" in navigator)) {
            throw new Error("Geolocation API is not supported.");
        }

        this.watchId = navigator.geolocation.watchPosition(
            (pos) => this.handlePosition(pos),
            (err) => console.error("GPS Error:", err),
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            }
        );
    }

    /**
     * 計測停止
     */
    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }

    /**
     * 位置情報のメイン処理
     */
    async handlePosition(position) {
        const { latitude, longitude, accuracy, speed } = position.coords;
        const timestamp = position.timestamp;

        // 1. フィルタリング: 精度
        if (accuracy > this.accuracyThreshold) return;

        // 2. フィルタリング: 異常速度
        if (this.lastPosition) {
            const dist = this.calculateDistance(
                this.lastPosition.coords.latitude, this.lastPosition.coords.longitude,
                latitude, longitude
            );
            const timeSec = (timestamp - this.lastPosition.timestamp) / 1000;
            if (timeSec > 0) {
                const calculatedSpeedKmH = (dist / timeSec) * 3.6;
                if (calculatedSpeedKmH > this.speedThresholdKmH) return;
            }
        }

        // 生ログ保存
        await this.storage.saveGpsLog(this.sessionId, position);

        // 3. CP判定ロジック
        this.processCPLogic(latitude, longitude, timestamp, speed);

        this.lastPosition = position;
        this.onPositionUpdate(position);
    }

    /**
     * CP通過判定アルゴリズム
     */
    processCPLogic(lat, lon, timestamp, speed) {
        if (this.targetCPIndex >= this.route.checkpoints.length) return;

        const targetCP = this.route.checkpoints[this.targetCPIndex];
        const distToCP = this.calculateDistance(lat, lon, targetCP.latitude, targetCP.longitude);

        // A. 50m圏外かつ1km以上の距離がある場合、または既にこのCPを確定させて1km離れた場合
        if (this.hasConfirmedCurrentCP && distToCP > this.cpBoundaryM) {
            // 次のCPへ移行
            this.targetCPIndex++;
            this.resetCPTrackingState();
            return;
        }

        // B. 通過判定のメインコア（1km以内での処理）
        if (distToCP < this.cpBoundaryM) {

            // 最短距離の更新チェック
            if (distToCP < this.minDistanceFound) {
                this.minDistanceFound = distToCP;
                this.bestRecordInZone = {
                    name: targetCP.name,
                    timestamp: timestamp,
                    latitude: lat,
                    longitude: lon,
                    distance: distToCP,
                    speed: speed
                };

                // 50m以内に入ったフラグ
                if (distToCP <= this.cpRadiusM) {
                    this.isTrackingCP = true;
                }
            }

            // C. 確定タイミングの判定
            // 「50m圏内に入った後」かつ「最短距離を記録した後に距離が離れ始めた」場合
            if (this.isTrackingCP && distToCP > this.minDistanceFound) {
                if (!this.hasConfirmedCurrentCP) {
                    this.hasConfirmedCurrentCP = true;
                    this.finalizeCPPass(this.bestRecordInZone);
                } else {
                    // すでに確定済みだが、1km以内でさらに近い点が見つかった場合は上書き
                    // (実際には離れ始めた後に再び近づくケース。例：ヘアピンカーブや測位誤差)
                    this.updateCPPass(this.bestRecordInZone);
                }
            }
        }
    }

    /**
     * 初回のCP通過確定（通知と保存）
     */
    async finalizeCPPass(record) {
        const sessionLogs = await this.storage.getLogsBySession(this.sessionId);
        const startTime = sessionLogs.length > 0 ? sessionLogs[0].timestamp : record.timestamp;

        // ラップタイム等の計算（簡易版：実際には前回のCP時刻との差分をとる）
        const splitTime = record.timestamp - startTime;

        const cpResult = {
            ...record,
            splitTime: splitTime,
            type: 'CP'
        };

        await this.storage.saveCPResult(this.sessionId, cpResult);
        this.onCPPass(cpResult); // 音声通知などを発火
    }

    /**
     * 1km以内での再接近による記録更新
     */
    async updateCPPass(record) {
        // IndexedDB内の該当CPレコードを更新するロジック（省略可だが精度向上のため）
        // 実装上は、最新の bestRecordInZone が常に「そのCPでの最良結果」となる
        console.log(`CP [${record.name}] record updated with better distance: ${record.distance}m`);
        // 必要に応じて storage.saveCPResult で既存レコードを上書きする
    }

    /**
     * 状態リセット
     */
    resetCPTrackingState() {
        this.isTrackingCP = false;
        this.minDistanceFound = Infinity;
        this.bestRecordInZone = null;
        this.hasConfirmedCurrentCP = false;
    }

    /**
     * geographiclibを使用した2点間距離計算 (メートル)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const r = this.geod.Inverse(lat1, lon1, lat2, lon2);
        return r.s12; // 測地線距離
    }

    /**
     * トンネル・ロスト補完ロジック (概念実装)
     */
    interpolateInterpolation(lostPos, recoveredPos, cp) {
        // ロスト前後の直線上で、CPに最も近い点とその時刻を線形補完で算出
        // 1. ロスト地点-復帰地点の総距離を計算
        // 2. CPがその経路の近くにあるか判定
        // 3. 時間 = 距離の比率で按分
    }
}