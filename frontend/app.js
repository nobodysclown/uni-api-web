// 网关管理 - 前端逻辑
const LS_BASE = 'uni-admin:base';
const LS_KEY = 'uni-admin:key';
const LS_REMEMBER = 'uni-admin:remember';

// 安全的存储访问（隐私模式下 localStorage 可能抛异常）
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

const $ = (id) => document.getElementById(id);
const state = { base: '', key: '' };

async function fetchTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 25000);
  try { return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal })); }
  finally { clearTimeout(t); }
}

function apiHeaders() {
  return { 'Authorization': 'Bearer ' + state.key, 'Content-Type': 'application/json' };
}
function gw(path) { return state.base.replace(/\/+$/, '') + path; }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n) {
  if (n == null) return '—';
  n = Number(n);
  if (!isFinite(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  $('logout-btn').onclick = () => {
    store.del(LS_KEY);
    document.documentElement.dataset.auth = '';
    state.key = ''; $('login-key').value = '';
    $('app').style.display = 'none'; $('login-page').style.display = '';
  };
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.nav-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const p = b.dataset.page;
      $('page-stats').style.display = p === 'stats' ? '' : 'none';
      $('page-logs').style.display = p === 'logs' ? '' : 'none';
      $('page-providers').style.display = p === 'providers' ? '' : 'none';
      if (p === 'logs' && !$('endpoint-body').dataset.loaded) loadDetails();
    };
  });
  $('logs-refresh').onclick = () => loadDetails();
  $('add-provider-btn').onclick = () => addProviderCard({ provider: '', base_url: '', api: [], model: [] });
  $('save-config-btn').onclick = saveConfig;
});

