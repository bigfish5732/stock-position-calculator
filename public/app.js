'use strict';

/* ================= 工具 ================= */
const $ = (sel) => document.querySelector(sel);
const fmtMoney = (n) => Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n) => Number(n || 0).toLocaleString('zh-CN');
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, type) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'show ' + (type || '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, 2400);
}

/* ================= 计算（与后端 calc.js 一致） ================= */
function calcPortfolio(totalCapital, maxStocks) {
  const capital = Number(totalCapital) || 0;
  const stocks = Math.max(1, Math.floor(Number(maxStocks) || 1));
  return { maxStocks: stocks, perStockPct: round2(100 / stocks), perStockAmount: round2(capital / stocks) };
}

function calcPosition(p) {
  const totalCapital = Number(p.totalCapital) || 0;
  const price = Number(p.price) || 0;
  const maxSinglePct = Number(p.maxSinglePct) || 0;
  const stopLossPct = Number(p.stopLossPct) || 0;
  const takeProfitPct = Number(p.takeProfitPct) || 0;
  const addTimes = Math.max(0, Math.floor(Number(p.addTimes) || 0));
  const lotSize = Math.max(1, Math.floor(Number(p.lotSize) || 100));
  const tpSellPct = clamp(Number(p.tpSellPct ?? 50) || 0, 0, 100);
  const slSellPct = clamp(Number(p.slSellPct ?? 50) || 0, 0, 100);

  const capAmount = totalCapital * maxSinglePct / 100;
  const maxLots = (price > 0 && lotSize > 0) ? Math.floor(capAmount / price / lotSize) : 0;
  const maxShares = maxLots * lotSize;
  const actualCapAmount = round2(maxShares * price);

  const totalLots = maxLots;
  const numBatches = Math.max(1, Math.min(addTimes + 1, Math.max(1, totalLots)));
  const baseLots = Math.floor(totalLots / numBatches);
  const remLots = totalLots - baseLots * numBatches;
  const names = ['第一次买入', '第二次买入', '第三次买入', '第四次买入', '第五次买入',
    '第六次买入', '第七次买入', '第八次买入', '第九次买入', '第十次买入'];
  const batches = [];
  for (let i = 0; i < numBatches; i++) {
    const lots = baseLots + (i < remLots ? 1 : 0);
    const shares = lots * lotSize;
    const amount = round2(shares * price);
    batches.push({
      index: i + 1,
      name: names[i] || ('第' + (i + 1) + '次买入'),
      shares, amount,
      stopLossLoss: round2(amount * stopLossPct / 100),
      takeProfitGain: round2(amount * takeProfitPct / 100),
    });
  }

  const stopLossPrice = round2(price * (1 - stopLossPct / 100));
  const takeProfitPrice = round2(price * (1 + takeProfitPct / 100));
  const totalStopLoss = round2(actualCapAmount * stopLossPct / 100);
  const totalTakeProfit = round2(actualCapAmount * takeProfitPct / 100);

  const tpSellShares = Math.floor(maxShares * tpSellPct / 100 / lotSize) * lotSize;
  const tpKeepShares = maxShares - tpSellShares;
  const tpSellAmount = round2(tpSellShares * takeProfitPrice);
  const tpLockedProfit = round2(tpSellShares * (takeProfitPrice - price));
  const tpKeepAmount = round2(tpKeepShares * takeProfitPrice);

  const slSellShares = Math.floor(maxShares * slSellPct / 100 / lotSize) * lotSize;
  const slKeepShares = maxShares - slSellShares;
  const slSellAmount = round2(slSellShares * stopLossPrice);
  const slReducedLoss = round2(slSellShares * (price - stopLossPrice));
  const slFullLoss = round2(maxShares * (price - stopLossPrice));

  return {
    capAmount: round2(capAmount), maxLots, maxShares, actualCapAmount, numBatches, batches,
    stopLossPrice, takeProfitPrice, totalStopLoss, totalTakeProfit,
    tpSellPct, tpSellShares, tpKeepShares, tpSellAmount, tpLockedProfit, tpKeepAmount,
    slSellPct, slSellShares, slKeepShares, slSellAmount, slReducedLoss, slFullLoss,
  };
}

