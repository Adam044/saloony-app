
export const initNotifications = () => {
    const modal = document.getElementById('notify-permission-modal');
    const enableBtn = document.getElementById('notify-permission-enable');
    const laterBtn = document.getElementById('notify-permission-later');
    const STORAGE_KEY = 'saloony_notify_later';

    function shouldShowModal() {
        if (!('Notification' in window)) return false;
        const permission = Notification.permission;
        if (permission === 'granted') return false;
        const snoozeUntil = localStorage.getItem(STORAGE_KEY);
        if (snoozeUntil && Date.now() < parseInt(snoozeUntil)) return false;
        return true;
    }

    function showModalIfNeeded() {
        if (shouldShowModal() && modal) {
            modal.classList.remove('hidden');
        }
    }

    async function ensureSW() {
        if ('serviceWorker' in navigator) {
            try {
                const reg = await navigator.serviceWorker.getRegistration();
                if (!reg) await navigator.serviceWorker.register('/service-worker.js');
            } catch (e) {
                console.error('Service Worker registration failed:', e);
            }
        }
    }

    if (enableBtn) {
        enableBtn.addEventListener('click', async () => {
            if (modal) modal.classList.add('hidden');
            await ensureSW();
            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    const reg = await navigator.serviceWorker.ready;
                    const existing = await reg.pushManager.getSubscription();
                    if (!existing) {
                        const res = await fetch('/api/push/public-key');
                        const { publicKey } = await res.json();
                        const vapidKey = publicKey || 'BEluXw4-FAKE-PLACEHOLDER-FALLBACK';
                        
                        const toUint8Array = (base64String) => {
                            const padding = '='.repeat((4 - base64String.length % 4) % 4);
                            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
                            const raw = atob(base64);
                            const output = new Uint8Array(raw.length);
                            for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
                            return output;
                        };
                        
                        const sub = await reg.pushManager.subscribe({ 
                            userVisibleOnly: true, 
                            applicationServerKey: toUint8Array(vapidKey) 
                        });
                        
                        const raw = localStorage.getItem('saloony_user');
                        const user = raw ? JSON.parse(raw) : {};
                        
                        await fetch('/api/push/subscribe', {
                            method: 'POST', 
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                user_id: user.userId || user.id || null, 
                                salon_id: user.salonId || null, 
                                subscription: sub.toJSON() 
                            })
                        });
                    }
                }
            } catch (e) {
                console.error('Notification permission error:', e);
            }
        });
    }

    if (laterBtn) {
        laterBtn.addEventListener('click', () => {
            const nextTime = Date.now() + 24 * 60 * 60 * 1000;
            localStorage.setItem(STORAGE_KEY, String(nextTime));
            if (modal) modal.classList.add('hidden');
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') showModalIfNeeded();
    });

    // Initial check
    showModalIfNeeded();
};
