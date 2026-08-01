/* 系统设置：常规设置 + 数据管理 + 云端连接（Supabase 版） */
window.Pages = window.Pages || {};

Pages['page-settings'] = {
  data() {
    return { busy: '', pwd1: '', pwd2: '', wsName: '' };
  },
  computed: {
    S() { return window.S; },
    st() { return S.db.settings; },
    P() { return window.P; },
    ro() { return !P.canEdit('settings'); },
    cloud() { return Cloud.state; },
    sync() { return Sync.state; },
    cfg() { return CFG.read() || {}; },
    counts() {
      const d = S.db;
      return [
        { k: '商品', v: (d.goods || []).length },
        { k: '客户', v: (d.customers || []).length },
        { k: '销售单', v: (d.sales || []).length },
        { k: '采购单', v: (d.purchases || []).length },
        { k: '退货单', v: (d.returns || []).length },
        { k: '库存记录', v: (d.stocks || []).length }
      ];
    }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    syncText() { return Sync.statusText(); },

    /* ---- 备份 / 恢复：走浏览器下载与文件选择 ---- */
    backup() {
      const name = `进销存备份-${(Cloud.state.ws && Cloud.state.ws.name) || '账套'}-${U.today()}.json`;
      U.download(name, JSON.stringify(S.db, null, 2), 'application/json');
    },
    pickRestore() {
      if (this.ro) return alert(P.denyTip('settings'));
      this.$refs.file.value = '';
      this.$refs.file.click();
    },
    async onFile(e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (!U.confirm(`即将用「${f.name}」覆盖本账套的全部数据，且会同步到云端（其他成员也会看到）。\n建议先点「备份数据」保存一份。确定继续吗？`)) return;
      try {
        const raw = await f.text();
        const db = JSON.parse(raw);
        if (!db.meta || !Array.isArray(db.goods)) return alert('文件格式不正确，不是有效的备份文件');
        this.busy = '正在恢复并上传到云端…';
        await S.replace(db);
        this.busy = '';
        alert('数据恢复成功，已同步到云端');
      } catch (err) {
        this.busy = '';
        alert('恢复失败：' + (err.message || err));
      }
    },
    async loadDemo() {
      if (this.ro) return alert(P.denyTip('settings'));
      if (!U.confirm('载入演示数据将覆盖本账套的全部数据（含云端），确定继续吗？')) return;
      this.busy = '正在写入演示数据…';
      try { await S.replace(Demo.build()); alert('演示数据已载入'); }
      catch (e) { alert('操作失败：' + (e.message || e)); }
      this.busy = '';
    },
    async clearAll() {
      if (this.ro) return alert(P.denyTip('settings'));
      if (!U.confirm('⚠️ 清空数据将删除本账套全部业务数据且不可恢复（建议先备份），确定继续吗？')) return;
      if (!U.confirm('再次确认：真的要清空全部数据吗？此操作会同步删除云端数据。')) return;
      this.busy = '正在清空云端数据…';
      try { await S.replace(S.emptyDB()); alert('数据已清空，账套恢复为全新状态'); }
      catch (e) { alert('操作失败：' + (e.message || e)); }
      this.busy = '';
    },

    /* ---- 账套 ---- */
    async renameWs() {
      if (!P.isManager()) return alert('只有管理员可以重命名账套');
      const name = (this.wsName || '').trim();
      if (!name) return alert('请填写新的账套名称');
      const err = await Cloud.renameWorkspace(Cloud.state.ws.id, name);
      if (err) return alert(err);
      this.wsName = '';
      alert('账套已重命名');
    },
    switchWs() {
      if (!U.confirm('切换账套将重新加载数据，确定继续吗？')) return;
      CFG.clearLastWs();
      location.reload();
    },

    /* ---- 账号 ---- */
    async changePwd() {
      if (!this.pwd1 || this.pwd1.length < 6) return alert('新密码至少 6 位');
      if (this.pwd1 !== this.pwd2) return alert('两次输入的新密码不一致');
      const err = await Cloud.changePassword(this.pwd1);
      if (err) return alert(err);
      this.pwd1 = this.pwd2 = '';
      alert('密码已修改');
    },
    async logout() {
      if (!U.confirm('确定退出登录吗？')) return;
      S.teardown();
      await Cloud.signOut();
      location.reload();
    },

    /* ---- 连接 ---- */
    resetCloud() {
      if (!U.confirm('将清除本机保存的 Supabase 连接配置并退出登录，需要重新填写地址与密钥。确定吗？')) return;
      CFG.clear(); CFG.clearLastWs();
      location.reload();
    },
    async forceSync() {
      this.busy = '正在与云端同步…';
      try { await Sync.push(); await Sync.reload(); alert('已与云端同步'); }
      catch (e) { alert('同步失败：' + (e.message || e)); }
      this.busy = '';
    }
  },
  template: `
  <div>
    <div class="page-title">系统设置</div>
    <input ref="file" type="file" accept="application/json,.json" style="display:none" @change="onFile">
    <div class="card" v-if="busy" style="border-color:#93c5fd;background:#eff6ff">{{busy}}</div>

    <div class="card">
      <h3>常规设置</h3>
      <div class="form-grid">
        <div class="form-item"><label>公司名称（用于销售单打印抬头）</label>
          <input type="text" v-model="st.company" :disabled="ro"></div>
        <div class="form-item"><label>固定成本说明</label>
          <input type="text" disabled value="「每月固定成本」已并入日常运营，无需单独设置"></div>
      </div>
      <div class="form-hint" style="margin-top:8px">说明：原「每月固定成本」功能已去除，相关固定支出请直接在日常运营中登记并「计算」，即可纳入累计成本统计。</div>
    </div>

    <div class="card">
      <h3>当前账套</h3>
      <div class="form-grid">
        <div class="form-item"><label>账套名称</label>
          <input type="text" :value="cloud.ws ? cloud.ws.name : ''" disabled></div>
        <div class="form-item"><label>我的角色</label>
          <input type="text" :value="P.roleLabel(P.role())" disabled></div>
        <div class="form-item" v-if="P.isManager()"><label>重命名为</label>
          <input type="text" v-model="wsName" placeholder="输入新的账套名称"></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary" v-if="P.isManager()" @click="renameWs">保存账套名称</button>
        <button class="btn" @click="switchWs">切换 / 新建账套</button>
      </div>
    </div>

    <div class="card">
      <h3>数据管理</h3>
      <div class="muted" style="margin-bottom:10px">
        数据保存在云端，多台设备、多个账号实时共享，无需手动保存。以下备份用于导出留档或迁移。
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" @click="backup">备份数据（下载 JSON）</button>
        <button class="btn" :disabled="ro" @click="pickRestore">恢复数据（上传 JSON）</button>
        <button class="btn" :disabled="ro" @click="loadDemo">载入演示数据</button>
        <button class="btn" @click="forceSync">立即与云端同步</button>
        <button class="btn btn-danger" :disabled="ro" @click="clearAll">清空全部数据</button>
      </div>
      <div class="muted" style="margin-top:12px;line-height:1.9">
        <span v-for="c in counts" :key="c.k" style="margin-right:16px">{{c.k}} <b>{{c.v}}</b> 条</span>
      </div>
    </div>

    <div class="card">
      <h3>云端连接与账号</h3>
      <div class="form-grid">
        <div class="form-item full"><label>Supabase 地址</label>
          <input type="text" :value="cfg.url" disabled></div>
        <div class="form-item"><label>登录邮箱</label>
          <input type="text" :value="cloud.user ? cloud.user.email : ''" disabled></div>
        <div class="form-item"><label>同步状态</label>
          <input type="text" :value="syncText()" disabled></div>
        <div class="form-item"><label>修改密码（至少 6 位）</label>
          <input type="password" v-model="pwd1" placeholder="新密码"></div>
        <div class="form-item"><label>确认新密码</label>
          <input type="password" v-model="pwd2" placeholder="再次输入新密码"></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary" @click="changePwd">修改密码</button>
        <button class="btn" @click="logout">退出登录</button>
        <button class="btn btn-danger" @click="resetCloud">重置连接配置</button>
      </div>
    </div>

    <div class="card">
      <h3>系统说明</h3>
      <div class="muted" style="line-height:2">
        1. 单据编号自动生成：采购 PO-年月日-xxxxx ｜ 销售 SO-年月日-xxxxx ｜ 退货 RT-年月日-xxxxx ｜ 投诉 CO-年月日-xxxxx。<br>
        2. 业务闭环：采购保存即入库 → 销售单「完成」时扣库存并计入统计/佣金 → 退货自动回补库存并冲减销售额、欠款与佣金基数 → 结算管理按客户账期跟踪支付并生成超期预警。<br>
        3. 基础数据（类型/单位/供应商/级别/区域等）被业务引用后不可删除，只能停用；停用后新单据不可再选择，历史数据不受影响。<br>
        4. 佣金规则：佣金 = 名下客户已完成销售净额 × 已启用比例；资源合伙人级别由客户档案中的一/二/三级资源槽位决定。<br>
        5. 云端版：所有改动自动实时保存并同步给账套内其他成员；成员权限在「账户管理」中按菜单模块逐项设置。
      </div>
    </div>
  </div>`
};
