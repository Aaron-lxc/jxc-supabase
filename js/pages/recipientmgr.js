/* 报表接收人管理：设置/清除成员作为报表接收人及其报表角色（替代手写 SQL）— 仅 owner / admin 可见 */
window.Pages = window.Pages || {};

Pages['page-recipientmgr'] = {
  data() {
    return {
      loading: false,
      members: [],
      recips: [],
      showSet: false,
      setForm: { user_id: '', email: '', role: 'none', bindings: [] },
      setMsg: '',
      // 筛选
      fEmail: '',
      fRole: 'all',
      fRpRole: 'all',
      fStatus: 'all',
      fCreatedFrom: '',
      fCreatedTo: ''
    };
  },
  computed: {
    S() { return window.S; },
    P() { return window.P; },
    wsId() { return Cloud.state.ws ? Cloud.state.ws.id : null; },
    filteredMembers() {
      const kw = (this.fEmail || '').trim().toLowerCase();
      const cf = this.fCreatedFrom, ct = this.fCreatedTo;
      return this.members.filter(m => {
        const r = this.recipientOf(m);
        if (kw) {
          const hay = (m.email || m.name || '').toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        if (this.fRole !== 'all' && m.role !== this.fRole) return false;
        if (this.fRpRole !== 'all') {
          if (!r) return false;
          const matchBind = r.bindings && r.bindings.some(b => (b.partner_type === '区域' ? 'region' : 'resource') === this.fRpRole);
          if (r.role !== this.fRpRole && !matchBind) return false;
        }
        if (this.fStatus !== 'all' && (!r || r.status !== this.fStatus)) return false;
        if ((cf || ct) && (!r || !this.inCreatedRange(r.created_at))) return false;
        return true;
      });
    }
  },
  methods: {
    partnerOptsFor(type) {
      if (!type) return [];
      const coll = type === '区域' ? 'regionPartners' : 'resourcePartners';
      return (this.S.db[coll] || []).map(p => ({ value: p.id, label: p.name }));
    },
    nameOf(type, pid) {
      const coll = type === '区域' ? 'regionPartners' : 'resourcePartners';
      const p = (this.S.db[coll] || []).find(x => x.id === pid);
      return p ? p.name : '';
    },
    recipientOf(m) { return this.recips.find(r => r.auth_uid === m.user_id) || null; },
    rpLabel(role) {
      return { resource: '资源合伙人', region: '区域合伙人' }[role] || '—';
    },
    rpLabelOf(m) {
      const r = this.recipientOf(m);
      if (!r) return '—';
      if (r.bindings && r.bindings.length > 1) return '资源+区域';
      return this.rpLabel(r.role);
    },
    roleTag(role) {
      return role === 'owner' ? 'tag tag-blue'
        : role === 'admin' ? 'tag tag-orange'
        : role === '报表' ? 'tag tag-gray' : 'tag tag-gray';
    },
    statusTag(s) { return s === '启用' ? 'tag tag-green' : 'tag tag-gray'; },
    roleLabel: P.roleLabel,
    memberRoleLabel(r) { return { owner: '创建者', admin: '管理员', member: '成员', '报表': '报表' }[r] || r; },
    fmt(ts) {
      if (!ts) return '—';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '—';
      const p = n => (n < 10 ? '0' : '') + n;
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    },
    inCreatedRange(ts) {
      if (!ts) return false;
      const d = new Date(ts);
      if (isNaN(d.getTime())) return false;
      if (this.fCreatedFrom && d < new Date(this.fCreatedFrom + 'T00:00:00')) return false;
      if (this.fCreatedTo && d > new Date(this.fCreatedTo + 'T23:59:59.999')) return false;
      return true;
    },
    resetFilter() {
      this.fEmail = ''; this.fRole = 'all'; this.fRpRole = 'all';
      this.fStatus = 'all'; this.fCreatedFrom = ''; this.fCreatedTo = '';
    },
    async reload() {
      if (!this.wsId) return;
      this.loading = true;
      try {
        this.members = await Cloud.listMembers(this.wsId);
        this.recips = await Cloud.listRecipients(this.wsId);
      } catch (e) { /* 静默 */ }
      this.loading = false;
    },
    openSet(m) {
      const r = this.recipientOf(m);
      const binds = (r && r.bindings && r.bindings.length)
        ? r.bindings.map(b => ({ type: b.partner_type === '区域' ? '区域' : '资源', partnerId: b.partner_id }))
        : (r && r.partner_id ? [{ type: r.partner_type === '区域' ? '区域' : '资源', partnerId: r.partner_id }] : []);
      this.setForm = {
        user_id: m.user_id,
        email: m.email || m.name || '—',
        role: r ? r.role : 'none',
        bindings: binds.length ? binds : [{ type: '资源', partnerId: null }]
      };
      this.setMsg = '';
      this.showSet = true;
    },
    addBinding() { this.setForm.bindings.push({ type: '资源', partnerId: null }); },
    removeBinding(i) { this.setForm.bindings.splice(i, 1); },
    async submitSet() {
      const f = this.setForm;
      const binds = (f.bindings || []).filter(b => b.type && b.partnerId);
      if (!binds.length) return alert('请至少添加一个绑定（资源/区域 + 对应合伙人）');
      const seen = new Set();
      for (const b of binds) {
        const key = b.type + ':' + b.partnerId;
        if (seen.has(key)) return alert('存在重复绑定：' + b.type + ' 同一合伙人');
        seen.add(key);
      }
      const m = this.members.find(x => x.user_id === f.user_id);
      /* 仅普通成员设为接收人时降级为「报表」(RLS 禁读核心)；创建者/管理员保留原角色，
         仅写 recipient_profiles 以获得报表中心预览，不影响其全部操作权限 */
      if (m && m.role === 'member') {
        const e = await Cloud.updateMember(m.id, { role: '报表' });
        if (e) return alert(e);
      }
      const first = binds[0];
      const payload = {
        role: first.type === '区域' ? 'region' : 'resource',
        status: '启用',
        partner_id: first.partnerId,
        partner_type: first.type,
        partner_name: this.nameOf(first.type, first.partnerId),
        bindings: binds.map(b => ({
          partner_id: b.partnerId,
          partner_type: b.type,
          partner_name: this.nameOf(b.type, b.partnerId)
        }))
      };
      const err = await Cloud.upsertRecipient(this.wsId, f.user_id, payload);
      if (err) return alert(err);
      alert('已保存');
      this.showSet = false;
      await this.reload();
    },
    /* 启用 / 停用：切换 recipient_profiles.status；普通成员启用时降级为「报表」锁数据，停用时恢复为「成员」 */
    async toggleStatus(m) {
      const r = this.recipientOf(m);
      if (!r) return;
      const next = r.status === '启用' ? '未启用' : '启用';
      if (m.role === 'member') {
        const target = next === '启用' ? '报表' : 'member';
        if (m.role !== target) {
          const e = await Cloud.updateMember(m.id, { role: target });
          if (e) return alert(e);
        }
      }
      const err = await Cloud.setRecipientStatus(this.wsId, m.user_id, next);
      if (err) return alert(err);
      alert(next === '启用' ? '已启用该接收人' : '已停用该接收人');
      await this.reload();
    },
    /* 删除接收人档案；若其成员角色为「报表」则恢复为「成员」 */
    async removeRecipient(m) {
      if (!this.recipientOf(m)) return;
      if (!U.confirm('删除「' + (m.email || m.name) + '」的报表接收人档案吗？')) return;
      const err = await Cloud.deleteRecipient(this.wsId, m.user_id);
      if (err) return alert(err);
      const mm = this.members.find(x => x.user_id === m.user_id);
      if (mm && mm.role === '报表') {
        const e = await Cloud.updateMember(mm.id, { role: 'member' });
        if (e) return alert(e);
      }
      alert('已删除');
      await this.reload();
    }
  },
  async created() { await this.reload(); },
  template: `
  <div>
    <div class="page-title">报表接收人管理</div>
    <div class="card" v-if="!P.isManager()">
      只有账套创建者或管理员可以管理报表接收人。
    </div>
    <template v-else>
      <div class="card">
        <h3>成员报表角色（{{members.length}}）</h3>
        <div class="form-hint" style="margin:0 0 10px">
          在此把成员设为「报表接收人」：普通成员登录后只能看到「报表中心」，且被 RLS 禁止直接读取业务原始数据（安全）。
          创建者/管理员保留全部操作权限，设置后仅额外获得「报表中心」入口用于预览。
          选择合伙人角色时需指定具体合伙人。
        </div>

        <!-- 筛选栏 -->
        <div class="filter-grid" style="margin-bottom:10px">
          <div class="form-item"><label>邮箱 / 名称（模糊）</label>
            <input type="text" v-model="fEmail" placeholder="含关键词即可" /></div>
          <div class="form-item"><label>成员角色</label>
            <select v-model="fRole">
              <option value="all">全部</option>
              <option value="owner">创建者</option>
              <option value="admin">管理员</option>
              <option value="member">成员</option>
              <option value="报表">报表</option>
            </select></div>
          <div class="form-item"><label>报表角色</label>
            <select v-model="fRpRole">
              <option value="all">全部</option>
              <option value="resource">资源合伙人</option>
              <option value="region">区域合伙人</option>
            </select></div>
          <div class="form-item"><label>状态</label>
            <select v-model="fStatus">
              <option value="all">全部</option>
              <option value="启用">启用</option>
              <option value="未启用">未启用</option>
            </select></div>
          <div class="form-item"><label>创建时间（起）</label>
            <input type="date" v-model="fCreatedFrom" /></div>
          <div class="form-item"><label>创建时间（止）</label>
            <input type="date" v-model="fCreatedTo" /></div>
          <div class="form-item" style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-sm" @click="resetFilter">重置筛选</button>
            <span class="muted">共 {{filteredMembers.length}} 条</span>
          </div>
        </div>

        <div class="table-wrap">
          <table class="grid">
            <thead><tr>
              <th>邮箱 / 名称</th><th>成员角色</th><th>报表角色</th><th>状态</th><th>创建时间</th><th>操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="m in filteredMembers" :key="m.id">
                <td data-label="邮箱 / 名称">{{ m.email || m.name || '—' }}</td>
                <td data-label="成员角色"><span :class="roleTag(m.role)">{{ memberRoleLabel(m.role) }}</span></td>
                <td data-label="报表角色">{{ rpLabelOf(m) }}</td>
                <td data-label="状态"><span v-if="recipientOf(m)" :class="statusTag(recipientOf(m).status)">{{ recipientOf(m).status }}</span><span v-else class="muted">—</span></td>
                <td data-label="创建时间">{{ recipientOf(m) ? fmt(recipientOf(m).created_at) : '—' }}</td>
                <td style="white-space:nowrap" data-label="操作">
                  <template v-if="m.role === 'owner'"><span class="muted">—</span></template>
                  <template v-else>
                    <button class="btn btn-sm" @click="openSet(m)">设置</button>
                    <button class="btn btn-sm" :disabled="!recipientOf(m)" @click="toggleStatus(m)">
                      {{ recipientOf(m) && recipientOf(m).status === '启用' ? '停用' : '启用' }}
                    </button>
                    <button class="btn btn-sm btn-danger" :disabled="!recipientOf(m)" @click="removeRecipient(m)">删除</button>
                  </template>
                </td>
              </tr>
              <tr v-if="!filteredMembers.length"><td colspan="6" class="muted" style="text-align:center;padding:18px">暂无匹配成员</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <x-modal v-if="showSet" title="设置报表接收人" width="560" :fullscreen="$root.isMobile" position="bottom" @close="showSet=false">
        <div class="muted" style="margin-bottom:8px">成员：{{ setForm.email }}｜可同时绑定「资源合伙人」与「区域合伙人」，登录后合并查看两类报表并合计。</div>
        <div class="form-item full"><label>绑定报表角色（至少 1 个）</label>
          <div v-for="(b,i) in setForm.bindings" :key="i" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
            <select v-model="b.type" style="width:130px">
              <option value="资源">资源合伙人</option>
              <option value="区域">区域合伙人</option>
            </select>
            <select v-model="b.partnerId" style="flex:1">
              <option :value="null">请选择合伙人</option>
              <option v-for="o in partnerOptsFor(b.type)" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <span v-if="setForm.bindings.length > 1" class="link danger" style="cursor:pointer;white-space:nowrap" @click="removeBinding(i)">移除</span>
          </div>
          <button class="btn btn-sm" @click="addBinding">+ 添加绑定</button>
        </div>
        <div class="form-hint">设为接收人后：普通成员的角色会调整为「报表」，仅可查看报表中心、无法访问业务数据；创建者/管理员保留原有全部权限，仅额外获得报表中心入口。新接收人默认为「启用」状态。同一个账号同时绑定资源与区域时，报表中心会展示「资源佣金账户」「区域佣金账户」以及两类合计。</div>
        <template #foot>
          <button class="btn" @click="showSet=false">取消</button>
          <button class="btn btn-primary" @click="submitSet">保存</button>
        </template>
      </x-modal>
    </template>
  </div>`
};