// ---------- 登录 ----------
function initLogin() {
  const savedBase = store.get(LS_BASE);
  const savedKey = store.get(LS_KEY);
  const remember = store.get(LS_REMEMBER) !== '0';
  if (savedBase) $('login-base').value = savedBase;
  if (savedKey) $('login-key').value = savedKey;
  $('remember-me').checked = remember;
  $('login-btn').onclick = () => doLogin();
  $('login-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('net-retry').onclick = () => { $('net-banner').classList.remove('show'); verifySaved(); };
  if (savedBase && savedKey) {
    // 有保存的凭据：直接进主界面，后台静默验证，避免登录页闪烁
    state.base = savedBase; state.key = savedKey;
    $('login-page').style.display = 'none';
    $('app').style.display = '';
    verifySaved();
  }
}

async function verifySaved() {
  try {
    const r = await fetchTimeout(state.base + '/v1/models', { headers: { 'Authorization': 'Bearer ' + state.key } });
    if (r.status === 401 || r.status === 403) {
      // 密钥真的不对：清掉并退回登录页
      store.del(LS_KEY);
      document.documentElement.dataset.auth = '';
      state.base = ''; state.key = '';
      $('app').style.display = 'none';
      $('login-page').style.display = '';
      $('login-error').textContent = '密钥已失效，请重新输入';
      return;
    }
    if (!r.ok) throw new Error('net');
    $('net-banner').classList.remove('show');
    loadStats(); loadProviders();
  } catch (e) {
    // 网络问题（网关休眠唤醒中等）：留在主界面，顶部横幅提示重试
    $('net-banner').classList.add('show');
  }
}

async function doLogin() {
  const base = $('login-base').value.trim().replace(/\/+$/, '');
  const key = $('login-key').value.trim();
  const remember = $('remember-me').checked;
  if (!base || !key) { $('login-error').textContent = '请填写服务地址和管理密钥'; return; }
  $('login-btn').disabled = true; $('login-btn').textContent = '连接中…';
  try {
    const r = await fetchTimeout(base + '/v1/models', { headers: { 'Authorization': 'Bearer ' + key } });
    if (r.status === 401 || r.status === 403) throw new Error('密钥不正确，请检查后重试');
    if (!r.ok) throw new Error('连接失败 (HTTP ' + r.status + ')，请检查服务地址');
    state.base = base; state.key = key;
    store.set(LS_BASE, base);
    store.set(LS_REMEMBER, remember ? '1' : '0');
    if (remember) store.set(LS_KEY, key); else store.del(LS_KEY);
    document.documentElement.dataset.auth = '1';
    $('login-error').textContent = '';
    $('login-page').style.display = 'none'; $('app').style.display = '';
    $('net-banner').classList.remove('show');
    statsCache = null;
    loadStats(); loadProviders();
  } catch (e) {
    $('login-error').textContent = e.message || '连接失败';
  } finally {
    $('login-btn').disabled = false; $('login-btn').textContent = '连接';
  }
}

// ---------- 数据统计（网关 /v1/stats，最近 24 小时） ----------
let statsCache = null;
async function fetchStats() {
  if (statsCache) return statsCache;
  const r = await fetch(gw('/v1/stats'), { headers: apiHeaders() });
  if (!r.ok) throw new Error('统计接口不可用 (HTTP ' + r.status + ')');
  statsCache = await r.json();
  return statsCache;
}
function rateClass(rate) {
  if (rate == null) return '';
  return rate >= 0.95 ? 'ok-dot' : (rate >= 0.8 ? 'warn-dot' : 'err-dot');
}
function rateText(rate) {
  return rate == null ? '—' : (rate * 100).toFixed(1) + '%';
}

async function loadStats() {
  $('stats-error').textContent = '';
  try {
    const d = await fetchStats();
    const modelCounts = d.model_request_counts || [];
    const modelRates = d.channel_model_success_rates || [];
    const providerRates = d.channel_success_rates || [];

    let tot = 0, ok = 0;
    const rateByModel = {};
    modelRates.forEach((x) => {
      const s = Math.round((x.success_rate || 0) * (x.total_requests || 0));
      tot += x.total_requests || 0; ok += s;
      rateByModel[x.model] = x;
    });
    // model_request_counts 补全总量
    const countByModel = {};
    modelCounts.forEach((x) => { countByModel[x.model] = x.count || 0; });

    $('stat-requests').textContent = fmt(tot);
    $('stat-success').textContent = fmt(ok);
    $('stat-rate').textContent = tot ? (ok / tot * 100).toFixed(1) + '%' : '—';
    $('stat-models').textContent = Object.keys(countByModel).length || modelRates.length;
    $('stat-providers').textContent = providerRates.length;

    const mb = $('model-stats-body');
    const models = [...new Set([...Object.keys(countByModel), ...Object.keys(rateByModel)])];
    mb.innerHTML = models.length ? models.map((m) => {
      const c = countByModel[m] || (rateByModel[m] || {}).total_requests || 0;
      const ri = rateByModel[m] || {};
      return '<tr><td>' + esc(m) + '</td><td class="muted">' + esc(ri.provider || '—') + '</td>'
        + '<td class="num">' + c + '</td>'
        + '<td class="num ' + rateClass(ri.success_rate) + '">' + rateText(ri.success_rate) + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="muted">最近 24 小时暂无请求</td></tr>';

    const pb = $('provider-stats-body');
    pb.innerHTML = providerRates.length ? providerRates.map((x) =>
      '<tr><td>' + esc(x.provider || '—') + '</td><td class="num">' + (x.total_requests || 0) + '</td>'
      + '<td class="num ' + rateClass(x.success_rate) + '">' + rateText(x.success_rate) + '</td></tr>'
    ).join('') : '<tr><td colspan="3" class="muted">最近 24 小时暂无请求</td></tr>';
  } catch (e) {
    $('stats-error').textContent = e.message || '加载统计失败';
  }
}

// ---------- 调用明细 ----------
async function loadDetails() {
  const errEl = $('logs-error'); errEl.textContent = '';
  $('endpoint-body').dataset.loaded = '1';
  try {
    const d = await fetchStats();
    const eps = d.endpoint_request_counts || [];
    const ips = d.ip_request_counts || [];
    $('endpoint-body').innerHTML = eps.length ? eps.map((x) =>
      '<tr><td class="mono">' + esc(x.endpoint || '—') + '</td><td class="num">' + (x.count || 0) + '</td></tr>'
    ).join('') : '<tr><td colspan="2" class="muted">暂无数据</td></tr>';
    $('ip-body').innerHTML = ips.length ? ips.map((x) =>
      '<tr><td class="mono">' + esc(x.ip || '—') + '</td><td class="num">' + (x.count || 0) + '</td></tr>'
    ).join('') : '<tr><td colspan="2" class="muted">暂无数据</td></tr>';
  } catch (e) {
    errEl.textContent = e.message || '加载失败';
  }
}

// ---------- 提供商管理 ----------
function tpl(id) { return document.querySelector(id).content.cloneNode(true); }

async function loadProviders() {
  $('providers-error').textContent = '';
  try {
    const r = await fetch(gw('/v1/api_config'), { headers: apiHeaders() });
    if (!r.ok) throw new Error('读取配置失败 (HTTP ' + r.status + ')');
    const j = await r.json();
    const providers = (j.api_config && j.api_config.providers) || [];
    const list = $('provider-list'); list.innerHTML = '';
    providers.forEach((p) => addProviderCard(p));
    if (!providers.length) {
      list.innerHTML = '<div class="muted" style="padding:40px">暂无提供商，点击右上「添加提供商」新建</div>';
    }
  } catch (e) { $('providers-error').textContent = e.message || '加载失败'; }
}

function addProviderCard(p) {
  const list = $('provider-list');
  const empty = list.querySelector('.muted');
  if (empty && !list.querySelector('.provider-card')) list.innerHTML = '';
  const frag = tpl('#provider-tpl');
  const card = frag.querySelector('.provider-card');
  card.querySelector('.p-name').value = p.provider || '';
  card.querySelector('.p-baseurl').value = p.base_url || '';
  card.querySelector('.p-notes').value = p.notes || '';
  if (p.preferences) { try { card.querySelector('.p-prefs').value = JSON.stringify(p.preferences, null, 2); } catch (e) {} }

  const keysBox = card.querySelector('.p-keys');
  const apis = Array.isArray(p.api) ? p.api : (p.api ? [p.api] : []);
  if (apis.length) apis.forEach((k) => addKeyRow(keysBox, k)); else addKeyRow(keysBox, '');

  const modelsBox = card.querySelector('.p-models');
  (p.model || []).forEach((m) => {
    if (typeof m === 'string') addModelRow(modelsBox, m, '');
    else { const k = Object.keys(m)[0]; addModelRow(modelsBox, k, m[k]); }
  });

  card.querySelector('.btn-add-key').onclick = () => addKeyRow(keysBox, '');
  card.querySelector('.btn-add-model').onclick = () => addModelRow(modelsBox, '', '');
  card.querySelector('.btn-del').onclick = () => {
    if (confirm('确定删除提供商「' + (card.querySelector('.p-name').value || '未命名') + '」吗？')) card.remove();
  };
  card.querySelector('.btn-dup').onclick = () => {
    const data = readCard(card);
    data.provider = (data.provider || 'provider') + '-copy';
    addProviderCard(data);
  };
  list.appendChild(frag);
}

function addKeyRow(box, val) {
  const frag = tpl('#key-tpl');
  const row = frag.querySelector('.key-row');
  row.querySelector('.k-value').value = val || '';
  row.querySelector('.btn-del-key').onclick = () => row.remove();
  row.querySelector('.btn-toggle-key').onclick = () => {
    const inp = row.querySelector('.k-value');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  };
  box.appendChild(frag);
}

function addModelRow(box, original, alias) {
  const frag = tpl('#model-tpl');
  const row = frag.querySelector('.model-row');
  row.querySelector('.m-original').value = original || '';
  row.querySelector('.m-alias').value = alias || '';
  row.querySelector('.btn-del-model').onclick = () => row.remove();
  box.appendChild(frag);
}

function readCard(card) {
  const keys = [];
  card.querySelectorAll('.k-value').forEach((i) => { const v = i.value.trim(); if (v) keys.push(v); });
  const models = [];
  card.querySelectorAll('.model-row').forEach((r) => {
    const o = r.querySelector('.m-original').value.trim();
    const a = r.querySelector('.m-alias').value.trim();
    if (!o) return;
    models.push(a ? { [o]: a } : o);
  });
  const p = {
    provider: card.querySelector('.p-name').value.trim(),
    base_url: card.querySelector('.p-baseurl').value.trim(),
    model: models,
  };
  if (keys.length === 1) p.api = keys[0];
  else if (keys.length > 1) p.api = keys;
  else p.api = '';
  const notes = card.querySelector('.p-notes').value.trim();
  if (notes) p.notes = notes;
  const prefs = card.querySelector('.p-prefs').value.trim();
  if (prefs) {
    try { p.preferences = JSON.parse(prefs); }
    catch (e) { throw new Error('「' + (p.provider || '未命名') + '」的偏好设置不是合法 JSON'); }
  }
  return p;
}

async function saveConfig() {
  const st = $('save-status'); st.className = 'save-status'; st.textContent = '';
  $('providers-error').textContent = '';
  const btn = $('save-config-btn'); btn.disabled = true; btn.textContent = '保存中…';
  try {
    const cards = document.querySelectorAll('.provider-card');
    const providers = [];
    for (const c of cards) {
      const p = readCard(c);
      if (!p.provider) throw new Error('有提供商未填写名称');
      if (!p.base_url) throw new Error('提供商「' + p.provider + '」未填写 Base URL');
      providers.push(p);
    }
    const r = await fetch(gw('/v1/api_config/update'), {
      method: 'POST', headers: apiHeaders(), body: JSON.stringify({ providers }),
    });
    if (!r.ok) { const t = await r.text(); throw new Error('保存失败 (HTTP ' + r.status + '): ' + t.slice(0, 200)); }
    st.className = 'save-status ok'; st.textContent = '✓ 已保存，网关约 2 秒后热加载生效';
    setTimeout(() => { st.textContent = ''; }, 5000);
  } catch (e) {
    st.className = 'save-status err'; st.textContent = e.message || '保存失败';
  } finally { btn.disabled = false; btn.textContent = '保存设置'; }
}
