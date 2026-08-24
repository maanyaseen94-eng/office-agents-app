// auth.js — مصادقة عبر JWT مخزّن في كوكي httpOnly (بدل جلسات الخادم التقليدية)
// السبب: على استضافة لا-خادمية (Vercel) لا توجد ذاكرة سيرفر دائمة بين الطلبات،
// فتُستبدل جلسات express-session بترميز موقَّع (JWT) يحمل هوية المستخدم ودوره،
// ويُتحقق منه في كل طلب دون الحاجة لتخزين أي حالة على الخادم.
const jwt = require('jsonwebtoken');

const SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'turquoise-office-secret-change-me';
const COOKIE_NAME = 'auth_token';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // أسبوع

function issueToken(res, user) {
  const token = jwt.sign({ userId: user.id, role: user.role }, SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS
  });
}

function clearToken(res) {
  res.clearCookie(COOKIE_NAME);
}

function readToken(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const payload = readToken(req);
  if (!payload) return res.status(401).json({ error: 'يرجى تسجيل الدخول' });
  req.user = { id: payload.userId, role: payload.role };
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const payload = readToken(req);
    if (!payload) return res.status(401).json({ error: 'يرجى تسجيل الدخول' });
    if (!roles.includes(payload.role)) {
      return res.status(403).json({ error: 'لا تملك صلاحية القيام بهذا الإجراء' });
    }
    req.user = { id: payload.userId, role: payload.role };
    next();
  };
}

module.exports = { requireAuth, requireRole, issueToken, clearToken };
