import './style.css';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GPSEngine } from './gps-engine.js';
import { exportToCSV, exportToGeoJSON } from './export-util.js';

const CP_DATA = [
    {
        "id": "kan-etsu-down",
        "routeName": "関越川越（下り）",
        "checkpoints": [
            { "name": "川越IC", "latitude": 35.893205, "longitude": 139.459547 },
            { "name": "三芳PA", "latitude": 35.844391, "longitude": 139.503090 },
            { "name": "所沢IC", "latitude": 35.809777, "longitude": 139.529614 }
        ]
    }
];

class App {
    constructor() {
        this.engine = new GPSEngine(CP_DATA[0].checkpoints);
        this.map = null;
        this.wakeLock = null;
        this.initUI();
        this.initMap();
    }

    initMap() {
        this.map = new maplibregl.Map({
            container: 'map',
            style: 'https://tile.openstreetmap.jp/styles/maptiler-basic-ja/style.json', // 仮のスタイル
            center: [139.459, 35.893],
            zoom: 13,
            pitch: 60, // レーシング風に見下ろし角度をつける
            interactive: false // 走行中は操作不能に
        });
    }

    initUI() {
        const btnInit = document.getElementById('btn-init');
        const btnStart = document.getElementById('btn-start');
        const btnStop = document.getElementById('btn-stop');
        const overlay = document.getElementById('overlay-start');

        // 初期化（Wake Lock & 音声権限取得）
        btnInit.onclick = async () => {
            await this.requestWakeLock();
            overlay.classList.add('hidden');
            this.speak("システム起動。準備完了。");
        };

        // 計測開始
        btnStart.onclick = () => {
            this.engine.start(CP_DATA[0].routeName);
            btnStart.classList.add('hidden');
            btnStop.disabled = false;
            btnStop.classList.remove('opacity-50');
            document.getElementById('lap-panel').classList.remove('translate-x-full');
            navigator.vibrate([200, 100, 200]);
        };

        // 長押しでストップ
        let timer;
        btnStop.onmousedown = btnStop.ontouchstart = () => {
            timer = setTimeout(() => {
                this.engine.stop();
                location.reload(); // リセット
            }, 2000);
            btnStop.classList.add('bg-red-600');
        };
        btnStop.onmouseup = btnStop.ontouchend = () => {
            clearTimeout(timer);
            btnStop.classList.remove('bg-red-600');
        };

        // エンジンからの更新を受け取り
        this.engine.onUpdate = (data) => this.updateDashboard(data);
        this.engine.onCPPass = (lap) => this.handleCPPass(lap);
    }

    updateDashboard(data) {
        const { coords, smoothedPos, distToNext, nextCP } = data;

        // 距離表示更新
        document.getElementById('next-cp-distance').innerText = (distToNext / 1000).toFixed(1);

        // 時速更新 (m/s -> km/h)
        const kmh = Math.round((coords.speed || 0) * 3.6);
        document.getElementById('speed-value').innerText = kmh;

        // 進捗バー (仮に次のCPまで10kmとして計算。本来は区間距離を用いる)
        const progress = Math.max(0, Math.min(100, (1 - distToNext / 10000) * 100));
        document.getElementById('progress-bar').style.width = `${progress}%`;

        // 地図更新
        if (smoothedPos) {
            this.map.jumpTo({
                center: [smoothedPos.longitude, smoothedPos.latitude],
                zoom: distToNext < 500 ? 16 : 14 // ダイナミック・ズーミング
            });
        }
    }

    handleCPPass(lap) {
        // 音声読み上げ
        this.speak(`${lap.cpName}を通過しました。`);

        // 振動
        navigator.vibrate([100, 50, 100]);

        // UI追加
        const list = document.getElementById('lap-list');
        const li = document.createElement('li');
        li.className = "border-l-2 border-green-500 pl-2 py-1 bg-green-500/10";
        li.innerHTML = `
            <div class="text-[10px] text-slate-400">${lap.cpName}</div>
            <div class="text-green-400 font-bold">${new Date(lap.passTime).toLocaleTimeString()}</div>
        `;
        list.prepend(li);
    }

    async requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                this.wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    }

    speak(text) {
        const uttr = new SpeechSynthesisUtterance(text);
        uttr.lang = "ja-JP";
        uttr.rate = 1.2;
        window.speechSynthesis.speak(uttr);
    }

    async showExportMenu() {
        const sessions = await this.engine.storage.getAllSessions();
        if (sessions.length === 0) {
            alert("保存されたデータはありません");
            return;
        }

        const lastSession = sessions[sessions.length - 1];
        const confirmExport = confirm(`最新のセッション (${lastSession.routeName}) をエクスポートしますか？`);

        if (confirmExport) {
            const { logs, laps } = await this.engine.storage.getSessionFullData(lastSession.id);
            exportToCSV(lastSession, logs, laps);
            exportToGeoJSON(lastSession, logs);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new App();
});

// Service Workerの登録
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}
