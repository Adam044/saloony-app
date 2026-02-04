import { showMessage, showActionProgress, showActionSuccess, showToast } from './ui.js';
import { getRoleSessionToken } from './auth.js';

let currentSalonId = null;
let inputFacebook, inputInstagram, inputTiktok, inputOther;

export const initSocial = (salonId) => {
    if (salonId) {
        currentSalonId = salonId;
    }
    
    // Initialize Share Modal
    initShareModal();
    
    // Bind DOM elements regardless of salonId update
    inputFacebook = document.getElementById('social-facebook');
    inputInstagram = document.getElementById('social-instagram');
    inputTiktok = document.getElementById('social-tiktok');
    inputOther = document.getElementById('social-other');
    
    const btnSave = document.getElementById('save-social-links');
    if (btnSave) {
        // Remove old listeners to prevent duplicates (optional but good practice)
        const newBtn = btnSave.cloneNode(true);
        btnSave.parentNode.replaceChild(newBtn, btnSave);
        newBtn.addEventListener('click', saveSocialLinks);
    }
    
    const btnCancel = document.getElementById('social-modal-cancel-btn');
    const btnClose = document.getElementById('social-modal-close-btn');
    if (btnCancel) btnCancel.addEventListener('click', hideSocialModal);
    if (btnClose) btnClose.addEventListener('click', hideSocialModal);

    // Setup social links button in main view
    const btnOpen = document.getElementById('btn-social-links');
    if (btnOpen) {
        // Use a flag to avoid multiple listeners
        if (!btnOpen.dataset.listenerAttached) {
            btnOpen.addEventListener('click', () => {
                showSocialModal();
                loadSocialLinks();
            });
            btnOpen.dataset.listenerAttached = 'true';
        }
    }
};

// --- Share Modal Logic ---
const initShareModal = () => {
    const modal = document.getElementById('share-modal');
    if (!modal) return;

    const btnShare = document.getElementById('share-salon-btn');
    const btnClose = document.getElementById('close-share-modal');
    const backdrop = document.getElementById('share-modal-backdrop');
    const content = document.getElementById('share-modal-content');
    const btnCopy = document.getElementById('copy-link-btn');
    const btnDownload = document.getElementById('download-qr-btn');
    const inputLink = document.getElementById('share-link-input');
    const imgQr = document.getElementById('share-qr-image');
    const spinner = document.getElementById('qr-loading-spinner');
    
    // Open Modal
    if (btnShare) {
        btnShare.addEventListener('click', () => {
            if (!currentSalonId) {
                showToast('لم يتم تحديد الصالون', 'error');
                return;
            }
            
            modal.classList.remove('hidden');
            // Trigger reflow
            void modal.offsetWidth;
            
            backdrop.classList.remove('opacity-0');
            content.classList.remove('opacity-0', 'scale-95');
            
            // Generate Link & QR
            const salonUrl = `${window.location.origin}/pages/salons/salon.html?id=${currentSalonId}`;
            inputLink.value = salonUrl;
            
            // Load QR
            spinner.classList.remove('hidden');
            imgQr.classList.add('hidden');
            
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(salonUrl)}`;
            imgQr.src = qrUrl;
            
            imgQr.onload = () => {
                spinner.classList.add('hidden');
                imgQr.classList.remove('hidden');
            };
        });
    }
    
    // Close Modal Helper
    const close = () => {
        backdrop.classList.add('opacity-0');
        content.classList.add('opacity-0', 'scale-95');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300);
    };
    
    if (btnClose) btnClose.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    
    // Copy Link
    if (btnCopy && inputLink) {
        btnCopy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(inputLink.value);
                
                // Visual feedback
                const originalIcon = btnCopy.innerHTML;
                btnCopy.innerHTML = '<i class="fas fa-check"></i>';
                btnCopy.classList.add('bg-green-600');
                showToast('تم نسخ الرابط بنجاح', 'success');
                
                setTimeout(() => {
                    btnCopy.innerHTML = originalIcon;
                    btnCopy.classList.remove('bg-green-600');
                }, 2000);
            } catch (err) {
                showToast('فشل نسخ الرابط', 'error');
            }
        });
    }
    
    // Download QR
    if (btnDownload && imgQr) {
        btnDownload.addEventListener('click', async () => {
            try {
                const response = await fetch(imgQr.src);
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `salon-${currentSalonId}-qr.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                showToast('تم تحميل رمز QR', 'success');
            } catch (err) {
                showToast('فشل تحميل الصورة', 'error');
            }
        });
    }
    
    // Social Buttons
    document.querySelectorAll('.share-social-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const platform = btn.dataset.platform;
            const url = inputLink.value;
            const text = `Check out this salon on Saloony!`;
            let shareUrl = '';
            
            switch (platform) {
                case 'whatsapp':
                    shareUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
                    break;
                case 'facebook':
                    shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
                    break;
                case 'instagram':
                case 'tiktok':
                    // These platforms don't support direct web sharing easily.
                    // Fallback to copying link
                    navigator.clipboard.writeText(url).then(() => {
                        showToast(`تم نسخ الرابط! يمكنك الآن لصقه في ${platform === 'instagram' ? 'إنستغرام' : 'تيك توك'}`, 'success');
                    }).catch(() => {
                        showToast('فشل نسخ الرابط', 'error');
                    });
                    return; // Don't open window
            }
            
            if (shareUrl) {
                window.open(shareUrl, '_blank', 'width=600,height=400');
            }
        });
    });
};

