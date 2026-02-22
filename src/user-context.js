const os = require('os');
const crypto = require('crypto');

function sanitize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
}

function computeDefaultUserId() {
  const username = sanitize(os.userInfo()?.username || process.env.USER || 'user');
  const hostname = sanitize(os.hostname() || 'host');
  const hash = crypto
    .createHash('sha1')
    .update(`${username}@${hostname}`)
    .digest('hex')
    .slice(0, 10);
  return `${username}-${hash}`;
}

function getUserId() {
  const explicit = process.env.AMAPRICE_USER_ID || process.env.USER_ID || process.env.USER;
  if (explicit && String(explicit).trim()) {
    return sanitize(explicit);
  }
  return computeDefaultUserId();
}

module.exports = {
  getUserId,
  computeDefaultUserId,
};