/* ================= 状态与 API ================= */
const state = {
  token: localStorage.getItem('token') || '',
  username: '',
  page: 'home',
  settings: { total_capital: 0, max_stocks: 5, max_single_pct: 20, lot_size: 100 },
  positions: [],
  calcResult: null,
  lastCalcParams: null,
};

async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || ('请求失败(' + res.status + ')'));
  return data;
}

async function loadMe() {
  const data = await api('GET', '/api/me');
  state.username = data.username;
  const s = data.settings || {};
  state.settings = {
    total_capital: Number(s.total_capital) || 0,
    max_stocks: Number(s.max_stocks) || 5,
    max_single_pct: Number(s.max_single_pct) || 20,
    lot_size: Number(s.lot_size) || 100,
  };
}

async function loadSummary() {
  const data = await api('GET', '/api/summary');
  const s = data.settings || {};
  state.settings = {
    total_capital: Number(s.total_capital) || 0,
    max_stocks: Number(s.max_stocks) || 5,
    max_single_pct: Number(s.max_single_pct) || 20,
    lot_size: Number(s.lot_size) || 100,
  };
  state.positions = data.positions || [];
}

/* ================= 认证 ================= */
let authMode = 'login';

function showAuth() {
  $('#auth-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
}
function showApp() {
  $('#auth-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
}

function setAuthMode(mode) {
  authMode = mode;
  $('#tab-login').classList.toggle('active', mode === 'login');
  $('#tab-register').classList.toggle('active', mode === 'register');
  $('#auth-submit').textContent = mode === 'login' ? '登录' : '注册';
  const msg = $('#auth-msg');
  msg.textContent = ''; msg.className = 'msg';
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  const msg = $('#auth-msg');
  msg.className = 'msg'; msg.textContent = '';
  if (!username || !password) { msg.textContent = '请填写用户名和密码'; msg.classList.add('err'); return; }
  try {
    if (authMode === 'login') {
      const data = await api('POST', '/api/login', { username, password });
      state.token = data.token;
      state.username = data.username;
      localStorage.setItem('token', data.token);
      await loadSummary();
      showApp();
      switchPage('home');
    } else {
      await api('POST', '/api/register', { username, password });
      msg.textContent = '注册成功，请登录'; msg.classList.add('ok');
      $('#auth-password').value = '';
      setAuthMode('login');
    }
  } catch (err) {
    msg.textContent = err.message; msg.classList.add('err');
  }
}

/* ================= 导航 ================= */
function switchPage(name) {
  state.page = name;
  ['home', 'calc', 'positions', 'settings'].forEach(p => {
    $('#page-' + p).classList.toggle('hidden', p !== name);
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  $('#who').textContent = state.username || '';
  if (name === 'home') renderHome();
  else if (name === 'calc') renderCalc();
  else if (name === 'positions') renderPositions();
  else if (name === 'settings') renderSettings();
}

function renderAll() { switchPage(state.page); }

/* ================= 首页 ================= */
function renderHome() {
  const s = state.settings;
  const cap = Number(s.total_capital) || 0;
  const pf = calcPortfolio(cap, s.max_stocks);
  const totalAmount = state.positions.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const singleCap = cap * (Number(s.max_single_pct) || 0) / 100;
  const overCapital = cap > 0 && totalAmount > cap;
  const overSingle = state.positions.filter(p => Number(p.amount) > singleCap + 1e-6);

  let alerts = '';
  if (cap <= 0) alerts += '<div class="alert info">还没有设置本金，请在「设置」里填写本金。</div>';
  if (overCapital) alerts += '<div class="alert danger">⚠️ 总持仓金额 ' + fmtMoney(totalAmount) + ' 已超过本金 ' + fmtMoney(cap) + '，超仓 ' + fmtMoney(totalAmount - cap) + '，请减仓！</div>';
  if (overSingle.length) alerts += '<div class="alert warn">⚠️ 单票超仓：' + overSingle.map(p => esc(p.stock_name) + '(' + fmtMoney(p.amount) + ')').join('、') + ' 超过单票上限 ' + fmtMoney(singleCap) + '。</div>';

  $('#page-home').innerHTML =
    '<div class="page-title">你好，' + esc(state.username) + '</div>' +
    alerts +
    '<div class="card">' +
      '<h2>💰 总金额 → 仓位规划</h2>' +
      '<div class="grid2">' +
        '<label class="field"><span>总金额（本金）</span><input id="h-capital" type="number" min="0" step="1000" value="' + (cap || '') + '" placeholder="如 100000"></label>' +
        '<label class="field"><span>最多买几只股票</span><input id="h-stocks" type="number" min="1" step="1" value="' + s.max_stocks + '"></label>' +
      '</div>' +
      '<div class="grid2" style="margin-top:12px">' +
        '<div class="stat"><div class="k">单票仓位上限</div><div class="v amber">' + pf.perStockPct + '%</div></div>' +
        '<div class="stat"><div class="k">单票金额上限</div><div class="v">' + fmtMoney(pf.perStockAmount) + '</div></div>' +
      '</div>' +
      '<p class="hint">按单票仓位上限分配资金：最多买 ' + s.max_stocks + ' 只，每只最多 ' + pf.perStockPct + '% ≈ ' + fmtMoney(pf.perStockAmount) + ' 元，单票总投入不要超过此金额，否则视为超仓。</p>' +
      '<div class="form-actions">' +
        '<button id="h-apply" class="btn primary">保存为本金设置</button>' +
        '<button id="h-gocalc" class="btn">去计算某只股票 →</button>' +
      '</div>' +
    '</div>' +
    '<div class="card">' +
      '<h2>📋 当前持仓汇总</h2>' +
      '<div class="grid3">' +
        '<div class="stat"><div class="k">持仓股票数</div><div class="v">' + state.positions.length + '</div></div>' +
        '<div class="stat"><div class="k">总持仓金额</div><div class="v ' + (overCapital ? 'red' : '') + '">' + fmtMoney(totalAmount) + '</div></div>' +
        '<div class="stat"><div class="k">剩余可用</div><div class="v green">' + fmtMoney(Math.max(0, cap - totalAmount)) + '</div></div>' +
      '</div>' +
      (state.positions.length === 0 ? '<p class="hint">还没有保存的持仓。去「仓位计算」算好后一键保存即可。</p>' : '') +
    '</div>';

  $('#h-apply').addEventListener('click', async () => {
    const totalCapital = Number($('#h-capital').value) || 0;
    const maxStocks = Math.max(1, Math.floor(Number($('#h-stocks').value) || 1));
    if (totalCapital <= 0) { toast('请先填写总金额', 'err'); return; }
    try {
      const data = await api('PUT', '/api/settings', {
        totalCapital, maxStocks,
        max_single_pct: state.settings.max_single_pct,
        lot_size: state.settings.lot_size,
      });
      state.settings = data.settings;
      await loadSummary();
      renderAll();
      toast('已保存', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#h-gocalc').addEventListener('click', () => switchPage('calc'));
}

/* ================= 仓位计算 ================= */
function renderCalc() {
  const s = state.settings;
  const last = state.lastCalcParams || {};
  const v = (key, def) => (last[key] !== undefined ? last[key] : def);
  const lot = v('lotSize', s.lot_size);

  $('#page-calc').innerHTML =
    '<div class="page-title">🧮 单只股票仓位计算</div>' +
    '<div class="card">' +
      '<h2>输入参数</h2>' +
      '<div class="grid2">' +
        '<label class="field"><span>股票名称 *</span><input id="c-name" value="' + esc(v('stockName', '')) + '" placeholder="如 剑桥科技"></label>' +
        '<label class="field"><span>股票代码（可选）</span><input id="c-code" value="' + esc(v('stockCode', '')) + '" placeholder="如 603083"></label>' +
      '</div>' +
      '<div class="grid2">' +
        '<label class="field"><span>当前价格 / 买入价 *</span><input id="c-price" type="number" min="0.01" step="0.01" value="' + (v('price', '') || '') + '" placeholder="如 100"></label>' +
        '<label class="field"><span>每手股数</span><select id="c-lot">' +
          '<option value="100"' + (lot == 100 ? ' selected' : '') + '>100 股（A股）</option>' +
          '<option value="1"' + (lot == 1 ? ' selected' : '') + '>1 股（美股/港股）</option>' +
        '</select></label>' +
      '</div>' +
      '<div class="grid2">' +
        '<label class="field"><span>止损比例（%）</span><input id="c-sl" type="number" min="0" step="0.5" value="' + v('stopLossPct', 10) + '"></label>' +
        '<label class="field"><span>止盈比例（%）</span><input id="c-tp" type="number" min="0" step="0.5" value="' + v('takeProfitPct', 20) + '"></label>' +
      '</div>' +
      '<div class="grid2">' +
        '<label class="field"><span>加仓次数（0=不分批）</span><input id="c-add" type="number" min="0" step="1" value="' + v('addTimes', 0) + '"></label>' +
        '<label class="field"><span>单票仓位上限（%）</span><input id="c-maxpct" type="number" min="0.1" step="0.5" value="' + v('maxSinglePct', s.max_single_pct) + '"></label>' +
      '</div>' +
      '<div class="grid2">' +
        '<label class="field"><span>止盈时卖出比例（%）</span><input id="c-tpsell" type="number" min="0" step="5" value="' + v('tpSellPct', 50) + '"></label>' +
        '<label class="field"><span>止损时减仓比例（%）</span><input id="c-slsell" type="number" min="0" step="5" value="' + v('slSellPct', 50) + '"></label>' +
      '</div>' +
      '<p class="hint">本金 ' + fmtMoney(s.total_capital) + ' 元 · 单票仓位上限 ' + s.max_single_pct + '%（可在「设置」修改）</p>' +
      '<div class="form-actions"><button id="c-run" class="btn primary">🧮 开始计算</button></div>' +
    '</div>' +
    '<div id="c-result"></div>';

  $('#c-run').addEventListener('click', runCalc);
  if (state.calcResult && state.lastCalcParams) renderCalcResult(state.calcResult, state.lastCalcParams);
}

function runCalc() {
  const params = {
    stockName: $('#c-name').value.trim(),
    stockCode: $('#c-code').value.trim(),
    price: Number($('#c-price').value),
    lotSize: Number($('#c-lot').value),
    stopLossPct: Number($('#c-sl').value) || 0,
    takeProfitPct: Number($('#c-tp').value) || 0,
    addTimes: Math.floor(Number($('#c-add').value) || 0),
    maxSinglePct: Number($('#c-maxpct').value) || 0,
    tpSellPct: Number($('#c-tpsell').value) || 0,
    slSellPct: Number($('#c-slsell').value) || 0,
    totalCapital: Number(state.settings.total_capital) || 0,
  };
  if (!params.stockName) { toast('请填写股票名称', 'err'); return; }
  if (!(params.price > 0)) { toast('请填写正确的当前价格', 'err'); return; }
  if (!(params.totalCapital > 0)) { toast('请先在「设置」或首页填写本金', 'err'); return; }
  if (!(params.maxSinglePct > 0)) { toast('单票仓位上限需大于 0', 'err'); return; }

  const result = calcPosition(params);
  state.lastCalcParams = params;
  state.calcResult = result;
  renderCalcResult(result, params);
  setTimeout(() => { const el = $('#c-result'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
}

function renderCalcResult(r, p) {
  const rows = r.batches.map(b =>
    '<tr><td>' + b.name + '</td><td>' + fmtNum(b.shares) + ' 股</td><td>' + fmtMoney(b.amount) +
    '</td><td class="red">-' + fmtMoney(b.stopLossLoss) + '</td><td class="green">+' + fmtMoney(b.takeProfitGain) + '</td></tr>'
  ).join('');

  const batchesNote = r.numBatches === 1
    ? '加仓次数为 0，只买入一次，没有第二次、第三次。'
    : (r.numBatches < p.addTimes + 1
        ? '可买股数不足以分 ' + (p.addTimes + 1) + ' 批，实际按 ' + r.numBatches + ' 批买入。'
        : '共分 ' + r.numBatches + ' 次买入（加仓 ' + (r.numBatches - 1) + ' 次）。');

  $('#c-result').innerHTML =
    '<div class="card">' +
      '<h2>📊 计算结果</h2>' +

      '<div class="section-label"><span class="badge blue">单票最大仓位</span></div>' +
      '<div class="grid3">' +
        '<div class="stat"><div class="k">可买股数</div><div class="v">' + fmtNum(r.maxShares) + ' 股</div></div>' +
        '<div class="stat"><div class="k">占用金额</div><div class="v">' + fmtMoney(r.actualCapAmount) + '</div></div>' +
        '<div class="stat"><div class="k">占本金比例</div><div class="v amber">' + (p.totalCapital > 0 ? round2(r.actualCapAmount / p.totalCapital * 100) : 0) + '%</div></div>' +
      '</div>' +

      '<div class="section-label">🧱 分批买入计划 <span class="badge blue">' + r.numBatches + ' 批</span></div>' +
      '<table><thead><tr><th>批次</th><th>买入股数</th><th>买入金额</th><th>止损亏损</th><th>止盈盈利</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="hint">' + batchesNote + ' 每次买入均按当前价 ' + fmtMoney(p.price) + ' 元估算。</p>' +

      '<div class="section-label"><span class="badge red">🛑 止损方案</span></div>' +
      '<div class="grid2">' +
        '<div class="stat"><div class="k">止损价（跌 ' + p.stopLossPct + '%）</div><div class="v red">' + fmtMoney(r.stopLossPrice) + '</div></div>' +
        '<div class="stat"><div class="k">止损回撤（全卖最多亏）</div><div class="v red">-' + fmtMoney(r.totalStopLoss) + '</div></div>' +
      '</div>' +
      '<div class="kv"><span class="lbl">第一步 · 分批止损（先减仓 ' + p.slSellPct + '%）</span><span class="val">卖 ' + fmtNum(r.slSellShares) + ' 股 ≈ ' + fmtMoney(r.slSellAmount) + ' 元</span></div>' +
      '<div class="kv"><span class="lbl">减仓后少亏的钱</span><span class="val green">' + fmtMoney(r.slReducedLoss) + ' 元</span></div>' +
      '<div class="kv"><span class="lbl">剩余观察仓位</span><span class="val">' + fmtNum(r.slKeepShares) + ' 股</span></div>' +
      '<div class="kv"><span class="lbl">第二步 · 完全止损（全卖）</span><span class="val red">-' + fmtMoney(r.slFullLoss) + ' 元</span></div>' +
      '<p class="hint">跌到止损价先减仓 ' + p.slSellPct + '% 少亏一些；若继续下跌、无反弹迹象且基本面恶化，就全部卖出（完全止损），最多亏 ' + fmtMoney(r.slFullLoss) + ' 元。</p>' +

      '<div class="section-label"><span class="badge green">🎯 止盈方案</span></div>' +
      '<div class="grid2">' +
        '<div class="stat"><div class="k">止盈价（涨 ' + p.takeProfitPct + '%）</div><div class="v green">' + fmtMoney(r.takeProfitPrice) + '</div></div>' +
        '<div class="stat"><div class="k">全仓止盈最多赚</div><div class="v green">+' + fmtMoney(r.totalTakeProfit) + '</div></div>' +
      '</div>' +
      '<div class="kv"><span class="lbl">第一步 · 分批止盈（先卖 ' + p.tpSellPct + '%）</span><span class="val">卖 ' + fmtNum(r.tpSellShares) + ' 股 ≈ ' + fmtMoney(r.tpSellAmount) + ' 元</span></div>' +
      '<div class="kv"><span class="lbl">已锁定利润</span><span class="val green">+' + fmtMoney(r.tpLockedProfit) + ' 元</span></div>' +
      '<div class="kv"><span class="lbl">保留底仓</span><span class="val">' + fmtNum(r.tpKeepShares) + ' 股 ≈ ' + fmtMoney(r.tpKeepAmount) + ' 元</span></div>' +
      '<p class="hint">涨到止盈价先卖 ' + p.tpSellPct + '% 锁定部分利润，底仓保留继续博取上涨；若回落也保住了这部分利润。</p>' +

      '<div class="form-actions"><button id="c-save" class="btn primary">💾 保存这笔持仓</button></div>' +
    '</div>';

  $('#c-save').addEventListener('click', async () => {
    try {
      await api('POST', '/api/positions', {
        stockName: p.stockName,
        stockCode: p.stockCode,
        price: p.price,
        shares: r.maxShares,
        stopLossPct: p.stopLossPct,
        takeProfitPct: p.takeProfitPct,
        addTimes: p.addTimes,
        note: '买入价 ' + p.price + '，止损价 ' + r.stopLossPrice + '，止盈价 ' + r.takeProfitPrice,
      });
      await loadSummary();
      toast('已保存到「我的持仓」', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
}

/* ================= 我的持仓 ================= */
function renderPositions() {
  const s = state.settings;
  const cap = Number(s.total_capital) || 0;
  const singleCap = cap * (Number(s.max_single_pct) || 0) / 100;
  const totalAmount = state.positions.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  let alerts = '';
  if (cap > 0 && totalAmount > cap) alerts += '<div class="alert danger">⚠️ 总持仓 ' + fmtMoney(totalAmount) + ' 超过本金 ' + fmtMoney(cap) + '，已超仓！</div>';

  const items = state.positions.map(p => {
    const over = singleCap > 0 && Number(p.amount) > singleCap;
    return '<div class="pos-item">' +
      '<div class="pos-head"><div><span class="pos-name">' + esc(p.stock_name) + '</span>' + (p.stock_code ? ' <span class="pos-code">' + esc(p.stock_code) + '</span>' : '') + '</div>' +
      (over ? '<span class="badge red">超仓</span>' : '<span class="badge green">正常</span>') + '</div>' +
      '<div class="pos-row"><span class="lbl">持仓金额</span><span class="val">' + fmtMoney(p.amount) + '</span></div>' +
      '<div class="pos-row"><span class="lbl">成本价</span><span class="val">' + fmtMoney(p.price) + '</span></div>' +
      '<div class="pos-row"><span class="lbl">股数</span><span class="val">' + fmtNum(p.shares) + ' 股</span></div>' +
      '<div class="pos-row"><span class="lbl">止损 ' + Number(p.stop_loss_pct).toFixed(1) + '%</span><span class="val red">' + fmtMoney(round2(p.price * (1 - Number(p.stop_loss_pct) / 100))) + '</span></div>' +
      '<div class="pos-row"><span class="lbl">止盈 ' + Number(p.take_profit_pct).toFixed(1) + '%</span><span class="val green">' + fmtMoney(round2(p.price * (1 + Number(p.take_profit_pct) / 100))) + '</span></div>' +
      '<div class="pos-meta">加仓 ' + p.add_times + ' 次' + (p.note ? ' · ' + esc(p.note) : '') + ' · ' + (p.created_at || '').slice(0, 10) + '</div>' +
      '<div style="margin-top:10px;text-align:right"><button class="btn danger small" data-del="' + p.id + '">删除</button></div>' +
    '</div>';
  }).join('');

  $('#page-positions').innerHTML =
    '<div class="page-title">📋 我的持仓</div>' +
    alerts +
    '<div class="card">' +
      '<div class="grid3">' +
        '<div class="stat"><div class="k">持仓股票数</div><div class="v">' + state.positions.length + '</div></div>' +
        '<div class="stat"><div class="k">总持仓金额</div><div class="v">' + fmtMoney(totalAmount) + '</div></div>' +
        '<div class="stat"><div class="k">单票上限</div><div class="v amber">' + fmtMoney(singleCap) + '</div></div>' +
      '</div>' +
    '</div>' +
    (items || '<div class="card"><p class="hint">暂无持仓记录，去「仓位计算」算好并保存。</p></div>');

  document.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除这条持仓记录吗？')) return;
      try {
        await api('DELETE', '/api/positions/' + btn.dataset.del);
        await loadSummary();
        renderAll();
        toast('已删除', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    });
  });
}

/* ================= 设置 ================= */
function renderSettings() {
  const s = state.settings;
  $('#page-settings').innerHTML =
    '<div class="page-title">⚙️ 设置</div>' +
    '<div class="card">' +
      '<h2>资金与仓位参数</h2>' +
      '<label class="field"><span>本金（总金额）</span><input id="s-capital" type="number" min="0" step="1000" value="' + (s.total_capital || '') + '" placeholder="如 100000"></label>' +
      '<label class="field"><span>最多买几只股票</span><input id="s-stocks" type="number" min="1" step="1" value="' + s.max_stocks + '"></label>' +
      '<label class="field"><span>单票仓位上限（%）</span><input id="s-maxpct" type="number" min="0.1" step="0.5" value="' + s.max_single_pct + '"></label>' +
      '<label class="field"><span>每手股数</span><select id="s-lot">' +
        '<option value="100"' + (s.lot_size == 100 ? ' selected' : '') + '>100 股（A股）</option>' +
        '<option value="1"' + (s.lot_size == 1 ? ' selected' : '') + '>1 股（美股/港股）</option>' +
      '</select></label>' +
      '<div class="form-actions"><button id="s-save" class="btn primary">保存设置</button></div>' +
    '</div>' +
    '<div class="card">' +
      '<h2>说明</h2>' +
      '<p class="hint">· 单票仓位上限：单只股票最多占总本金的比例，超过即提醒超仓。</p>' +
      '<p class="hint">· 每手股数：A股按 100 股整手；美股/港股选 1 股。</p>' +
      '<p class="hint">· 数据只保存在你的账号下，换设备登录同一账号即可看到。</p>' +
    '</div>';

  $('#s-save').addEventListener('click', async () => {
    const totalCapital = Number($('#s-capital').value) || 0;
    const maxStocks = Math.max(1, Math.floor(Number($('#s-stocks').value) || 1));
    const maxSinglePct = Number($('#s-maxpct').value) || 20;
    const lotSize = Number($('#s-lot').value);
    try {
      const data = await api('PUT', '/api/settings', { totalCapital, maxStocks, maxSinglePct, lotSize });
      state.settings = data.settings;
      await loadSummary();
      toast('设置已保存', 'ok');
      renderAll();
    } catch (err) { toast(err.message, 'err'); }
  });
}

/* ================= 启动 ================= */
function init() {
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.addEventListener('click', () => switchPage(b.dataset.nav));
  });
  $('#logout-btn').addEventListener('click', async () => {
    try { await api('POST', '/api/logout'); } catch (e) {}
    localStorage.removeItem('token');
    state.token = ''; state.username = ''; state.positions = [];
    state.calcResult = null; state.lastCalcParams = null;
    showAuth();
  });
  $('#tab-login').addEventListener('click', () => setAuthMode('login'));
  $('#tab-register').addEventListener('click', () => setAuthMode('register'));
  $('#auth-form').addEventListener('submit', handleAuthSubmit);

  if (state.token) {
    loadMe().then(() => loadSummary()).then(() => {
      showApp();
      switchPage('home');
    }).catch(() => {
      localStorage.removeItem('token');
      state.token = '';
      showAuth();
    });
  } else {
    showAuth();
  }
}

init();
