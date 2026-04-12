import './style.css';
import { RTAManager } from './gps.js';
import { ROUTES } from './routes.js';
import { initMap, updateMap } from './map.js';
import {
    saveSession, saveLog, saveCPPass,
    getAllSessions, deleteSession, getSessionDetail
} from './db.js';


let rta = new RTAManager(ROUTES.kanetsu_down);
let wakeLock = null;
let watchId = null;
let currentSessionId = Date.now();

// Wake Lock
async function requestWakeLock() {
    try {
        wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}

// 初期化
document.getElementById('btn-agree').addEventListener('click', async () => {
    document.getElementById('warning-overlay').style.display = 'none';
    await requestWakeLock();
    initMap();
});

document.getElementById('btn-start').addEventListener('click', async () => {
    rta.isRecording = true;
    currentSessionId = Date.now();
    document.getElementById('btn-start').disabled = true;
    document.getElementById('btn-stop').disabled = false;
    document.getElementById('btn-pause').disabled = false;

    const sessionData = {
        id: currentSessionId,
        routeName: rta.route.name,
        startTime: currentSessionId
    };
    await saveSession(sessionData);

    startTracking();
});

function startTracking() {
    const options = {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
    };

    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const processed = rta.processLocation(pos);
            if (processed) {
                // UI更新
                document.getElementById('speed-display').firstChild.textContent = Math.round(processed.speed * 3.6);

                if (rta.nextCPIndex < rta.checkpoints.length) {
                    const next = rta.checkpoints[rta.nextCPIndex];
                    const d = rta.calculateDistance(processed.lat, processed.lng, next.lat, next.lng);
                    document.getElementById('next-cp-name').textContent = `次のCP: ${next.name}`;
                    document.getElementById('next-cp-dist').textContent = `距離: ${Math.round(d)} m`;
                }

                // DB保存
                if (rta.isRecording && !rta.isPaused) {
                    saveLog(currentSessionId, processed);
                }

                updateMap(processed);
            }
        },
        (err) => console.error(err),
        options
    );
}

// CSVエクスポート機能
async function exportCSV() {
    const logs = await getSessionLogs(currentSessionId);
    let csv = "type,timestamp,name,lat,lng,speed\n";
    logs.forEach(l => {
        csv += `log,${l.timestamp},,${l.lat},${l.lng},${l.speed}\n`;
    });
    rta.passedCPs.forEach(p => {
        csv += `cp,${p.time},${p.name},${p.lat},${p.lng},0\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rta_record_${currentSessionId}.csv`;
    a.click();
}


// 設定値の管理
let config = {
    interval: 5000,
    minDist: 5
};

// 設定画面を開く
document.getElementById('btn-settings').addEventListener('click', async () => {
    document.getElementById('settings-screen').classList.remove('hidden');
    renderSessionList();
});

// 設定画面を閉じる
document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-screen').classList.add('hidden');
    // 設定値の保存
    config.interval = parseInt(document.getElementById('setting-interval').value) * 1000;
    config.minDist = parseInt(document.getElementById('setting-min-dist').value);
});

// 記録一覧の描画
async function renderSessionList() {
    const listContainer = document.getElementById('session-list-container');
    const sessions = await getAllSessions();

    if (sessions.length === 0) {
        listContainer.innerHTML = '<p>記録はありません</p>';
        return;
    }

    let html = '<table class="session-table">';
    html += '<tr><th>日時</th><th>ルート</th><th>操作</th></tr>';
    sessions.reverse().forEach(s => {
        const dateStr = new Date(s.id).toLocaleString();
        html += `
            <tr>
                <td>${dateStr}</td>
                <td>${s.routeName}</td>
                <td>
                    <button class="btn-sm btn-export" data-id="${s.id}">CSV</button>
                    <button class="btn-sm btn-delete" data-id="${s.id}">削除</button>
                </td>
            </tr>
        `;
    });
    html += '</table>';
    listContainer.innerHTML = html;

    // 削除ボタンのイベント紐付け
    listContainer.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (confirm('この記録を削除しますか？')) {
                await deleteSession(Number(e.target.dataset.id));
                renderSessionList();
            }
        });
    });

    // CSVボタンのイベント紐付け
    listContainer.querySelectorAll('.btn-export').forEach(btn => {
        btn.addEventListener('click', (e) => {
            handleExportSingle(Number(e.target.dataset.id));
        });
    });
}

// 個別エクスポート処理
async function handleExportSingle(sessionId) {
    const { logs, cps } = await getSessionDetail(sessionId);

    // CSV生成ロジック
    let csv = "type,timestamp,name,lat,lng,speed,isInterpolated\n";

    // 生ログとCP通過を時刻順に混ぜる
    const combined = [
        ...logs.map(l => ({ ...l, type: 'log' })),
        ...cps.map(c => ({ ...c, type: 'cp' }))
    ].sort((a, b) => a.timestamp - b.timestamp);

    combined.forEach(row => {
        csv += `${row.type},${row.timestamp},${row.name || ''},${row.lat},${row.lng},${row.speed || 0},${row.isInterpolated || false}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rta_session_${sessionId}.csv`;
    a.click();
}