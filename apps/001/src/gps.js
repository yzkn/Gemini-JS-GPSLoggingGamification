import { Geodesic } from 'geographiclib-geodesic';
const geod = Geodesic.WGS84;

export class RTAManager {
    constructor(route) {
        this.route = route;
        this.checkpoints = route.checkpoints;
        this.nextCPIndex = 0;
        this.lastPos = null;
        this.isRecording = false;
        this.isPaused = false;
        this.minDistToCP = Infinity;
        this.passedCPs = []; // {name, time, isInterpolated}
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const r = geod.Inverse(lat1, lon1, lat2, lon2);
        return r.s12; // 距離(m)
    }

    processLocation(pos) {
        const { latitude, longitude, speed, accuracy } = pos.coords;
        const timestamp = pos.timestamp;

        // 外れ値判定
        if (accuracy > 100) return null;
        if (this.lastPos) {
            const d = this.calculateDistance(this.lastPos.lat, this.lastPos.lng, latitude, longitude);
            const dt = (timestamp - this.lastPos.timestamp) / 1000;
            if (dt > 0 && (d / dt) * 3.6 > 180) return null;
        }

        const currentPos = { lat: latitude, lng: longitude, speed: speed || 0, timestamp };

        if (this.isRecording && !this.isPaused) {
            this.checkPassing(currentPos);
        }

        this.lastPos = currentPos;
        return currentPos;
    }

    checkPassing(pos) {
        if (this.nextCPIndex >= this.checkpoints.length) return;

        const targetCP = this.checkpoints[this.nextCPIndex];
        const dist = this.calculateDistance(pos.lat, pos.lng, targetCP.lat, targetCP.lng);

        // トンネル判定（大きく飛んだ場合）
        if (this.lastPos && dist < 5000) { // 5km以内の場合のみ通常判定
            if (dist < 50) {
                if (dist < this.minDistToCP) {
                    this.minDistToCP = dist;
                    this.tempBestTime = pos.timestamp;
                }
            }

            // 通過確定ロジック：50m以内に入った後、離れ始めた瞬間
            if (this.minDistToCP < 50 && dist > this.minDistToCP) {
                this.finalizeCP(targetCP, this.tempBestTime);
            }
        } else if (this.lastPos) {
            // トンネル補完：前回と今回の間にCPがあれば等間隔で割る
            // 簡易実装：距離比ではなく単純時間分割
            this.finalizeCP(targetCP, (this.lastPos.timestamp + pos.timestamp) / 2, true);
        }
    }

    finalizeCP(cp, time, isInterpolated = false) {
        this.passedCPs.push({ ...cp, time, isInterpolated });
        this.nextCPIndex++;
        this.minDistToCP = Infinity;

        // 通知
        this.notify(cp.name);
    }

    notify(name) {
        if ('vibrate' in navigator) navigator.vibrate(500);
        const uttr = new SpeechSynthesisUtterance(`${name}を通過しました`);
        speechSynthesis.speak(uttr);
    }
}