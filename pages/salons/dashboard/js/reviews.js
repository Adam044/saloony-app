import { showMessage } from './ui.js';

let currentSalonId = null;

export const initReviews = (salonId) => {
    currentSalonId = salonId;
    // Add event listener for refresh button if it exists
    const refreshBtn = document.getElementById('refresh-reviews-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadReviews);
    }
};

export const loadReviews = async () => {
    const loading = document.getElementById('reviews-loading');
    const list = document.getElementById('reviews-list');
    const empty = document.getElementById('reviews-empty');
    
    if (loading) loading.classList.remove('hidden');
    if (list) list.innerHTML = '';
    if (empty) empty.classList.add('hidden');

    try {
        const response = await fetch(`/api/reviews/salon/${currentSalonId}`);
        const data = await response.json();
        
        if (data.success) {
            renderReviews(data.reviews || []);
        } else {
            showMessage(null, data.message || 'فشل في جلب المراجعات.', false);
            renderReviews([]);
        }
    } catch (error) {
        console.error('Error loading salon reviews:', error);
        showMessage(null, 'خطأ في الشبكة أثناء جلب المراجعات.', false);
        renderReviews([]);
    } finally {
        if (loading) loading.classList.add('hidden');
    }
};

const renderReviews = (reviews) => {
    const list = document.getElementById('reviews-list');
    const empty = document.getElementById('reviews-empty');
    
    if (!list || !empty) return;

    if (!reviews || reviews.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    
    empty.classList.add('hidden');
    
    list.innerHTML = reviews.map(r => `
        <div class="glass-card p-5 transition-all duration-300 hover:translate-y-[-2px] mb-4">
            <div class="flex items-center justify-between mb-3">
                <span class="inline-flex items-center gap-2 px-3 py-1 bg-white/50 text-primary-dark rounded-full text-xs font-semibold backdrop-blur-sm shadow-sm">
                    <i class="fas fa-user-circle text-secondary text-sm"></i>
                    ${r.user_name || 'مستخدم'}
                </span>
                <span class="text-xs text-gray-500 flex items-center gap-1">
                    <span class="inline-flex items-center gap-1 px-3 py-1 bg-white/50 text-gray-700 rounded-full text-xs backdrop-blur-sm">
                         <i class="fas fa-calendar-alt text-secondary"></i>
                         ${formatDateDDMMYYYY(r.date_posted || r.created_at)}
                    </span>
                </span>
            </div>
            <div class="text-yellow-400 text-sm mb-3 flex gap-1 px-1">
                ${formatRatingStars(parseFloat(r.rating || 0))}
            </div>
            <p class="text-sm text-gray-700 leading-relaxed bg-white/40 p-4 rounded-xl border border-white/20 relative">
                <i class="fas fa-quote-right absolute top-2 right-2 text-secondary/10 text-2xl -z-10"></i>
                ${(r.comment || '').trim() || 'بدون تعليق'}
            </p>
        </div>
    `).join('');
};
