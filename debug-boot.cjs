/* 启动流程复现：在 jsdom 中真实挂载应用，模拟登录成功，观察渲染结果。
   用途：定位「登录成功后白屏」。
   运行：NODE_PATH=<workspace>/node_modules node debug-boot.cjs            */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = __dirname;
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const dom = new JSDOM(
  `<!DOCTYPE html><html><head></head><body><div id="app"></div><div id="print-area"></div></body></html>`,
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' }
);
const w = dom.window;

/* ---------- 错误收集 ---------- */
const errors = [];
const warns = [];
w.addEventListener('error', e => errors.push('[window.error] ' + (e.error && e.error.stack || e.message)));
w.addEventListener('unhandledrejection', e => errors.push('[unhandledrejection] ' + (e.reason && e.reason.stack || e.reason)));
process.on('unhandledRejection', r => errors.push('[node unhandledRejection] ' + (r && r.stack || r)));
w.console.error = (...a) => errors.push('[console.error] ' + a.map(String).join(' '));
w.console.warn = (...a) => warns.push('[console.warn] ' + a.map(String).join(' '));

/* ---------- 预置连接配置（跳过第一屏） ---------- */
w.localStorage.setItem('jxc.supabase.config', JSON.stringify({
  url: 'https://demo.supabase.co', anonKey: 'aaa.bbb.ccc'
}));

/* ---------- Mock Supabase ---------- */
/* 场景：SCENE=ok(默认) | nows(无账套) | norpc(schema未执行) | rlsdeny(读records被拒) */
const SCENE = process.env.SCENE || 'ok';

const RPC = {
  my_workspaces: [{
    id: 'ws-1', name: '测试账套', owner_id: 'u-1',
    role: 'owner', permissions: {}, member_count: 1
  }],
  workspace_members_view: [],
  create_workspace: 'ws-1',
  add_member: 'joined',
  transfer_ownership: null
};
const TABLE = { workspaces: [], records: [], workspace_members: [], invites: [], profiles: [] };
let upsertCount = 0;

if (SCENE === 'nows') RPC.my_workspaces = [];

function builder(table) {
  const denyRead = (SCENE === 'rlsdeny' && table === 'records');
  const q = {
    _res: denyRead
      ? { data: null, error: { message: 'new row violates row-level security policy for table "records"' } }
      : { data: TABLE[table] || [], error: null },
    select() { return q; }, eq() { return q; }, neq() { return q; }, in() { return q; },
    gt() { return q; }, gte() { return q; }, lt() { return q; }, order() { return q; },
    limit() { return q; }, range() { return q; }, single() { return q; }, maybeSingle() { return q; },
    upsert(rows) { upsertCount += Array.isArray(rows) ? rows.length : 1; q._res = { data: null, error: null }; return q; },
    update() { q._res = { data: null, error: null }; return q; },
    insert() { q._res = { data: null, error: null }; return q; },
    delete() { q._res = { data: null, error: null }; return q; },
    then(res, rej) { return Promise.resolve(q._res).then(res, rej); }
  };
  return q;
}
w.supabase = {
  createClient() {
    return {
      from: builder,
      rpc(name) {
        if (SCENE === 'norpc') {
          return Promise.resolve({
            data: null,
            error: { message: 'Could not find the function public.' + name + ' in the schema cache' }
          });
        }
        return Promise.resolve({ data: (name in RPC) ? RPC[name] : null, error: null });
      },
      channel() {
        const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, unsubscribe() { } };
        return ch;
      },
      removeChannel() { },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        signInWithPassword: async () => ({
          data: { user: { id: 'u-1', email: 'boss@test.com', user_metadata: { name: '老板' } } }, error: null
        }),
        signUp: async () => ({ data: { session: {}, user: { id: 'u-1', email: 'boss@test.com', user_metadata: {} } }, error: null }),
        signOut: async () => ({ error: null }),
        updateUser: async () => ({ error: null }),
        resetPasswordForEmail: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { } } } })
      }
    };
  }
};

