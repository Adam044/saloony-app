
// Utility Functions

// Convert Arabic/Persian digits to English
export const toEnglishDigits = (input) => {
    if (!input) return '';
    const map = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9' };
    return String(input).replace(/[٠-٩۰-۹]/g, d => map[d] || d);
};

// Get Arabic time period
export const getTimePeriodArabic = (hour24) => {
    if (hour24 >= 5 && hour24 < 12) return 'صباحًا';
    if (hour24 >= 12 && hour24 < 16) return 'ظهرًا';
    if (hour24 >= 16 && hour24 < 19) return 'بعد الظهر';
    return 'مساءً';
};

// Format time with Arabic period
export const formatTimeWithPeriod = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const hour24 = date.getHours();
    const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
    const minutes = date.getMinutes();
    const period = getTimePeriodArabic(hour24);
    
    if (minutes === 0) {
        return `${hour12} ${period}`;
    } else {
        return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
    }
};

// Format Date DD/MM/YYYY
export const formatDateDDMMYYYY = (dateInput) => {
    if (!dateInput) return '--/--/----';
    let d = null;
    if (dateInput instanceof Date) {
        d = dateInput;
    } else if (typeof dateInput === 'string') {
        let s = dateInput.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            s = `${s}T00:00:00`;
        } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?$/.test(s)) {
            s = s.replace(' ', 'T');
        }
        d = new Date(s);
    } else {
        d = new Date(dateInput);
    }
    
    if (isNaN(d.getTime())) return '--/--/----';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
};

// Format Rating Stars
export const formatRatingStars = (rating) => {
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);
    return `
        ${'<i class="fas fa-star text-yellow-400"></i>'.repeat(fullStars)}
        ${halfStar ? '<i class="fas fa-star-half-alt text-yellow-400"></i>' : ''}
        ${'<i class="far fa-star text-yellow-400"></i>'.repeat(emptyStars)}
    `;
};

// Format Currency
export const formatCurrency = (amount, currency = 'شيكل') => {
    const num = Number(amount || 0);
    return `${num.toLocaleString('en-US')} ${currency}`;
};

// Debounce Function
export const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};