export const loadSocialLinks = async () => {
    // Guard clause: if no salonId, don't fetch
    if (!currentSalonId || currentSalonId === 'undefined') {
        console.warn('loadSocialLinks called without valid salonId');
        return; 
    }

    try {
        const token = getRoleSessionToken();
        const headers = {};
        if (token) headers['x-role-token'] = token;
        
        const res = await fetch(`/api/salon/social-links/${currentSalonId}`, { headers });
        if (!res.ok) throw new Error('فشل تحميل الروابط');
        
        const data = await res.json();
        const social = data?.social || {};
        
        if (inputFacebook) inputFacebook.value = social.facebook || '';
        if (inputInstagram) inputInstagram.value = social.instagram || '';
        if (inputTiktok) inputTiktok.value = social.tiktok || '';
        if (inputOther) inputOther.value = social.other || '';
        
        renderSocialList(social);
    } catch (err) {
        console.error('Error loading social links:', err);
        showMessage(null, err.message || 'حدث خطأ غير متوقع', false);
    }
};

export const saveSocialLinks = async () => {
    const token = getRoleSessionToken();
    if (!token) {
        showMessage(null, 'يتطلب الحفظ جلسة دور المدير (PIN).', false);
        // Trigger PIN screen if available (handled by auth module generally, but here we just warn)
        return;
    }

    const hud = showActionProgress('جاري حفظ الروابط...');
    
    const payloads = [
        { platform: 'facebook', url: normalizeUrl(inputFacebook?.value) },
        { platform: 'instagram', url: normalizeUrl(inputInstagram?.value) },
        { platform: 'tiktok', url: normalizeUrl(inputTiktok?.value) },
        { platform: 'other', url: normalizeUrl(inputOther?.value) },
    ];

    try {
        for (const p of payloads) {
            // If URL is empty/null -> delete; else -> upsert
            if (!p.url) {
                const delRes = await fetch(`/api/salon/social-links/${currentSalonId}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ platform: p.platform, session_token: token })
                });
                if (!delRes.ok) {
                    console.warn(`Failed to delete ${p.platform}`);
                }
            } else {
                const postRes = await fetch(`/api/salon/social-links/${currentSalonId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ platform: p.platform, url: p.url, session_token: token })
                });
                if (!postRes.ok) {
                    throw new Error(`فشل حفظ ${p.platform}`);
                }
            }
        }
        
        if (hud) hud.success('تم حفظ الروابط بنجاح');
        hideSocialModal();
        
        // Reload to reflect saved state
        await loadSocialLinks();
        
    } catch (err) {
        if (hud) hud.error('خطأ في الحفظ');
        showMessage(null, err.message || 'حدث خطأ غير متوقع', false);
    }
};

const normalizeUrl = (url) => {
    if (!url) return null;
    url = url.trim();
    if (!url) return null;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'https://' + url;
    }
    return url;
};

const renderSocialList = (social) => {
    const list = document.getElementById('social-links-list');
    if (!list) return;
    
    list.innerHTML = '';
    const platforms = [
        { key: 'facebook', icon: 'fab fa-facebook', color: 'text-blue-600', label: 'فيسبوك' },
        { key: 'instagram', icon: 'fab fa-instagram', color: 'text-pink-600', label: 'إنستغرام' },
        { key: 'tiktok', icon: 'fab fa-tiktok', color: 'text-black', label: 'تيك توك' },
        { key: 'other', icon: 'fas fa-link', color: 'text-gray-600', label: 'رابط آخر' }
    ];

    platforms.forEach(p => {
        if (social[p.key]) {
            const div = document.createElement('div');
            div.className = 'flex items-center justify-between glass-card p-3 mb-2 transition-transform hover:scale-[1.01]';
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-white/50 flex items-center justify-center shadow-sm">
                        <i class="${p.icon} ${p.color} text-lg"></i>
                    </div>
                    <span class="text-sm font-bold text-gray-700">${p.label}</span>
                </div>
                <a href="${social[p.key]}" target="_blank" class="text-xs text-blue-600 hover:text-blue-700 hover:underline truncate max-w-[150px] dir-ltr font-medium bg-blue-50 px-2 py-1 rounded-full transition-colors">
                    ${social[p.key].replace(/^https?:\/\/(www\.)?/, '')}
                </a>
            `;
            list.appendChild(div);
        }
    });
};

const showSocialModal = () => {
    const modal = document.getElementById('social-links-modal');
    if (modal) modal.classList.remove('hidden');
};

const hideSocialModal = () => {
    const modal = document.getElementById('social-links-modal');
    if (modal) modal.classList.add('hidden');
};
