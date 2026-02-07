
// API Service Module
// Handles all backend communication

const API_BASE = '/api';

const getHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('saloony_token'); // Standardized token key
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
};

// --- Appointments ---

export const fetchAppointments = async (salonId, filter, signal) => {
    try {
        const response = await fetch(`${API_BASE}/salon/appointments/${salonId}/${filter}`, { signal });
        const data = await response.json();
        return data;
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        console.error('Error fetching appointments:', error);
        throw new Error('Failed to fetch appointments');
    }
};

export const updateAppointmentStatus = async (appointmentId, status) => {
    try {
        const response = await fetch(`${API_BASE}/salon/appointment/status/${appointmentId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        return await response.json();
    } catch (error) {
        console.error('Error updating appointment status:', error);
        throw error;
    }
};

// --- Staff ---

export const fetchStaff = async (salonId) => {
    try {
        const response = await fetch(`${API_BASE}/salon/staff/${salonId}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching staff:', error);
        throw error;
    }
};

export const createStaff = async (salonId, name) => {
    try {
        const response = await fetch(`${API_BASE}/salon/staff/${salonId}`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name })
        });
        return await response.json();
    } catch (error) {
        console.error('Error creating staff:', error);
        throw error;
    }
};

export const deleteStaff = async (staffId) => {
    try {
        const response = await fetch(`${API_BASE}/salon/staff/${staffId}`, { method: 'DELETE' });
        return await response.json();
    } catch (error) {
        console.error('Error deleting staff:', error);
        throw error;
    }
};

// --- Services ---

export const fetchMasterServices = async (genderFocus) => {
    try {
        const response = await fetch(`${API_BASE}/services/master/${genderFocus}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching master services:', error);
        throw error;
    }
};

export const fetchSalonServices = async (salonId) => {
    try {
        const response = await fetch(`${API_BASE}/salon/services/${salonId}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching salon services:', error);
        throw error;
    }
};

export const updateSalonServices = async (salonId, services) => {
    try {
        const response = await fetch(`${API_BASE}/salon/services/${salonId}`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ services })
        });
        return await response.json();
    } catch (error) {
        console.error('Error updating salon services:', error);
        throw error;
    }
};

// --- Salon Profile ---

export const fetchSalonProfile = async (userId) => {
    try {
        const response = await fetch(`${API_BASE}/user/profile`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ user_type: 'salon', userId })
        });
        return await response.json();
    } catch (error) {
        console.error('Error fetching salon profile:', error);
        throw error;
    }
};

export const updateSalonInfo = async (salonId, data) => {
    try {
        const response = await fetch(`${API_BASE}/salon/info/${salonId}`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (error) {
        console.error('Error updating salon info:', error);
        throw error;
    }
};

export const uploadSalonImage = async (salonId, formData) => {
    try {
        const response = await fetch(`${API_BASE}/upload?salon_id=${salonId}`, {
            method: 'POST',
            body: formData // Content-Type is set automatically by browser with boundary
        });
        if (!response.ok) throw new Error('Upload failed');
        return await response.json();
    } catch (error) {
        console.error('Error uploading image:', error);
        throw error;
    }
};

// --- Schedule & Modifications ---

export const fetchSchedule = async (salonId) => {
    try {
        const response = await fetch(`${API_BASE}/salon/schedule/${salonId}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching schedule:', error);
        throw error;
    }
};

export const createBlockedTime = async (salonId, data) => {
    try {
        const response = await fetch(`${API_BASE}/salon/schedule/modification/${salonId}`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (error) {
        console.error('Error creating blocked time:', error);
        throw error;
    }
};

export const deleteBlockedTime = async (modId) => {
    try {
        const response = await fetch(`${API_BASE}/salon/schedule/modification/${modId}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        return await response.json();
    } catch (error) {
        console.error('Error deleting blocked time:', error);
        throw error;
    }
};

// --- Financials ---

export const fetchInvoices = async (salonId) => {
    try {
        const response = await fetch(`${API_BASE}/salon/payments/${salonId}`, {
            headers: getHeaders()
        });
        return await response.json();
    } catch (error) {
        console.error('Error fetching invoices:', error);
        throw error;
    }
};

// --- Reviews ---

export const fetchReviews = async (salonId) => {
    try {
        const response = await fetch(`${API_BASE}/reviews/salon/${salonId}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching reviews:', error);
        throw error;
    }
};

// --- Role Management ---

export const fetchRoleStatus = async (salonId) => {
    const response = await fetch(`${API_BASE}/salon/roles/${salonId}`);
    return await response.json();
};

export const verifySession = async (salonId, token) => {
    const response = await fetch(`${API_BASE}/salon/roles/${salonId}/verify`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ session_token: token })
    });
    return await response.json();
};
