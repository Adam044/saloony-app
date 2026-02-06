// Authentication & PIN Logic

export const parseJwt = (token) => {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
};

export const tokenSecondsLeft = (token) => {
    const payload = parseJwt(token);
    if (!payload || !payload.exp) return 0;
    return Math.floor(payload.exp - (Date.now() / 1000));
};

export const attemptRefresh = async () => {
    try {
        const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({})
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.access_token) {
            localStorage.setItem('saloony_token', data.access_token);
            return data.access_token;
        }
        return null;
    } catch (e) {
        return null;
    }
};

export const initAuth = async () => {
    console.log('Initializing auth...');

    // 1. Get User/Salon Data First
    const rawUser = localStorage.getItem('saloony_user');
    let user = {};
    try {
        if (rawUser && rawUser !== 'undefined') {
            user = JSON.parse(rawUser);
        }
    } catch (e) {
        console.error('Failed to parse user data:', e);
    }
    
    // Normalize IDs
    let userId = user.userId || user.userid || user.id;
    let salonId = user.salonId || user.salon_id || user.salonid;

    // 2. Check Authentication (Token Refresh)
    let token = localStorage.getItem('saloony_token');
    const payload = token && parseJwt(token);

    // Fallback: Extract IDs from Token if missing in localStorage
    if (payload) {
        if (!userId) {
            userId = payload.sub || payload.id || payload.user_id || payload.userId;
            console.log('✅ Recovered User ID from Token:', userId);
        }
        if (!salonId) {
            salonId = payload.salonId || payload.salon_id || payload.salonid;
            console.log('✅ Recovered Salon ID from Token:', salonId);
        }
    }

    // Fallback: Try to find salonId from role session if missing
    if (!salonId) {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('saloony_role_session_')) {
                salonId = key.replace('saloony_role_session_', '');
                console.log('✅ Found Salon ID from role session:', salonId);
                if (!userId) userId = 'staff_placeholder';
                break;
            }
        }
    }

    // Expose globally
    if (salonId) window.salonId = salonId;

    if (!token || !payload || tokenSecondsLeft(token) <= 60) {
        const newToken = await attemptRefresh();
        if (!newToken) {
            // AUTH FAILED - But wait! Do we have a valid Role Session (Kiosk Mode)?
            // If we have a salonId and a role session token, we might be okay.
            const roleSession = salonId ? localStorage.getItem(`saloony_role_session_${salonId}`) : null;
            
            if (roleSession) {
                console.log('⚠️ Primary auth failed, but found Role Session. Attempting Kiosk Mode...');
                // We proceed. checkRoleSystemEnabled will verify the session.
                // We return a limited user object.
                return { userId: userId || 0, salonId, ...user, role: 'staff', isKiosk: true };
            }

            window.location.replace('/auth.html');
            return null;
        }
        token = newToken;
    }

    // Schedule refresh
    setInterval(async () => {
        const t = localStorage.getItem('saloony_token');
        if (!t) return;
        const left = tokenSecondsLeft(t);
        if (left <= 120) {
            await attemptRefresh();
        }
    }, 60000);

    if (!userId || !salonId) {
        console.error('Missing user or salon ID');
        window.location.replace('/auth.html');
        return null;
    }

    const role = user.role || 'admin'; // Default to admin if not specified
    window.currentUserRole = role;

    return { userId, salonId, ...user, role };
};

// State variables
let currentPin = '';
let sessionToken = null;
export let currentUserRole = null;
export let currentStaffId = null;
export let currentStaffName = '';
let availableBiometricRoles = [];

export const getRoleSessionToken = (specificSalonId) => {
    const salonId = specificSalonId || window.salonId;
    if (!salonId) return null;
    return localStorage.getItem(`saloony_role_session_${salonId}`);
};

// DOM Elements
const pinAuthScreen = document.getElementById('pin-auth-screen');
const pinSection = document.getElementById('pin-section');
const authSubtitle = document.getElementById('auth-subtitle');
const pinError = document.getElementById('pin-error');
const pinLoading = document.getElementById('pin-loading');
const mainAppContent = document.getElementById('main-app-content');
const pinButtons = document.querySelectorAll('.pin-btn');
const pinBackspace = document.getElementById('pin-backspace');
const pinDots = document.querySelectorAll('.pin-dot');