/* ---------- 加载脚本 ---------- */
/* jsdom 无 canvas，用桩替代 echarts，避免噪音淹没真实错误 */
const ECHARTS_STUB = `window.echarts = {
  init: function(){ return { setOption:function(){}, resize:function(){}, dispose:function(){},
                             on:function(){}, off:function(){}, getWidth:function(){return 600},
                             getHeight:function(){return 300}, clear:function(){} }; },
  dispose: function(){}, getInstanceByDom: function(){ return null; }
};`;
const FILES = [
  'vendor/vue.global.prod.js', '@echarts-stub', 'vendor/xlsx.full.min.js',
  'js/utils.js', 'js/config.js', 'js/cloud.js', 'js/perm.js', 'js/sync.js',
  'js/store.js', 'js/demo-data.js', 'js/components.js',
  'js/pages/dashboard.js', 'js/pages/goods.js', 'js/pages/customers.js', 'js/pages/partners.js',
  'js/pages/warehouse.js', 'js/pages/purchase.js', 'js/pages/inventory.js', 'js/pages/sales.js',
  'js/pages/opening.js', 'js/pages/capital.js', 'js/pages/finance.js', 'js/pages/complaint.js', 'js/pages/report.js', 'js/pages/commission.js',
  'js/pages/members.js', 'js/pages/settings.js',
  'js/app.js'
];
for (const f of FILES) {
  try {
    const s = w.document.createElement('script');
    s.textContent = (f === '@echarts-stub') ? ECHARTS_STUB : read(f);
    w.document.head.appendChild(s);
  } catch (e) {
    console.log('❌ 加载失败 ' + f + '：' + (e.stack || e.message));
    process.exit(1);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const html = () => w.document.getElementById('app').innerHTML;
const txt = () => (w.document.getElementById('app').textContent || '').replace(/\s+/g, ' ').trim();

(async function run() {
  await sleep(300);
  console.log('—— 步骤1：启动后 ——');
  console.log('  DOM 长度:', html().length, '| 文本:', txt().slice(0, 80));

  /* 填写并提交登录 */
  const inputs = [...w.document.querySelectorAll('#app input')];
  console.log('  输入框数量:', inputs.length);
  if (inputs.length >= 2) {
    const set = (el, v) => {
      el.value = v;
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
    };
    set(inputs[0], 'boss@test.com');
    set(inputs[1], '123456');
    await sleep(30);
    const btn = [...w.document.querySelectorAll('#app button')]
      .find(b => /登录/.test(b.textContent));
    console.log('  找到登录按钮:', !!btn);
    if (btn) btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  }

  await sleep(1500);
  console.log('\n—— 步骤2：登录后 ——');
  console.log('  DOM 长度:', html().length);
  console.log('  文本片段:', txt().slice(0, 160) || '（空！白屏）');
  console.log('  云端 upsert 行数:', upsertCount);
  try {
    console.log('  Cloud.state.ws:', w.Cloud.state.ws ? w.Cloud.state.ws.name : null);
    console.log('  S.state.ready:', w.S.state.ready, '| db:', !!w.S.state.db);
  } catch (e) { console.log('  读取状态失败:', e.message); }

  /* 若已进入主界面，逐个点开每个菜单，验证每页都能渲染 */
  const items = [...w.document.querySelectorAll('#app .menu-item')];
  if (items.length) {
    console.log('\n—— 步骤3：逐页渲染（共 ' + items.length + ' 项）——');
    for (const it of items) {
      const label = (it.textContent || '').trim();
      const before = errors.length;
      it.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await sleep(120);
      const main = w.document.querySelector('#app .content');
      const len = main ? main.innerHTML.length : 0;
      const newErr = errors.length - before;
      const flag = (len > 400 && !newErr) ? '✅' : '❌';
      console.log(`  ${flag} ${label.padEnd(12)} DOM=${String(len).padStart(6)}${newErr ? '  错误+' + newErr : ''}`);
    }
  } else {
    console.log('\n（未进入主界面，跳过逐页渲染）');
  }

  console.log('\n—— 错误 (' + errors.length + ') ——');
  errors.slice(0, 12).forEach(e => console.log('  ' + String(e).split('\n').slice(0, 5).join('\n  ')));
  console.log('—— 警告 (' + warns.length + ') ——');
  warns.slice(0, 6).forEach(e => console.log('  ' + String(e).slice(0, 240)));

  process.exit(errors.length ? 1 : 0);
})();
