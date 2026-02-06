// Validate phone number format (must start with 0 and be exactly 10 digits)
function validatePhoneFormat(phone) {
    if (!phone) return true; // Allow empty for optional fields
    const phonePattern = /^0[0-9]{9}$/;
    return phonePattern.test(phone);
}

// Normalize phone numbers to a canonical form for duplicate checks and login.
// Strategy:
// - Remove all non-digits
// - Strip leading international prefixes and country codes (00, +970, +972)
// - Strip trunk leading zero
// - Compare by last 10 digits (operator+subscriber), which unifies formats like:
//   0594444403, +970594444403, +972594444403, 594444403
function normalizePhoneNumber(input) {
    if (!input) return '';
    let digits = String(input).replace(/\D/g, '');
    // Remove international call prefix like '00'
    if (digits.startsWith('00')) digits = digits.replace(/^00+/, '');
    // Remove common country codes used in our region
    if (digits.startsWith('970')) digits = digits.slice(3);
    else if (digits.startsWith('972')) digits = digits.slice(3);
    // Remove local trunk prefix '0'
    if (digits.startsWith('0')) digits = digits.slice(1);
    // Unify to last 10 digits
    if (digits.length > 10) digits = digits.slice(-10);
    return digits;
}

module.exports = {
    validatePhoneFormat,
    normalizePhoneNumber
};
