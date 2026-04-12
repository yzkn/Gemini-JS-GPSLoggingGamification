/**
 * map.js
 * MapLibre GL JSの初期化とレイヤー管理
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export class MapManager {
    constructor(containerId) {
        this.map = new maplibregl.Map({
            container: containerId,
            style: {
                version: 8,
                sources: {
                    gsi_raster: {
                        type: 'raster',
                        tiles: [
                            'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
                        ],
                        tileSize: 256,
                        attribution: "Map Data <a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>国土地理院</a>"
                    }
                },
                layers: [
                    {
                        id: 'gsi-layer',
                        type: 'raster',
                        source: 'gsi_raster',
                        minzoom: 2,
                        maxzoom: 18
                    }
                ]
            },
            center: [139.5, 35.8], // 初期位置（関東付近）
            zoom: 10
        });

        this.marker = new maplibregl.Marker({ color: '#FF0000' })
            .setLngLat([0, 0])
            .addTo(this.map);
    }

    /**
     * 現在地を更新し、地図を追従させる
     */
    updateCurrentLocation(lat, lon, zoom = null) {
        this.marker.setLngLat([lon, lat]);
        this.map.easeTo({
            center: [lon, lat],
            zoom: zoom || this.map.getZoom(),
            duration: 1000
        });
    }

    /**
     * ルートの表示（LineString）
     */
    drawRoute(points) {
        // 走行軌跡の描画ロジック
        if (this.map.getSource('route')) {
            this.map.getSource('route').setData({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: points }
            });
        } else {
            this.map.addSource('route', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: points }
                }
            });
            this.map.addLayer({
                id: 'route-layer',
                type: 'line',
                source: 'route',
                paint: { 'line-color': '#0074D9', 'line-width': 4 }
            });
        }
    }
}