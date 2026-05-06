/**
 * export-util.js
 */
export function exportToCSV(session, logs, laps) {
    let csvContent = "timestamp,type,name,latitude,longitude,speed_kmh,accuracy\n";

    // 生ログの追加
    logs.forEach(log => {
        const time = new Date(log.timestamp).toISOString();
        const speed = (log.speed * 3.6).toFixed(2);
        csvContent += `${time},LOG,,${log.latitude},${log.longitude},${speed},${log.accuracy}\n`;
    });

    // CP通過ログの追加
    laps.forEach(lap => {
        const time = new Date(lap.timestamp).toISOString();
        csvContent += `${time},CP,${lap.cpName},,,,\n`;
    });

    downloadFile(csvContent, `rta_log_${session.id}.csv`, "text/csv");
}

export function exportToGeoJSON(session, logs) {
    const geojson = {
        type: "FeatureCollection",
        features: [{
            type: "Feature",
            properties: {
                sessionId: session.id,
                routeName: session.routeName,
                startTime: new Date(session.startTime).toISOString()
            },
            geometry: {
                type: "LineString",
                coordinates: logs.map(log => [log.longitude, log.latitude])
            }
        }]
    };

    downloadFile(JSON.stringify(geojson, null, 2), `rta_track_${session.id}.geojson`, "application/json");
}

function downloadFile(content, fileName, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}