import maplibregl from 'maplibre-gl';

let map;
let marker;
let pathData = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] }
};

export function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                gsi: {
                    type: 'raster',
                    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: "国土地理院"
                }
            },
            layers: [{
                id: 'gsi-layer',
                type: 'raster',
                source: 'gsi'
            }]
        },
        center: [139.459, 35.893],
        zoom: 13
    });

    map.on('load', () => {
        map.addSource('route', { type: 'geojson', data: pathData });
        map.addLayer({
            id: 'route-layer',
            type: 'line',
            source: 'route',
            paint: { 'line-color': '#ff0000', 'line-width': 4 }
        });
    });
}

export function updateMap(pos) {
    if (!map) return;
    const coords = [pos.lng, pos.lat];

    // 移動平均（簡易3点）
    pathData.geometry.coordinates.push(coords);
    if (pathData.geometry.coordinates.length > 1000) {
        // メモリ節約
    }

    if (map.getSource('route')) {
        map.getSource('route').setData(pathData);
    }
    map.setCenter(coords);
}