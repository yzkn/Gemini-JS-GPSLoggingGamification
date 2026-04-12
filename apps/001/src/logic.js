// GeographicLib の初期化
const geod = GeographicLib.Geodesic.WGS84;

export class RtaEngine {
    constructor(checkpoints) {
        this.checkpoints = checkpoints; // [{name, lat, lon}]
        this.nextCpIndex = 0;
        this.currentSessionId = null;
        this.isPassingTriggered = false;
        this.bestDistanceToCp = Infinity;
        this.lastValidLocation = null;
    }

    // 外れ値判定
    isValidLocation(coords, lastLoc) {
        if (coords.accuracy > 100) return false;
        if (lastLoc) {
            const res = geod.Inverse(lastLoc.lat, lastLoc.lon, coords.latitude, coords.longitude);
            const speedKmh = (res.s12 / ((Date.now() - lastLoc.timestamp) / 1000)) * 3.6;
            if (speedKmh > 180) return false;
        }
        return true;
    }

    // 通過判定ロジック
    processLocation(coords) {
        const targetCp = this.checkpoints[this.nextCpIndex];
        if (!targetCp) return null;

        const res = geod.Inverse(coords.latitude, coords.longitude, targetCp.latitude, targetCp.longitude);
        const dist = res.s12;

        let event = { type: 'update', distance: dist };

        // 判定ロジック: 50m以内に入った後、離れ始めた瞬間
        if (dist < 50) {
            this.isPassingTriggered = true;
            if (dist < this.bestDistanceToCp) {
                this.bestDistanceToCp = dist;
                // 更新条件: 1km以内なら最新の接近情報を記録
                event.isBestUpdate = true;
            }
        } else if (this.isPassingTriggered && dist > this.bestDistanceToCp) {
            // 離れたので通過確定
            event.type = 'checkpoint_passed';
            event.cpName = targetCp.name;
            this.nextCpIndex++;
            this.isPassingTriggered = false;
            this.bestDistanceToCp = Infinity;
        }

        // 1km離れたらリセット（追い越し対応）
        if (dist > 1000 && this.isPassingTriggered) {
            this.isPassingTriggered = false;
            this.bestDistanceToCp = Infinity;
        }

        return event;
    }

    // トンネル補間 (簡易版: 未通過CPを等間隔で割る)
    interpolateTunnels(lostTime, regainedTime, lastLoc, currentLoc, missedCps) {
        const count = missedCps.length;
        return missedCps.map((cp, i) => ({
            name: cp.name,
            timestamp: lostTime + (regainedTime - lostTime) * ((i + 1) / (count + 1))
        }));
    }
}