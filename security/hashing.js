const bcrypt = require('bcrypt');

/**
 * Hash a password securely using bcrypt.
 * @param {string} password - The plain text password.
 * @returns {Promise<string>} - The hashed password.
 */
async function hashPassword(password) {
    const saltRounds = 12; // Higher salt rounds for better security
    return await bcrypt.hash(password, saltRounds);
}

/**
 * Verify a password against a hash.
 * @param {string} password - The plain text password.
 * @param {string} hashedPassword - The stored hash.
 * @returns {Promise<boolean>} - True if match, false otherwise.
 */
async function verifyPassword(password, hashedPassword) {
    return await bcrypt.compare(password, hashedPassword);
}

/**
 * Hash a PIN securely using bcrypt.
 * @param {string|number} pin - The plain text PIN.
 * @returns {Promise<string>} - The hashed PIN.
 */
async function hashPin(pin) {
    return await bcrypt.hash(pin.toString(), 10);
}

/**
 * Verify a PIN against a hash.
 * @param {string|number} pin - The plain text PIN.
 * @param {string} hashedPin - The stored hash.
 * @returns {Promise<boolean>} - True if match, false otherwise.
 */
async function verifyPin(pin, hashedPin) {
    return await bcrypt.compare(pin.toString(), hashedPin);
}

module.exports = {
    hashPassword,
    verifyPassword,
    hashPin,
    verifyPin
};
