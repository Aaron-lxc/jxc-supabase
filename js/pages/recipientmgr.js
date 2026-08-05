/* 报表接收人管理：设置/清除成员作为报表接收人及其报表角色（替代手写 SQL）— 仅 owner / admin 可见 */
window.Pages = window.Pages || {};

Pages['page-recipientmgr'] = {
  data() {
    return {
      loading: false,
      members: [],
      recips: [],
      showSet: false,
      setForm: { user_id: '', email: '', role: 'none', partnerId: null },
      setMsg: ''
    };
  },
  computed: {
    S() { return window.S; },
    P() { return window.P; },
    wsId() { return Cloud.state.ws ? Cloud.state.ws.id : null; },
    partnerOpts() {
      if (this.setForm.role !== 'resource' && this.setForm.role !== 'region') return [];
      const coll = this.setForm.role === 'region' ? 'regionPartners' : 'resourcePartners';
      return (this.S.db[coll] || []).map(p => ({ value: p.id, label: p.name }));
    }
  },
  methods: {
    recipientOf(m) { return this.recips.find(r => r.auth_uid === m.user_id) || null; },
    rpLabel(role) {
      return { resource: '资源合伙人', region: '区域合伙人', arrears: '对账人', stock: '库管', manager: '管理者' }[role] || '—';
    },
    roleTag(role) {
      return role === 'owner' ? 'tag tag-blue'
        : role === 'admin' ? 'tag tag-orange' : 'tag tag-gray';
    },
    roleLabel: P.roleLabel,
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
      this.setForm = {
        user_id: m.user_id,
        email: m.email || m.name || '—',
        role: r ? r.role : 'none',
        partnerId: r ? r.partner_id : null
      };
      this.setMsg = '';
      this.showSet = true;
    },
    onRoleChange() { this.setForm.partnerId = null; },
    async submitSet() {
      const f = this.setForm;
      if (f.role === 'none') return alert('请选择报表角色');
      if ((f.role === 'resource' || f.role === 'region') && !f.partnerId) return alert('请选择对应的合伙人');
      const m = this.members.find(x => x.user_id === f.user_id);
      /* 仅普通成员设为接收人时降级为「报表」(RLS 禁读核心)；创建者/管理员保留原角色，
         仅写 recipient_profiles 以获得报表中心预览，不影响其全部操作权限 */
      if (m && m.role === 'member') {
        const e = await Cloud.updateMember(m.id, { role: '报表' });
        if (e) return alert(e);
      }
      const payload = { role: f.role };
      if (f.role === 'resource' || f.role === 'region') {
        const coll = f.role === 'region' ? 'regionPartners' : 'resourcePartners';
        const p = (this.S.db[coll] || []).find(x => x.id === f.partnerId);
        payload.partner_id = f.partnerId;
        payload.partner_type = f.role === 'region' ? '区域' : '资源';
        payload.partner_name = p ? p.name : '';
      } else {
        payload.partner_id = null; payload.partner_type = null; payload.partner_name = null;
      }
      const err = await Cloud.upsertRecipient(this.wsId, f.user_id, payload);
      if (err) return alert(err);
      alert('已保存');
      this.showSet = false;
      await this.reload();
    },
    async clearRecipient(m) {
      if (!U.confirm('取消「' + (m.email || m.name) + '」的报表接收人身份吗？')) return;
      const err = await Cloud.deleteRecipient(this.wsId, m.user_id);
      if (err) return alert(err);
      const mm = this.members.find(x => x.user_id === m.user_id);
      if (mm && mm.role === '报表') {
        const e = await Cloud.updateMember(mm.id, { role: 'member' });
        if (e) return alert(e);
      }
      alert('已取消');
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
          选择合伙人角色时需指定具体合伙人；内部角色（对账人 / 库管 / 管理者）无需指定。
        </div>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr><th>邮箱 / 名称</th><th>成员角色</th><th>报表角色</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="m in members" :key="m.id">
                <td>{{ m.email || m.name || '—' }}</td>
                <td><span :class="roleTag(m.role)">{{ roleLabel(m.role) }}</span></td>
                <td>{{ recipientOf(m) ? rpLabel(recipientOf(m).role) : '—' }}</td>
                <td style="white-space:nowrap">
                  <button class="btn btn-sm" @click="openSet(m)">设置</button>
                  <button class="btn btn-sm btn-danger" v-if="recipientOf(m)" @click="clearRecipient(m)">取消</button>
                </td>
              </tr>
              <tr v-if="!members.length"><td colspan="4" class="muted" style="text-align:center;padding:18px">暂无成员</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <x-modal v-if="showSet" title="设置报表接收人" width="560" @close="showSet=false">
        <div class="muted" style="margin-bottom:8px">成员：{{ setForm.email }}</div>
        <div class="form-grid">
          <div class="form-item"><label>报表角色</label>
            <select v-model="setForm.role" @change="onRoleChange">
              <option value="none">— 不设为接收人 —</option>
              <option value="resource">资源合伙人</option>
              <option value="region">区域合伙人</option>
              <option value="arrears">对账人</option>
              <option value="stock">库管</option>
              <option value="manager">管理者</option>
            </select></div>
          <div class="form-item" v-if="setForm.role==='resource' || setForm.role==='region'"><label>对应合伙人</label>
            <select v-model="setForm.partnerId">
              <option :value="null">请选择</option>
              <option v-for="o in partnerOpts" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select></div>
        </div>
        <div class="form-hint">设为接收人后：普通成员的角色会调整为「报表」，仅可查看报表中心、无法访问业务数据；创建者/管理员保留原有全部权限，仅额外获得报表中心入口。报表中心显示内容由下方所选报表角色决定。</div>
        <template #foot>
          <button class="btn" @click="showSet=false">取消</button>
          <button class="btn btn-primary" @click="submitSet">保存</button>
        </template>
      </x-modal>
    </template>
  </div>`
};