// Check for existing session or init role system
export const checkRoleSystemEnabled = async () => {
    try {
        const salonId = window.salonId;
        if (!salonId) return;

        // Check if role system is enabled
        const response = await fetch(`/api/salon/roles/${salonId}/status`);
        const data = await response.json();
        
        if (data.enabled) {
            console.log('🔒 Role system is ENABLED');
            
            // Store available biometric roles if any
            if (data.biometric_roles) {
                availableBiometricRoles = data.biometric_roles;
            }
            
            // Check for existing valid session
            const existingToken = localStorage.getItem(`saloony_role_session_${salonId}`);
            if (existingToken) {
                const isValid = await verifySession(existingToken);
                if (isValid) {
                    showMainApp();
                    return;
                }
            }
            
            // Show PIN screen
            showPinScreen();
        } else {
            // Role system disabled, show main app directly
            console.log('🚫 Role system is DISABLED, showing main app directly');
            showMainApp();
        }
    } catch (error) {
        console.error('❌ Error checking role system:', error);
        // On error, show main app (fallback to normal behavior)
        console.log('🔄 Fallback: showing main app due to error');
        showMainApp();
    }
};

// Verify existing session
const verifySession = async (token) => {
    try {
        const salonId = window.salonId;
        const response = await fetch(`/api/salon/roles/${salonId}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_token: token })
        });
        
        if (!response.ok) {
            // If server error (500), don't invalidate session yet, just return false (will show PIN screen but keep token)
            // Or better, if it's 401/403, invalidate.
            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem(`saloony_role_session_${salonId}`);
            }
            return false;
        }

        const data = await response.json();
        if (data.success && data.valid) {
            currentUserRole = data.role_type;
            currentStaffId = data.staff_id;
            currentStaffName = data.staff_name;
            
            // Sync to window for other modules
            window.currentUserRole = currentUserRole;
            window.currentStaffId = currentStaffId;
            window.currentStaffName = currentStaffName;

            sessionToken = token;
            return true;
        } else {
            // Invalid session, remove from storage
            console.warn('⚠️ Session invalid:', data.message);
            localStorage.removeItem(`saloony_role_session_${salonId}`);
            return false;
        }
    } catch (error) {
        console.error('Error verifying session:', error);
        // Network error - do not remove token, just force re-auth for now
        return false;
    }
};

// Show PIN authentication screen
const showPinScreen = () => {
    if (pinAuthScreen) pinAuthScreen.classList.remove('hidden');
    if (mainAppContent) mainAppContent.classList.add('hidden');
    
    // Always show PIN section only
    if (pinSection) pinSection.classList.remove('hidden');
    if (authSubtitle) authSubtitle.textContent = 'أدخل كلمة المرور الرقمية الخاصة بك';
};

// Show main application
const showMainApp = () => {
    if (pinAuthScreen) pinAuthScreen.classList.add('hidden');
    if (mainAppContent) mainAppContent.classList.remove('hidden');
    
    // Apply role-based restrictions if user is staff
    if (currentUserRole === 'staff') {
        applyStaffRestrictions();
    }

    // Refresh appointments to ensure correct view (Manager vs Staff)
    if (window.reloadAppointments) {
        window.reloadAppointments();
    }
};

// Apply restrictions for staff users
const applyStaffRestrictions = () => {
    // Hide all navigation items except appointments
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        const viewId = item.dataset.view;
        if (viewId && viewId !== 'appointments-view') {
            item.style.display = 'none';
        }
    });
    
    // Force show appointments view
    if (window.showView) {
        window.showView('appointments-view');
    }
    
    // Add staff name to header if possible
    const headerTitle = document.querySelector('h1, .header-title');
    if (headerTitle && currentStaffName) {
        headerTitle.innerHTML = `<i class="fas fa-user ml-2"></i>${currentStaffName} - المواعيد`;
    }
};

// Show loading state
const showLoading = () => {
    if (pinLoading) pinLoading.classList.remove('hidden');
    if (pinError) pinError.classList.add('hidden');
};

// Hide loading state
const hideLoading = () => {
    if (pinLoading) pinLoading.classList.add('hidden');
};

// Reset PIN
const resetPin = () => {
    currentPin = '';
    updatePinDisplay();
    if (pinError) pinError.classList.add('hidden');
};

// Update PIN display
const updatePinDisplay = () => {
    pinDots.forEach((dot, index) => {
        if (index < currentPin.length) {
            dot.classList.add('bg-secondary', 'border-secondary', 'filled');
            dot.classList.remove('border-gray-300');
        } else {
            dot.classList.remove('bg-secondary', 'border-secondary', 'filled');
            dot.classList.add('border-gray-300');
        }
    });
};

// Add digit to PIN
const addDigit = (digit) => {
    if (currentPin.length < 6) {
        currentPin += digit;
        updatePinDisplay();
        
        // Auto-submit when PIN is exactly 6 digits
        if (currentPin.length === 6) {
            setTimeout(() => {
                authenticatePin();
            }, 300);
        }
    }
};

// Remove last digit from PIN
const removeDigit = () => {
    if (currentPin.length > 0) {
        currentPin = currentPin.slice(0, -1);
        updatePinDisplay();
        hideError();
    }
};

// Authenticate PIN
const authenticatePin = async () => {
    if (currentPin.length !== 6) return; // Require exactly 6 digits
    
    console.log('🔐 Authenticating PIN for salon:', window.salonId);
    showLoading();
    hideError();
    
    try {
        const salonId = window.salonId;
        const response = await fetch(`/api/salon/roles/${salonId}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: currentPin })
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ PIN authentication successful');
            // Store session token
            sessionToken = data.session_token;
            currentUserRole = data.role_type;
            currentStaffId = data.staff_id;
            currentStaffName = data.staff_name;
            
            // Sync to window for other modules
            window.currentUserRole = currentUserRole;
            window.currentStaffId = currentStaffId;
            window.currentStaffName = currentStaffName;
            
            localStorage.setItem(`saloony_role_session_${salonId}`, sessionToken);
            
            // Show main app
            showMainApp();
        } else {
            console.log('❌ PIN authentication failed:', data.message);
            showError(data.message || 'كلمة المرور غير صحيحة. حاول مرة أخرى.');
            resetPin();
        }
    } catch (error) {
        console.error('❌ Error authenticating PIN:', error);
        showError('حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.');
        resetPin();
    } finally {
        hideLoading();
    }
};

