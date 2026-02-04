
import { showActionProgress, showMessage, showToast } from './ui.js';
import { toEnglishDigits } from './utils.js';

let mapInstance = null;
let marker = null;
let currentLat = null;
let currentLng = null;

// DOM Elements
let mapContainer;

export const initLocation = () => {
    // Initialize DOM elements
    mapContainer = document.getElementById('loc-map');
    
    const useMyLocationBtn = document.getElementById('use-my-location-btn');
    const saveBtn = document.getElementById('save-location-btn');
    const viewLocationBtn = document.getElementById('view-location-btn');

    // Event Listeners
    if (useMyLocationBtn) useMyLocationBtn.addEventListener('click', useMyLocation);
    if (saveBtn) saveBtn.addEventListener('click', saveLocation);
    if (viewLocationBtn) {
        viewLocationBtn.addEventListener('click', () => {
             const modal = document.getElementById('location-modal');
             if (modal) {
                 modal.classList.remove('hidden');
                 modal.classList.add('flex');
                 document.body.classList.add('overflow-hidden');
                 // Delay map init slightly to ensure container is visible
                 setTimeout(initMap, 100);
             }
        });
    }

    // Modal Close Logic
    const closeBtn = document.getElementById('close-location-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    // Load initial location
    loadInitialLocation();
};

const closeModal = () => {
    const modal = document.getElementById('location-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.classList.remove('overflow-hidden');
    }
};

const loadInitialLocation = () => {
    const salonId = window.salonId || (JSON.parse(localStorage.getItem('saloony_user')) || {}).salonId;
    if (!salonId) return;

    fetch(`/api/salon/location/${salonId}`)
        .then(r => r.json())
        .then(({ success, location }) => {
            if (success && location && location.latitude && location.longitude) {
                currentLat = location.latitude;
                currentLng = location.longitude;
                
                renderLocationSummary(location);
                
                // If map is already initialized, update marker
                if (mapInstance) {
                    setMarker([currentLat, currentLng]);
                }
            } else {
                renderLocationSummary(null);
            }
        })
        .catch(() => renderLocationSummary(null));
};

const renderLocationSummary = (location) => {
    const summaryEl = document.getElementById('salon-location-summary'); 
    const locationSummaryView = document.getElementById('location-summary'); // In Salon View
    const emptyMsg = document.getElementById('location-empty-msg');
    
    if (location && location.latitude) {
        if (summaryEl) summaryEl.classList.remove('hidden');
        if (locationSummaryView) {
            locationSummaryView.classList.remove('hidden');
            const addrEl = locationSummaryView.querySelector('.location-address');
            if (addrEl) addrEl.textContent = `تم تحديد الموقع على الخريطة`;
        }
        if (emptyMsg) emptyMsg.classList.add('hidden');
    } else {
        if (summaryEl) summaryEl.classList.add('hidden');
        if (locationSummaryView) locationSummaryView.classList.add('hidden');
        if (emptyMsg) emptyMsg.classList.remove('hidden');
    }
};

async function initMap() {
    if (mapInstance) {
        mapInstance.resize();
        return;
    }
    
    if (!mapContainer) return;

    try {
        // Skeleton loading
        const sk = document.getElementById('loc-map-skeleton');
        if(sk) sk.style.display='flex';
        
        let cfg=null; 
        try{ const r=await fetch('/api/map/config'); if(r&&r.ok){ cfg=await r.json(); } }catch(_){}
        
        const styleUrl=(cfg&&cfg.styleUrl)?cfg.styleUrl:'https://ogmap.com/styles/light_fresh.json';
        let styleObj=null; 
        try{ const rs=await fetch(styleUrl); if(rs&&rs.ok){ styleObj=await rs.json(); } }catch(_){}
        
        if(styleObj&&styleObj.sources){
            for(const k in styleObj.sources){ 
                const src=styleObj.sources[k]; 
                if(!src) continue; 
                if(typeof src.url==='string' && src.url.indexOf('tiles.ogmap.com')>=0){ 
                    delete src.url; 
                    src.tiles=[(window.location.origin||'')+'/api/ogmap/tiles/{z}/{x}/{y}.pbf']; 
                } 
                if(Array.isArray(src.tiles)){ 
                    src.tiles=src.tiles.map(u=> u.indexOf('tiles.ogmap.com')>=0 ? (window.location.origin||'')+'/api/ogmap/tiles/{z}/{x}/{y}.pbf' : u ); 
                } 
            }
        }

        // Initialize MapLibre
        if (typeof maplibregl === 'undefined') {
            console.error('MapLibre GL JS not loaded');
            return;
        }

        mapInstance = new maplibregl.Map({ 
            container: mapContainer, 
            style: styleObj||styleUrl, 
            center: [35.22, 31.95], 
            zoom: 12, 
            minZoom: 3, 
            maxZoom: 19, 
            dragRotate: false, 
            pitchWithRotate: false, 
            antialias: true, 
            attributionControl: true, 
            refreshExpiredTiles: false, 
            maxTileCacheSize: 512 
        });

        try { mapInstance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right'); } catch(_){}
        try { mapInstance.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false, showUserHeading: true, fitBoundsOptions: { maxZoom: 16 } }), 'top-right'); } catch(_){}
        try { mapInstance.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left'); } catch(_){}

        mapInstance.on('load', function(){ 
            if(sk) sk.style.display='none'; 
        });
        
        mapInstance.on('click', function(e){ setMarker([e.lngLat.lat, e.lngLat.lng]); });
        
        const handleResize = () => { try { mapInstance && mapInstance.resize(); } catch(_) {} };
        window.addEventListener('resize', handleResize);
        
        // Initial set
        if (currentLat && currentLng) {
            setMarker([currentLat, currentLng]);
        } else if (navigator.geolocation) {
             navigator.geolocation.getCurrentPosition(
                (pos) => { try{ setMarker([pos.coords.latitude, pos.coords.longitude]); }catch(_){} },
                () => {},
                { enableHighAccuracy: true, timeout: 5000 }
            );
        }

    } catch (e) {
        console.error('Map init error:', e);
    }
}

