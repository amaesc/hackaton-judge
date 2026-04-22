// auth.js - JWT auth middleware
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (() => {
    const secret = crypto.randomBytes(32).toString('hex');
    console.log(
      '⚠️  No JWT_SECRET set. Generated an ephemeral one (tokens invalidate on restart).'
    );
    console.log('   Set JWT_SECRET env var to a random 32+ char string for production.\n');
    return secret;
  })();

const COOKIE_NAME = 'hj_session';
const TOKEN_TTL = '12h';

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, username: user.username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

export function authenticate(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Soft auth: attaches user if valid token, otherwise continues
export function softAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {}
  }
  next();
}