// Show error message with animation
const showError = (message = 'كلمة المرور غير صحيحة. حاول مرة أخرى.') => {
    if (!pinError) return;
    
    // Update error message
    const errorText = pinError.querySelector('p') || pinError;
    if (errorText.tagName === 'P') {
        errorText.textContent = message;
    } else {
        // If pinError is the container and text is direct or in a different structure
        // Assuming the structure from HTML: <div><i...> text</div>
        // We'll just append text if needed or replace content carefully. 
        // Based on HTML: <div id="pin-error"><i></i> text </div>
        // Let's just set innerHTML to be safe or textContent if we want to clear icon
        // Ideally we should preserve the icon.
        // Let's assume standard behavior:
        // pinError.childNodes[2].textContent = message; // brittle
        // simpler:
        pinError.innerHTML = `<i class="fas fa-exclamation-circle ml-1"></i> ${message}`;
    }
    
    // Show error with shake animation
    pinError.classList.remove('hidden');
    
    // Add shake animation to the PIN dots
    const pinDotsContainer = document.querySelector('.pin-dot').parentElement;
    if (pinDotsContainer) {
        pinDotsContainer.classList.add('animate-pulse');
        pinDotsContainer.style.animation = 'shake 0.5s ease-in-out';
        
        // Remove animation after it completes
        setTimeout(() => {
            pinDotsContainer.style.animation = '';
            pinDotsContainer.classList.remove('animate-pulse');
        }, 500);
    }
    
    // Auto-hide error after 4 seconds
    setTimeout(hideError, 4000);
};

// Hide error message
const hideError = () => {
    if (pinError) pinError.classList.add('hidden');
};

// Logout function
const logoutRole = async () => {
    const salonId = window.salonId;
    if (sessionToken) {
        try {
            await fetch(`/api/salon/roles/${salonId}/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_token: sessionToken })
            });
        } catch (error) {
            console.error('Error logging out:', error);
        }
    }
    
    // Clear session data
    localStorage.removeItem(`saloony_role_session_${salonId}`);
    sessionToken = null;
    currentUserRole = null;
    currentStaffId = null;
    currentStaffName = '';
    
    // Check role system again
    checkRoleSystemEnabled();
};

// Event Listeners
if (pinButtons) {
    pinButtons.forEach(button => {
        button.addEventListener('click', () => {
            const digit = button.dataset.digit;
            addDigit(digit);
        });
    });
}

if (pinBackspace) {
    pinBackspace.addEventListener('click', removeDigit);
}

// Keyboard support
document.addEventListener('keydown', (e) => {
    if (pinAuthScreen && !pinAuthScreen.classList.contains('hidden')) {
        if (e.key >= '0' && e.key <= '9') {
            addDigit(e.key);
        } else if (e.key === 'Backspace') {
            removeDigit();
        } else if (e.key === 'Enter' && currentPin.length === 6) {
            authenticatePin();
        }
    }
});