function setMarker(latlng) {
    if (!mapInstance) return;
    const p = { lat: Number(latlng[0]), lng: Number(latlng[1]) };
    
    if (!marker) {
        marker = new maplibregl.Marker({ draggable: true }).setLngLat([p.lng, p.lat]).addTo(mapInstance);
        marker.on('dragend', function(){ 
            const ll = marker.getLngLat(); 
            currentLat = ll.lat;
            currentLng = ll.lng;
        });
    } else {
        marker.setLngLat([p.lng, p.lat]);
    }
    
    mapInstance.setCenter([p.lng, p.lat]);
    mapInstance.setZoom(15);
    
    currentLat = p.lat;
    currentLng = p.lng;
}

async function useMyLocation() {
    if (!navigator.geolocation) { showToast('المتصفح لا يدعم تحديد الموقع الجغرافي', false); return; }
    
    const hud = showActionProgress('جاري تحديد موقعك الحالي...');
    
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        setMarker([latitude, longitude]);
        hud.success('تم تحديد موقعك ووضع العلامة على الخريطة');
    }, (err) => {
        if (err && err.code === 1) hud.error('تم رفض إذن الوصول للموقع');
        else hud.error('تعذر تحديد موقعك الحالي');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

async function saveLocation() {
    const salonId = window.salonId;
    if (!salonId) { showToast('تعذر تحديد الصالون', false); return; }
    
    if (currentLat == null || currentLng == null) { 
        showToast('يرجى اختيار الموقع على الخريطة', false); 
        return; 
    }
    
    const hud = showActionProgress('جاري حفظ الموقع...');
    
    const payload = {
        address: null,
        city: null,
        latitude: currentLat,
        longitude: currentLng,
        place_id: null,
        formatted_address: null
    };

    try {
        const resp = await fetch(`/api/salon/location/${salonId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await resp.json();
        
        if (result && result.success) {
            hud.success('تم حفظ موقع الصالون بنجاح');
            renderLocationSummary(payload);
            setTimeout(() => { try { closeModal(); } catch (_) {} }, 700);
        } else {
            hud.error(result.message || 'فشل في حفظ الموقع');
        }
    } catch (e) {
        hud.error('خطأ في الشبكة أثناء حفظ الموقع');
    }
}
