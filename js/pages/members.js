/* 账户管理：成员 / 邀请 / 权限（按模块逐项授权）— 仅 owner / admin 可见 */
window.Pages = window.Pages || {};

Pages['page-members'] = {
  data() {
    return {
      loading: false,
      members: [],
      invites: [],
      /* 添加 */
      showAdd: false,
      add: { email: '', role: 'member', permissions: {} },
      addMsg: '',
      /* 编辑 */
      showEdit: false,
      edit: null,        // { id, email, role, status, permissions }
      editMsg: '',
      /* 转让 */
      showTransfer: false,
      transferId: ''
    };
  },
  computed: {
    S() { return window.S; },
    P() { return window.P; },
    wsId() { return Cloud.state.ws ? Cloud.state.ws.id : null; },
    meId() { return Cloud.state.user ? Cloud.state.user.id : null; }
  },
  methods: {
    /* ---- 数据 ---- */
    async reload() {
      if (!this.wsId) return;
      this.loading = true;
      try {
        this.members = await Cloud.listMembers(this.wsId);
        this.invites = await Cloud.listInvites(this.wsId);
      } catch (e) { /* 静默 */ }
      this.loading = false;
    },

    /* ---- 添加成员 ---- */
    openAdd() {
      this.addMsg = '';
      this.add = { email: '', role: 'member', permissions: P.defaultPermissions() };
      this.showAdd = true;
    },
    setAddPerm(key, val) { this.add.permissions[key] = val; },
    async submitAdd() {
      const email = (this.add.email || '').trim();
      if (!email) return alert('请填写成员邮箱');
      this.addMsg = '提交中…';
      const r = await Cloud.addMember(this.wsId, email, this.add.role, P.normalize(this.add.permissions));
      this.addMsg = '';
      if (r.error) return alert(r.error);
      alert(r.result === 'invited'
        ? '该邮箱尚未注册，已生成邀请；对方注册后将自动加入本账套。'
        : '已将该成员加入本账套。');
      this.showAdd = false;
      await this.reload();
    },

    /* ---- 编辑成员（角色 / 权限 / 启用停用） ---- */
    openEdit(m) {
      this.editMsg = '';
      this.edit = {
        id: m.id, email: m.email || (m.name) || '—',
        role: m.role, status: m.status,
        permissions: P.normalize(m.permissions || {})
      };
      this.showEdit = true;
    },
    setEditPerm(key, val) { this.edit.permissions[key] = val; },
    async submitEdit() {
      const patch = {
        role: this.edit.role,
        permissions: P.normalize(this.edit.permissions)
      };
      const err = await Cloud.updateMember(this.edit.id, patch);
      if (err) return alert(err);
      /* 是我自己被改了 → 立即刷新当前账号权限与菜单 */
      if (this.edit.id === this.myMemberId()) await Cloud.refreshMyPermission();
      alert('已保存');
      this.showEdit = false;
      await this.reload();
    },
    async toggleStatus(m) {
      const next = m.status === '已停用' ? '已启用' : '已停用';
      const err = await Cloud.updateMember(m.id, { status: next });
      if (err) return alert(err);
      await this.reload();
    },
    async remove(m) {
      if (m.role === 'owner') return alert('创建者不可移除');
      if (!U.confirm(`确定将「${m.email || m.name}」移出本账套吗？`)) return;
      const err = await Cloud.removeMember(m.id);
      if (err) return alert(err);
      await this.reload();
    },

    /* ---- 转让所有权（仅 owner） ---- */
    openTransfer() {
      const cand = this.members.filter(m => m.role !== 'owner');
      this.transferId = cand.length ? cand[0].user_id : '';
      this.showTransfer = true;
    },
    async doTransfer() {
      if (!this.transferId) return alert('请选择接收人');
      if (!U.confirm('转让后您将不再是创建者（变为管理员），此操作不可撤销。确定继续吗？')) return;
      const err = await Cloud.transferOwnership(this.wsId, this.transferId);
      if (err) return alert(err);
      alert('所有权已转让');
      this.showTransfer = false;
      await Cloud.refreshMyPermission();
      await this.reload();
    },

    /* ---- 工具 ---- */
    roleLabel: P.roleLabel,
    summary(perms, role) { return P.summary(perms, role); },
    canRemove(m) { return m.role !== 'owner'; },
    isSelf(m) { return m.user_id === this.meId; },
    myMemberId() {
      const me = this.members.find(m => m.user_id === this.meId);
      return me ? me.id : null;
    },
    statusTag(status) {
      if (status === '已停用') return 'tag tag-gray';
      return 'tag tag-green';
    },
    roleTag(role) {
      return role === 'owner' ? 'tag tag-blue'
        : role === 'admin' ? 'tag tag-orange' : 'tag tag-gray';
    }
  },
  async created() { await this.reload(); },
  template: `
  <div>
    <div class="page-title">账户管理</div>
    <div class="card" v-if="!P.isManager()">
      只有账套创建者或管理员可以管理成员。如需调整权限请联系当前管理员。
    </div>

    <template v-if="P.isManager()">
      <!-- 成员列表 -->
      <div class="card">
        <h3>成员（{{members.length}}）
          <button class="btn btn-primary btn-sm" @click="openAdd">+ 添加成员</button>
          <button class="btn btn-sm" @click="reload" :disabled="loading">刷新</button>
        </h3>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>邮箱 / 名称</th><th>角色</th><th>权限</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in members" :key="m.id">
                <td>{{ m.email || '—' }} <span class="muted" v-if="isSelf(m)">（我）</span></td>
                <td><span :class="roleTag(m.role)">{{ roleLabel(m.role) }}</span></td>
                <td class="muted">{{ summary(m.permissions, m.role) }}</td>
                <td><span :class="statusTag(m.status)">{{ m.status || '已启用' }}</span></td>
                <td style="white-space:nowrap">
                  <button class="btn btn-sm" @click="openEdit(m)">编辑</button>
                  <button class="btn btn-sm" @click="toggleStatus(m)">
                    {{ m.status === '已停用' ? '启用' : '停用' }}
                  </button>
                  <button class="btn btn-sm btn-danger" v-if="canRemove(m)" @click="remove(m)">移除</button>
                </td>
              </tr>
              <tr v-if="!members.length"><td colspan="5" class="muted" style="text-align:center;padding:18px">暂无成员</td></tr>
            </tbody>
          </table>
        </div>
        <div style="margin-top:12px" v-if="P.isOwner()">
          <button class="btn" @click="openTransfer">转让账套所有权</button>
        </div>
      </div>

      <!-- 邀请中 -->
      <div class="card" v-if="invites.length">
        <h3>待接受的邀请（{{invites.length}}）</h3>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr><th>邮箱</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="iv in invites" :key="iv.id">
                <td>{{ iv.email }}</td>
                <td><span :class="roleTag(iv.role)">{{ roleLabel(iv.role) }}</span></td>
                <td><span class="tag tag-orange">{{ iv.status }}</span></td>
                <td><button class="btn btn-sm btn-danger" @click="remove({id: iv.id, role: 'member'})">取消邀请</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="form-hint">对方使用此邮箱注册后即可自动加入本账套。</div>
      </div>
    </template>

    <!-- 添加弹窗 -->
    <x-modal v-if="showAdd" title="添加成员" width="640" @close="showAdd=false">
      <div class="form-grid">
        <div class="form-item full"><label>成员邮箱<b class="req">*</b></label>
          <input type="text" v-model="add.email" placeholder="对方注册所用的邮箱"></div>
        <div class="form-item"><label>角色</label>
          <select v-model="add.role">
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </select></div>
      </div>
      <div style="margin:14px 0 6px;font-weight:600;color:#0f172a">模块权限</div>
      <div class="perm-grid">
        <div class="perm-row" v-for="m in P.MODULES" :key="m.key">
          <span class="perm-name">{{ m.ico }} {{ m.label }}<em v-if="m.readonly" class="muted">（只读）</em></span>
          <select :value="add.permissions[m.key]" @change="setAddPerm(m.key, $event.target.value)">
            <option v-if="m.readonly" value="none">无权限</option>
            <option v-if="m.readonly" value="view">仅查看</option>
            <option v-if="!m.readonly" value="none">无权限</option>
            <option v-if="!m.readonly" value="view">仅查看</option>
            <option v-if="!m.readonly" value="edit">可编辑</option>
          </select>
        </div>
      </div>
      <div class="form-hint" style="margin-top:8px">默认已为日常业务模块开放「可编辑」，财务 / 佣金 / 设置默认关闭，可按需调整。</div>
      <template #foot>
        <button class="btn" @click="showAdd=false">取消</button>
        <button class="btn btn-primary" @click="submitAdd">确定添加</button>
        <span class="muted" v-if="addMsg">{{ addMsg }}</span>
      </template>
    </x-modal>

    <!-- 编辑弹窗 -->
    <x-modal v-if="showEdit" title="编辑成员权限" width="640" @close="showEdit=false">
      <div class="muted" style="margin-bottom:8px">邮箱：{{ edit.email }} ｜ 当前角色：<b>{{ roleLabel(edit.role) }}</b></div>
      <div v-if="edit.role === 'owner'" class="form-hint">创建者拥有全部权限，无需单独设置。</div>
      <template v-else>
        <div class="form-grid" style="margin-bottom:10px">
          <div class="form-item"><label>角色</label>
            <select v-model="edit.role">
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select></div>
          <div class="form-item"><label>状态</label>
            <select v-model="edit.status">
              <option value="已启用">已启用</option>
              <option value="已停用">已停用</option>
            </select></div>
        </div>
        <div style="margin:6px 0;font-weight:600;color:#0f172a">模块权限</div>
        <div class="perm-grid">
          <div class="perm-row" v-for="m in P.MODULES" :key="m.key">
            <span class="perm-name">{{ m.ico }} {{ m.label }}<em v-if="m.readonly" class="muted">（只读）</em></span>
            <select :value="edit.permissions[m.key]" @change="setEditPerm(m.key, $event.target.value)">
              <option v-if="m.readonly" value="none">无权限</option>
              <option v-if="m.readonly" value="view">仅查看</option>
              <option v-if="!m.readonly" value="none">无权限</option>
              <option v-if="!m.readonly" value="view">仅查看</option>
              <option v-if="!m.readonly" value="edit">可编辑</option>
            </select>
          </div>
        </div>
      </template>
      <template #foot>
        <button class="btn" @click="showEdit=false">取消</button>
        <button class="btn btn-primary" @click="submitEdit">保存</button>
        <span class="muted" v-if="editMsg">{{ editMsg }}</span>
      </template>
    </x-modal>

    <!-- 转让弹窗 -->
    <x-modal v-if="showTransfer" title="转让账套所有权" width="520" @close="showTransfer=false">
      <div class="muted" style="margin-bottom:10px">转让后您将变为管理员，且无法再收回。请选择新的创建者：</div>
      <div class="form-item">
        <select v-model="transferId" style="width:100%">
          <option v-for="m in members.filter(x=>x.role!=='owner')" :key="m.id" :value="m.user_id">
            {{ m.email || m.name }}（{{ roleLabel(m.role) }}）
          </option>
        </select>
      </div>
      <template #foot>
        <button class="btn" @click="showTransfer=false">取消</button>
        <button class="btn btn-danger" @click="doTransfer">确认转让</button>
      </template>
    </x-modal>
  </div>`
};
