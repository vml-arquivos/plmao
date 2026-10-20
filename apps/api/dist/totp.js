import { createCipheriv, createDecipheriv, createHmac, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './config.js';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const KEY = Buffer.from(hkdfSync('sha256', Buffer.from(env.JWT_SECRET, 'utf8'), Buffer.from('PLACA-NA-MAO-TOTP-SALT', 'utf8'), Buffer.from('Placa na Mao team TOTP encryption v1', 'utf8'), 32));
function base32Encode(input) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of input) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
            value = bits ? value & ((1 << bits) - 1) : 0;
        }
    }
    if (bits > 0)
        output += BASE32[(value << (5 - bits)) & 31];
    return output;
}
function base32Decode(value) {
    const normalized = value.toUpperCase().replace(/=|\s+/g, '');
    let bits = 0;
    let current = 0;
    const output = [];
    for (const character of normalized) {
        const index = BASE32.indexOf(character);
        if (index < 0)
            throw new Error('TOTP_SECRET_INVALID');
        current = (current << 5) | index;
        bits += 5;
        if (bits >= 8) {
            output.push((current >>> (bits - 8)) & 255);
            bits -= 8;
            current = bits ? current & ((1 << bits) - 1) : 0;
        }
    }
    return Buffer.from(output);
}
function normalizeCode(code) {
    return code.trim();
}
function hotp(secret, counter) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac('sha1', secret).update(buffer).digest();
    const offset = digest[digest.length - 1] & 15;
    const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
    return String(binary % 1_000_000).padStart(6, '0');
}
export function generateTotpSetup(email) {
    const secret = base32Encode(randomBytes(20));
    const label = encodeURIComponent(`PlacaNaMao:${email}`);
    const issuer = encodeURIComponent('Placa na Mao');
    return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
}
export function verifyTotpCode(secret, code, nowMs = Date.now()) {
    const normalized = normalizeCode(code);
    if (!/^\d{6}$/.test(normalized))
        return false;
    const key = base32Decode(secret);
    const step = Math.floor(nowMs / 1000 / 30);
    const candidate = Buffer.from(normalized);
    for (const offset of [-1, 0, 1]) {
        if (step + offset < 0)
            continue;
        const expected = Buffer.from(hotp(key, step + offset));
        if (candidate.length === expected.length && timingSafeEqual(candidate, expected))
            return true;
    }
    return false;
}
export function encryptTotpSecret(secret) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', KEY, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}
export function decryptTotpSecret(payload) {
    const [version, ivText, tagText, dataText] = payload.split(':');
    if (version !== 'v1' || !ivText || !tagText || !dataText)
        throw new Error('TOTP_SECRET_INVALID');
    const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}
export function generateRecoveryCodes(count = 8) {
    return Array.from({ length: count }, () => {
        const raw = randomBytes(5).toString('hex').toUpperCase();
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
}
export function hashRecoveryCode(code) {
    return createHash('sha256').update(code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()).digest('hex');
}
export function normalizeRecoveryCode(code) {
    return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
