// api/crypto-helper.js - Utilitats de xifrat i desxifrat segur amb AES-256-GCM
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recomanat per GCM
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Xifra les credencials amb una clau secreta usant AES-256-GCM
 * @param {Object} credentials - { username, password }
 * @param {string} secretKey - Clau secreta (passphrase)
 * @returns {string} Payload xifrat en Base64
 */
function encryptCredentials(credentials, secretKey) {
    if (!credentials || !credentials.username || !credentials.password) {
        throw new Error('Credencials incompletes per xifrar');
    }
    if (!secretKey || typeof secretKey !== 'string') {
        throw new Error('Cal especificar una clau secreta vàlida');
    }

    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = crypto.scryptSync(secretKey, salt, 32);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const textData = JSON.stringify(credentials);
    const encrypted = Buffer.concat([cipher.update(textData, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload = {
        s: salt.toString('base64'),
        i: iv.toString('base64'),
        t: authTag.toString('base64'),
        d: encrypted.toString('base64'),
        v: 1
    };

    return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Desxifra les credencials usant la clau secreta
 * @param {string} encryptedBase64 - Payload en Base64
 * @param {string} secretKey - Clau secreta utilitzada en el xifrat
 * @returns {Object} { username, password }
 */
function decryptCredentials(encryptedBase64, secretKey) {
    if (!encryptedBase64 || !secretKey) {
        throw new Error('Cal el payload xifrat i la clau secreta');
    }

    try {
        const rawJson = Buffer.from(encryptedBase64, 'base64').toString('utf8');
        const payload = JSON.parse(rawJson);

        const salt = Buffer.from(payload.s, 'base64');
        const iv = Buffer.from(payload.i, 'base64');
        const authTag = Buffer.from(payload.t, 'base64');
        const encryptedData = Buffer.from(payload.d, 'base64');

        const key = crypto.scryptSync(secretKey, salt, 32);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
        return JSON.parse(decrypted.toString('utf8'));
    } catch (err) {
        throw new Error('Error al desxifrar credencials: clau incorrecta o dades corruptes');
    }
}

/**
 * Obté les credencials des de les variables d'entorn o fallback al request body
 * @param {Object} [fallbackCreds] - Credencials enviades opcionalment pel client
 * @returns {Object|null} { username, password }
 */
function resolveCredentials(fallbackCreds = null) {
    // 1. Prioritat: Variables xifrades
    const encData = process.env.BETA10_ENCRYPTED_CREDS || process.env.BETA10_AUTH_ENCRYPTED;
    const secretKey = process.env.BETA10_SECRET_KEY || process.env.BETA10_ENCRYPTION_KEY;

    if (encData && secretKey) {
        try {
            const creds = decryptCredentials(encData, secretKey);
            if (creds && creds.username && creds.password) {
                return { ...creds, source: 'env_encrypted' };
            }
        } catch (e) {
            console.error('⚠️ Error desxifrant BETA10_ENCRYPTED_CREDS:', e.message);
        }
    }

    // 2. Prioritat: Variables en text clar a l'entorn (opcional)
    if (process.env.BETA10_USERNAME && process.env.BETA10_PASSWORD) {
        return {
            username: process.env.BETA10_USERNAME,
            password: process.env.BETA10_PASSWORD,
            source: 'env_plain'
        };
    }

    // 3. Fallback: Credencials del client
    if (fallbackCreds && fallbackCreds.username && fallbackCreds.password) {
        return {
            username: fallbackCreds.username,
            password: fallbackCreds.password,
            source: 'client'
        };
    }

    return null;
}

module.exports = {
    encryptCredentials,
    decryptCredentials,
    resolveCredentials
};
