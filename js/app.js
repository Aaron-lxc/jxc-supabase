/* 应用入口 + 启动门禁（三步向导）
   1) 首次运行填写 Supabase 连接（CFG）
   2) 登录 / 注册（Cloud 认证）
   3) 选择 / 创建账套（Cloud 账套）
   全部通过后加载业务数据并进入主界面

   注意（重要）：Vue 运行时编译的模板使用 with(_ctx) + RuntimeCompiled 代理，
   模板里出现的任何自定义标识符都会被当成组件属性解析（拿到 undefined），
   不会自动回退到 window。因此 Cloud / P / S / Sync / U / CFG 必须通过
   app.config.globalProperties 注入，模板中才能直接引用。 */

(function () {
  /* ---------- 兜底：任何未捕获错误都显示出来，绝不白屏 ---------- */
  function fatalBar(msg) {
    try {
      let el = document.getElementById('fatal-bar');
      if (!el) {
        el = document.createElement('div');
        el.id = 'fatal-bar';
        el.className = 'fatal-bar';
        document.body.appendChild(el);
      }
      el.innerHTML =
        '<b>页面出现异常</b><div class="fatal-msg"></div>' +
        '<div class="fatal-act">' +
        '<button onclick="location.reload()">刷新页面</button>' +
        '<button onclick="localStorage.removeItem(\'jxc.lastWorkspace\');location.reload()">重选账套</button>' +
        '<button onclick="localStorage.removeItem(\'jxc.supabase.config\');location.reload()">重置连接配置</button>' +
        '</div>';
      el.querySelector('.fatal-msg').textContent = String(msg || '').slice(0, 600);
    } catch (e) { /* ignore */ }
  }
  window.addEventListener('error', e => fatalBar((e.error && e.error.stack) || e.message));
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    fatalBar((r && (r.stack || r.message)) || r);
  });

  const app = Vue.createApp({
    data() {
      return {
        step: 'boot',            // boot | config | auth | workspace | app | error
        err: '',
        fatal: '',               // 致命错误（错误屏）
        tip: '正在初始化…',      // 启动过程提示
        busy: false,
        /* 连接配置 */
        fUrl: '', fKey: '',
        /* 认证 */
        authTab: 'login',        // login | signup
        aName: '', aEmail: '', aPwd: '',
        /* 账套 */
        wsName: '',
        /* 主界面 */
        cur: 'dashboard',
        navOpen: false,
        unread: false
      };
    },

    computed: {
      /* 供模板使用的全局引用（globalProperties 已注入，这里再显式暴露一层更直观） */
      wsList() { return Cloud.state.workspaces; },
      menu() { return P.menus(); },
      company() { return (S.db && S.db.settings) ? S.db.settings.company : ''; },
      sync() { return Sync.state; },
      myRole() { return P.roleLabel(P.role()); },
      wsName2() { return Cloud.state.ws ? Cloud.state.ws.name : ''; },
      meEmail() { return Cloud.state.user ? Cloud.state.user.email : ''; },
      /* 是否允许创建账套：全局无账套（引导）放开；之后仅自己是创建者/管理员的用户可建 */
      canCreateWs() {
        const mine = Cloud.state.workspaces || [];
        if (Cloud.state.globalHasWs === false) return true; // 全局无账套（首个引导）允许
        if (!mine.length) return false;                     // 全局有账套但自己无账套 → 未受邀
        return mine.some(w => w.role === '创建者' || w.role === '管理员');
      }
    },

    created() {
      /* 用函数式 $watch，字符串路径无法访问全局对象 */
      this.$watch(() => Cloud.state.ws, () => this.ensureCur(), { deep: true });
      this.boot();
    },

    methods: {
      /* ===== 通用错误处理 ===== */
      fail(e, where) {
        const msg = (e && (e.message || e.error_description || e.msg)) || String(e);
        this.fatal = (where ? where + '：' : '') + msg;
        this.step = 'error';
        this.busy = false;
      },

      /* ===== 启动门禁 ===== */
      async boot() {
        try {
          this.tip = '正在检查连接配置…';
          if (!CFG.ok()) { this.step = 'config'; return; }
          Cloud.connect();
          if (!Cloud.sb) { this.step = 'config'; return; }

          this.tip = '正在连接 Supabase…';
          const hc = await Cloud.healthCheck();
          if (hc) {
            this.err = hc;
            const c = CFG.read() || {};
            this.fUrl = c.url || ''; this.fKey = c.anonKey || '';
            this.step = 'config';
            return;
          }
          this.err = '';

          this.tip = '正在校验登录状态…';
          const u = await Cloud.restoreSession();
          if (!u) { this.step = 'auth'; return; }
          await this.enterApp();
        } catch (e) { this.fail(e, '启动失败'); }
      },

      async enterApp() {
        this.tip = '正在读取账套…';
        this.step = 'boot';
        const list = await Cloud.loadWorkspaces();
        if (list === null) {
          throw new Error('读取账套列表失败。' + (Cloud.state.lastError || ''));
        }
        if (!list.length) { this.step = 'workspace'; return; }

        const last = CFG.lastWs();
        const id = (last && list.some(w => w.id === last)) ? last : list[0].id;
        if (!Cloud.selectWorkspace(id)) { this.step = 'workspace'; return; }
        await this.loadWs();
      },

      /* 载入当前账套数据并进入主界面 */
      async loadWs() {
        this.tip = '正在加载「' + (Cloud.state.ws ? Cloud.state.ws.name : '') + '」的数据…';
        this.step = 'boot';
        // 报表接收人：RLS 禁止其读取 records，跳过业务数据加载，直接进报表中心
        await Cloud.loadRecipient(Cloud.state.ws.id).catch(() => {});
        if (Cloud.state.recipient) {
          this.cur = 'reportcenter';
          await this.checkUnread().catch(() => {});
          this.step = 'app';
          return;
        }
        await S.init({ demo: true });
        this.cur = P.firstMenu();
        this.step = 'app';
      },

      /* ===== 连接配置 ===== */
      async saveConfig() {
        try {
          const err = CFG.validate(this.fUrl, this.fKey);
          if (err) { this.err = err; return; }
          this.err = ''; this.busy = true;
          CFG.save(this.fUrl, this.fKey);
          Cloud.connect();
          const hc = await Cloud.healthCheck();
          this.busy = false;
          if (hc) { this.err = hc; return; }
          await this.boot();
        } catch (e) { this.fail(e, '保存连接配置失败'); }
      },

      /* ===== 认证 ===== */
      async doLogin() {
        try {
          if (!this.aEmail || !this.aPwd) return alert('请填写邮箱和密码');
          this.err = ''; this.busy = true;
          const e = await Cloud.signIn(this.aEmail, this.aPwd);
          if (e) { this.busy = false; this.err = e; return; }
          await this.enterApp();
          this.busy = false;
        } catch (e) { this.fail(e, '登录后加载失败'); }
      },
      async doSignup() {
        try {
          if (!this.aEmail || !this.aPwd) return alert('请填写邮箱和密码');
          this.err = ''; this.busy = true;
          const e = await Cloud.signUp(this.aEmail, this.aPwd, this.aName);
          if (e === '__NEED_CONFIRM__') {
            this.busy = false;
            this.err = '注册成功！请查收验证邮件后登录（或在 Supabase 后台关闭邮箱验证以直接登录）。';
            this.authTab = 'login';
            return;
          }
          if (e) { this.busy = false; this.err = e; return; }
          await this.enterApp();
          this.busy = false;
        } catch (e) { this.fail(e, '注册后加载失败'); }
      },
      async doReset() {
        if (!this.aEmail) return alert('请填写需要重置密码的邮箱');
        this.err = '';
        const e = await Cloud.resetPassword(this.aEmail);
        if (e) { this.err = e; return; }
        alert('重置链接已发送到您的邮箱，请按邮件指引设置新密码。');
      },

      /* ===== 账套 ===== */
      async createWs() {
        try {
          const name = (this.wsName || '').trim();
          if (!name) return alert('请填写账套名称');
          this.err = ''; this.busy = true;
          const r = await Cloud.createWorkspace(name);
          if (r.error) { this.busy = false; this.err = r.error; return; }
          if (!Cloud.selectWorkspace(r.id)) {
            this.busy = false;
            this.err = '账套已创建，但读取失败，请刷新页面后重试。';
            return;
          }
          await this.loadWs();
          this.busy = false;
        } catch (e) { this.fail(e, '创建账套失败'); }
      },
      async pickWs(id) {
        try {
          this.err = '';
          if (!Cloud.selectWorkspace(id)) { this.err = '账套不存在，请刷新页面'; return; }
          await this.loadWs();
        } catch (e) { this.fail(e, '进入账套失败'); }
      },
      backToWsList() {
        this.fatal = ''; this.err = '';
        this.step = 'workspace';
      },

      /* ===== 主界面 ===== */
      go(key) {
        if (!P.canView(key) && key !== 'members' && key !== 'recipientmgr') key = P.firstMenu();
        if (key === 'reportcenter') this.unread = false;
        this.cur = key;
        this.navOpen = false;
      },
      toggleNav() { this.navOpen = !this.navOpen; },
      ensureCur() {
        if (this.step !== 'app') return;
        const ok = this.menu.some(m => m.key === this.cur);
        if (!ok) this.cur = P.firstMenu();
      },
      async checkUnread() {
        try {
          const ws = Cloud.state.ws && Cloud.state.ws.id;
          if (!ws) return;
          const { data } = await Cloud.sb.auth.getSession();
          const token = data.session && data.session.access_token;
          if (!token) return;
          const base = (CFG.read() && CFG.read().url) || '';
          const res = await fetch(base + '/functions/v1/report-unread?ws=' + encodeURIComponent(ws), {
            headers: { Authorization: 'Bearer ' + token }
          });
          const j = await res.json().catch(() => ({}));
          this.unread = !!(j && j.unread);
        } catch (e) { this.unread = false; }
      },
      async forceSync() {
        try { await Sync.push(); await Sync.reload(); }
        catch (e) { alert('同步失败：' + (e.message || e)); }
      },
      async logout() {
        if (!U.confirm('确定退出登录吗？')) return;
        try { S.teardown(); } catch (e) { /* ignore */ }
        await Cloud.signOut();
        location.reload();
      },
      switchWs() {
        if (!U.confirm('切换账套将重新加载数据，确定继续吗？')) return;
        try { S.teardown(); } catch (e) { /* ignore */ }
        CFG.clearLastWs();
        location.reload();
      },
      syncText() { return Sync.statusText(); },
      remoteHint() {
        return Sync.state.remoteHits > 0 ? `（${Sync.state.remoteHits} 次收到他人改动）` : '';
      },

      /* ===== 错误屏动作 ===== */
      retry() { this.fatal = ''; this.step = 'boot'; this.boot(); },
      relogin() {
        this.fatal = '';
        Cloud.signOut().finally(() => location.reload());
      },
      resetConfig() {
        if (!U.confirm('将清除本机保存的 Supabase 连接配置，确定吗？')) return;
        CFG.clear(); CFG.clearLastWs(); location.reload();
      }
    },

    /* ===================== 模板 ===================== */
    template: `
    <div>
      <!-- ① 连接配置 -->
      <div class="gate" v-if="step==='config'">
        <div class="gate-card">
          <div class="gate-logo">📦 进销存管理系统<span>云端版 · Supabase</span></div>
          <p class="muted" style="margin:6px 0 16px;line-height:1.7">
            首次使用请填写您的 Supabase 项目地址与 anon public key（在 Supabase 控制台
            <b>Project Settings → API</b> 获取）。配置仅保存在本浏览器，不会上传。
          </p>
          <div class="form-item"><label>Project URL</label>
            <input type="text" v-model="fUrl" placeholder="https://xxxx.supabase.co"></div>
          <div class="form-item"><label>anon public key</label>
            <input type="text" v-model="fKey" placeholder="eyJhbGci...（三段式 JWT）"></div>
          <div class="gate-err" v-if="err" style="white-space:pre-line">{{err}}</div>
          <div style="display:flex;gap:10px;margin-top:14px">
            <button class="btn btn-primary" :disabled="busy" @click="saveConfig">
              {{ busy ? '连接中…' : '保存并继续' }}
            </button>
          </div>
          <div class="form-hint" style="margin-top:14px">
            提示：保存后若提示「数据库尚未初始化」，请在 Supabase 后台 SQL Editor 执行本项目
            <b>sql/schema.sql</b> 后刷新本页。
          </div>
        </div>
      </div>

      <!-- ② 登录 / 注册 -->
      <div class="gate" v-else-if="step==='auth'">
        <div class="gate-card" style="max-width:420px">
          <div class="gate-logo">账号登录</div>
          <div class="tabs" style="margin-top:14px">
            <div class="tab" :class="{active:authTab==='login'}" @click="authTab='login'">登录</div>
            <div class="tab" :class="{active:authTab==='signup'}" @click="authTab='signup'">注册</div>
          </div>

          <template v-if="authTab==='login'">
            <div class="form-item"><label>邮箱</label>
              <input type="text" v-model="aEmail" placeholder="登录邮箱"></div>
            <div class="form-item"><label>密码</label>
              <input type="password" v-model="aPwd" placeholder="密码" @keyup.enter="doLogin"></div>
            <div class="gate-err" v-if="err" style="white-space:pre-line">{{err}}</div>
            <div style="display:flex;gap:10px;margin-top:14px">
              <button class="btn btn-primary" :disabled="busy" @click="doLogin">{{ busy ? '登录中…' : '登录' }}</button>
              <button class="btn" @click="doReset">忘记密码</button>
            </div>
          </template>

          <template v-else>
            <div class="form-item"><label>昵称</label>
              <input type="text" v-model="aName" placeholder="显示名称（可选）"></div>
            <div class="form-item"><label>邮箱</label>
              <input type="text" v-model="aEmail" placeholder="注册邮箱"></div>
            <div class="form-item"><label>密码（至少 6 位）</label>
              <input type="password" v-model="aPwd" placeholder="设置密码" @keyup.enter="doSignup"></div>
            <div class="gate-err" v-if="err" style="white-space:pre-line">{{err}}</div>
            <div style="display:flex;gap:10px;margin-top:14px">
              <button class="btn btn-primary" :disabled="busy" @click="doSignup">{{ busy ? '注册中…' : '注册并进入' }}</button>
            </div>
          </template>
        </div>
      </div>

      <!-- ③ 账套选择 / 创建 -->
      <div class="gate" v-else-if="step==='workspace'">
        <div class="gate-card" style="max-width:560px">
          <div class="gate-logo">选择账套</div>
          <p class="muted" style="margin:6px 0 14px;line-height:1.7">
            一个账套 = 一套独立的数据与成员。你可以加入多个账套，或新建自己的账套。
          </p>
          <div v-if="wsList.length" class="ws-list">
            <div class="ws-item" v-for="w in wsList" :key="w.id" @click="pickWs(w.id)">
              <div>
                <div class="ws-name">{{ w.name }}</div>
                <div class="muted">我的角色：{{ roleText(w.role) }} ｜ {{ w.member_count }} 名成员</div>
              </div>
              <button class="btn btn-sm btn-primary">进入</button>
            </div>
          </div>
          <div class="form-hint" v-else style="margin:0 0 6px">
            当前账号还没有任何账套，请在下方创建一个（创建者自动成为该账套的管理员）。
          </div>
          <template v-if="canCreateWs">
            <div class="form-item" style="margin-top:16px"><label>新建账套名称</label>
              <input type="text" v-model="wsName" placeholder="例如：XX贸易有限公司" @keyup.enter="createWs"></div>
            <div class="gate-err" v-if="err" style="white-space:pre-line">{{err}}</div>
            <div style="display:flex;gap:10px;margin-top:12px">
              <button class="btn btn-primary" :disabled="busy" @click="createWs">{{ busy ? '创建中…' : '创建并进入' }}</button>
              <button class="btn" @click="relogin">切换账号</button>
            </div>
          </template>
          <template v-else>
            <div class="form-hint" style="margin-top:16px;color:#c0392b">
              你尚未被邀请加入任何账套，无法创建账套。请联系账套创建者邀请你并授予管理员权限后重试。
            </div>
            <div style="margin-top:12px">
              <button class="btn" @click="relogin">切换账号</button>
            </div>
          </template>
        </div>
      </div>

      <!-- ④ 主界面 -->
      <div class="layout" v-else-if="step==='app'" :class="{'nav-open': navOpen}">
        <aside class="sidebar">
          <div class="logo">进销存管理系统<small>{{company || '云端版'}}</small></div>
          <div class="menu-item" v-for="m in menu" :key="m.key" :class="{active:cur===m.key}" @click="go(m.key)">
            <span class="ico">{{m.ico}}</span>{{m.label}}
            <span class="badge" v-if="m.key==='reportcenter' && unread">新</span>
          </div>
        </aside>
        <div class="nav-overlay" @click="navOpen=false"></div>
        <main class="content">
          <div class="topbar">
            <div class="tb-left">
              <button class="hamburger" @click="toggleNav" aria-label="菜单">☰</button>
              <span class="tag tag-blue">{{wsName2}}</span>
              <span class="muted">{{meEmail}} · {{myRole}}</span>
            </div>
            <div class="tb-right">
              <span class="sync-dot" :class="sync.status"></span>
              <span class="muted">{{syncText()}} {{remoteHint()}}</span>
              <button class="btn btn-sm" v-if="!P.isRecipient()" @click="forceSync">同步</button>
              <button class="btn btn-sm" @click="switchWs">切换账套</button>
              <button class="btn btn-sm" @click="logout">退出</button>
            </div>
          </div>
          <component :is="'page-'+cur" :key="cur"></component>
        </main>
      </div>

      <!-- ⑤ 错误屏 -->
      <div class="gate" v-else-if="step==='error'">
        <div class="gate-card" style="max-width:560px">
          <div class="gate-logo">😕 启动遇到问题</div>
          <div class="gate-err" style="white-space:pre-line;margin-top:12px">{{fatal}}</div>
          <div class="form-hint" style="margin-top:12px;line-height:1.8">
            常见原因：<br>
            1. Supabase 后台尚未执行 <b>sql/schema.sql</b>（或只执行了一部分）；<br>
            2. 当前账号被移出账套 / 权限被停用；<br>
            3. 网络不通或 Project URL、anon key 填错。
          </div>
          <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
            <button class="btn btn-primary" @click="retry">重试</button>
            <button class="btn" @click="backToWsList">重选账套</button>
            <button class="btn" @click="relogin">重新登录</button>
            <button class="btn" @click="resetConfig">重置连接配置</button>
          </div>
        </div>
      </div>

      <!-- 启动中 -->
      <div class="gate" v-else>
        <div class="gate-card" style="text-align:center">
          <div class="gate-logo" style="align-items:center">📦 进销存管理系统</div>
          <p class="muted" style="margin-top:10px">{{tip}}</p>
        </div>
      </div>
    </div>`
  });

  /* 关键：把全局对象注入模板作用域，否则模板里写 Cloud./P./S. 会拿到 undefined */
  Object.assign(app.config.globalProperties, {
    Cloud: window.Cloud, P: window.P, S: window.S,
    Sync: window.Sync, U: window.U, CFG: window.CFG,
    roleText: r => window.P.roleLabel(r)
  });

  /* Vue 内部错误也显示出来，避免静默白屏 */
  app.config.errorHandler = (err, vm, info) => {
    console.error('[Vue]', info, err);
    fatalBar('[' + info + '] ' + ((err && err.stack) || err));
  };

  Object.entries(AppComponents).forEach(([n, c]) => app.component(n, c));
  Object.entries(Pages).forEach(([n, c]) => app.component(n, c));
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
  app.mount('#app');
})();
