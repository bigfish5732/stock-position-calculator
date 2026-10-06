'use strict';
const path = require('path');
const express = require('express');
const { db, hashPassword, verifyPassword, newToken } = require('./db');
const { calcPortfolio, calcPosition } = require('./calc');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 30;

function nowIso() { return new Date().toISOString(); }

// ---------- 会话 ----------
function getSession(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const row = db.prepare(
    'SELECT s.token, s.user_id, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ).get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { userId: row.user_id, username: row.username, token };
}

function requireAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: '未登录或登录已过期' });
  req.session = s;
  next();
}

// ---------- 认证 ----------
app.post('/api/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 2 || username.length > 30) return res.status(400).json({ error: '用户名需 2-30 个字符' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: '用户名已存在' });
  const { salt, hash } = hashPassword(password);
  const info = db.prepare('INSERT INTO users (username, password_hash, password_salt, created_at) VALUES (?,?,?,?)')
    .run(username, hash, salt, nowIso());
  db.prepare('INSERT INTO settings (user_id, total_capital, max_stocks, max_single_pct, lot_size, updated_at) VALUES (?,?,?,?,?,?)')
    .run(info.lastInsertRowid, 100000, 5, 20, 100, nowIso());
  res.json({ ok: true, message: '注册成功，请登录' });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, user.id, nowIso(), expires);
  res.json({ ok: true, token, username: user.username });
});

app.post('/api/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.session.token);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.session.userId) || {};
  res.json({ userId: req.session.userId, username: req.session.username, settings });
});

// ---------- 设置 ----------
app.put('/api/settings', requireAuth, (req, res) => {
  const b = req.body;
  const totalCapital = Math.max(0, Number(b.totalCapital) || 0);
  const maxStocks = Math.max(1, Math.floor(Number(b.maxStocks) || 1));
  const maxSinglePct = Math.min(100, Math.max(0.1, Number(b.maxSinglePct) || 20));
  const lotSize = Math.max(1, Math.floor(Number(b.lotSize) || 100));
  db.prepare(`INSERT INTO settings (user_id, total_capital, max_stocks, max_single_pct, lot_size, updated_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(user_id) DO UPDATE SET
                total_capital = excluded.total_capital,
                max_stocks = excluded.max_stocks,
                max_single_pct = excluded.max_single_pct,
                lot_size = excluded.lot_size,
                updated_at = excluded.updated_at`)
    .run(req.session.userId, totalCapital, maxStocks, maxSinglePct, lotSize, nowIso());
  res.json({ ok: true, settings: { totalCapital, maxStocks, maxSinglePct, lotSize } });
});

// ---------- 持仓 ----------
app.post('/api/positions', requireAuth, (req, res) => {
  const b = req.body;
  const stockName = String(b.stockName || '').trim();
  const price = Number(b.price) || 0;
  const shares = Math.floor(Number(b.shares) || 0);
  if (!stockName) return res.status(400).json({ error: '请填写股票名称' });
  if (price <= 0 || shares <= 0) return res.status(400).json({ error: '价格和股数必须大于 0' });
  const amount = Math.round(shares * price * 100) / 100;
  const info = db.prepare(`INSERT INTO positions
    (user_id, stock_name, stock_code, price, shares, amount, stop_loss_pct, take_profit_pct, add_times, note, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.session.userId, stockName, String(b.stockCode || '').trim(), price, shares, amount,
      Number(b.stopLossPct) || 0, Number(b.takeProfitPct) || 0, Math.floor(Number(b.addTimes) || 0),
      String(b.note || '').trim(), nowIso());
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.get('/api/positions', requireAuth, (req, res) => {
  const positions = db.prepare('SELECT * FROM positions WHERE user_id = ? ORDER BY id DESC').all(req.session.userId);
  res.json({ positions });
});

app.delete('/api/positions/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM positions WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.session.userId);
  res.json({ ok: true });
});

// ---------- 汇总（首页超仓提醒） ----------
app.get('/api/summary', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.session.userId)
    || { total_capital: 0, max_stocks: 5, max_single_pct: 20, lot_size: 100 };
  const positions = db.prepare('SELECT * FROM positions WHERE user_id = ? ORDER BY id DESC').all(req.session.userId);
  const totalAmount = Math.round(positions.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  const capital = settings.total_capital || 0;
  const singleCap = Math.round(capital * (settings.max_single_pct || 0) / 100 * 100) / 100;
  const overCapital = capital > 0 && totalAmount > capital;
  const overSingle = positions.filter(p => p.amount > singleCap + 1e-6).map(p => p.stock_name);
  res.json({ settings, positions, totalAmount, capital, singleCap, overCapital, overSingle });
});

// ---------- 计算接口（服务端兜底） ----------
app.post('/api/calc', (req, res) => {
  res.json({ result: calcPosition(req.body || {}) });
});

app.post('/api/portfolio', (req, res) => {
  const b = req.body || {};
  res.json({ result: calcPortfolio(b.totalCapital, b.maxStocks) });
});

// 兜底：前端路由（SPA 只有一个 index.html）
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('股票仓位计算器已启动: http://localhost:' + PORT);
});
