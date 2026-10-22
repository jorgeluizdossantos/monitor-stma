const crypto = require('crypto');
const argon2 = require('argon2');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_SCHEME = 'scrypt';
const PASSWORD_PLACEHOLDER = 'ALTERAR_COM_HASH_SEGURO';

function isScryptHash(value) {
  return typeof value === 'string' && value.startsWith(`${PASSWORD_SCHEME}$`);
}

function isArgonHash(value) {
  return typeof value === 'string' && value.startsWith('$argon2');
}

function isHashedPassword(value) {
  return isScryptHash(value) || isArgonHash(value);
}

function needsRehash(value) {
  return Boolean(value) && !isHashedPassword(value) && value !== PASSWORD_PLACEHOLDER;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(String(password), salt, 64);
  return `${PASSWORD_SCHEME}$${salt}$${Buffer.from(derivedKey).toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash || storedHash === PASSWORD_PLACEHOLDER) {
    return false;
  }

  if (isArgonHash(storedHash)) {
    return argon2.verify(storedHash, String(password));
  }

  if (!isScryptHash(storedHash)) {
    return String(password) === String(storedHash);
  }

  const [, salt, hash] = storedHash.split('$');
  if (!salt || !hash) {
    return false;
  }

  const derivedKey = await scryptAsync(String(password), salt, 64);
  const storedBuffer = Buffer.from(hash, 'hex');
  const derivedBuffer = Buffer.from(derivedKey);

  if (storedBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedBuffer, derivedBuffer);
}

module.exports = {
  PASSWORD_PLACEHOLDER,
  hashPassword,
  verifyPassword,
  isHashedPassword,
  needsRehash
};
