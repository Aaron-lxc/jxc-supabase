/* 账户管理：成员 / 邀请 / 权限（按模块逐项授权）— 仅 owner / admin 可见 */
window.Pages = window.Pages || {};

Pages['page-members'] = {
  data() {
    return {
      loading: false,
      members: [],
      invites: [],
      /* 检索条件 */
      filter: {
        email: '', role: '', status: '',
        realName: '',
        createdStart: '', createdEnd: '',
        loginStart: '', loginEnd: ''
      },
      /* 添加 */
      showAdd: false,
      add: { email: '', role: 'member', realName: '', permissions: {} },
      addMsg: '',
      /* 编辑成员 */
      showEdit: false,
      edit: null,        // { id, email, role, status, permissions }
      editMsg: '',
      /* 编辑邀请 */
      showInviteEdit: false,
      inviteEdit: null,   // { id, email, role, permissions }
      inviteEditMsg: '',
      /* 转让 */
      showTransfer: false,
      transferId: ''
    };
  },
  computed: {
    S() { return window.S; },
    P() { return window.P; },
    wsId() { return Cloud.state.ws ? Cloud.state.ws.id : null; },
    meId() { return Cloud.state.user ? Cloud.state.user.id : null; },

    /* 成员筛选结果 */
    filteredMembers() {
      const f = this.filter;
      const kw = (f.email || '').trim().toLowerCase();
      const nkw = (f.realName || '').trim().toLowerCase();
      return this.members.filter(m => {
        if (kw && !String(m.email || '').toLowerCase().includes(kw)) return false;
        if (nkw && !String(m.name || '').toLowerCase().includes(nkw)) return false;
        if (f.role && m.role !== f.role) return false;
        if (f.status && (m.status || '已启用') !== f.status) return false;
        if (f.createdStart && this.dateOnly(m.created_at) < f.createdStart) return false;
        if (f.createdEnd && this.dateOnly(m.created_at) > f.createdEnd) return false;
        if (f.loginStart && (!m.last_sign_in_at || this.dateOnly(m.last_sign_in_at) < f.loginStart)) return false;
        if (f.loginEnd && (!m.last_sign_in_at || this.dateOnly(m.last_sign_in_at) > f.loginEnd)) return false;
        return true;
      });
    },

    /* 邀请筛选结果（无登录时间，按邮箱/角色/创建时间） */
    filteredInvites() {
      const f = this.filter;
      const kw = (f.email || '').trim().toLowerCase();
      const nkw = (f.realName || '').trim().toLowerCase();
      return this.invites.filter(iv => {
        if (kw && !String(iv.email || '').toLowerCase().includes(kw)) return false;
        if (nkw && !String(iv.name || '').toLowerCase().includes(nkw)) return false;
        if (f.role && iv.role !== f.role) return false;
        if (f.status && iv.status !== f.status) return false;
        if (f.createdStart && this.dateOnly(iv.created_at) < f.createdStart) return false;
        if (f.createdEnd && this.dateOnly(iv.created_at) > f.createdEnd) return false;
        return true;
      });
    }
  },
  methods: {
    /* ---- 工具 ---- */
    fmt(ts) {
      if (!ts) return '—';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '—';
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    dateOnly(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },
    resetFilter() {
      this.filter = { email: '', role: '', status: '', realName: '', createdStart: '', createdEnd: '', loginStart: '', loginEnd: '' };
    },

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
      this.add = { email: '', role: 'member', realName: '', permissions: P.defaultPermissions() };
      this.showAdd = true;
    },
    setAddPerm(key, val) { this.add.permissions[key] = val; },
    async submitAdd() {
      const email = (this.add.email || '').trim();
      if (!email) return alert('请填写成员邮箱');
      this.addMsg = '提交中…';
      const r = await Cloud.addMember(this.wsId, email, this.add.role, P.normalize(this.add.permissions), this.add.realName);
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
      if (m.role === 'owner') return alert('创建者账号不可被停用 / 启用');
      const next = (m.status === '未启用' || m.status === '已停用') ? '已启用' : '未启用';
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

    /* ---- 邀请：删除 / 修改 / 启用 ---- */
    async cancelInvite(iv) {
      if (!U.confirm(`确定取消向「${iv.email}」的邀请吗？`)) return;
      const err = await Cloud.cancelInvite(iv.id);
      if (err) return alert(err);
      await this.reload();
    },
    openInviteEdit(iv) {
      this.inviteEditMsg = '';
      this.inviteEdit = {
        id: iv.id, email: iv.email,
        role: iv.role || 'member',
        permissions: P.normalize(iv.permissions || {})
      };
      this.showInviteEdit = true;
    },
    setInvitePerm(key, val) { this.inviteEdit.permissions[key] = val; },
    async submitInviteEdit() {
      const patch = { role: this.inviteEdit.role, permissions: P.normalize(this.inviteEdit.permissions) };
      const err = await Cloud.updateInvite(this.inviteEdit.id, patch);
      if (err) return alert(err);
      alert('邀请已更新');
      this.showInviteEdit = false;
      await this.reload();
    },
    async enableInvite(iv) {
      const err = await Cloud.updateInvite(iv.id, { created_at: new Date().toISOString(), status: '待接受' });
      if (err) return alert(err);
      alert('已重新发起邀请（邀请时间已刷新）');
      await this.reload();
    },
    async deleteInvite(iv) {
      if (!U.confirm(`确定彻底删除「${iv.email}」的邀请吗？此操作不可恢复。`)) return;
      const err = await Cloud.deleteInvite(iv.id);
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

    /* ---- 公共 ---- */
    roleLabel: P.roleLabel,
    summary(perms, role) { return P.summary(perms, role); },
    canRemove(m) { return m.role !== 'owner'; },
    isSelf(m) { return m.user_id === this.meId; },
    myMemberId() {
      const me = this.members.find(m => m.user_id === this.meId);
      return me ? me.id : null;
    },
    statusTag(status) {
      if (status === '未启用' || status === '已停用') return 'tag tag-gray';
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
      <!-- 检索栏 -->
      <div class="card">
        <div class="filter-grid">
          <div class="form-item"><label>邮箱（模糊）</label><input type="text" v-model="filter.email" placeholder="含关键词即可"></div>
          <div class="form-item"><label>真实姓名（模糊）</label><input type="text" v-model="filter.realName" placeholder="按姓名模糊匹配"></div>
          <div class="form-item"><label>角色</label>
            <select v-model="filter.role">
              <option value="">全部</option>
              <option value="owner">创建者</option>
              <option value="admin">管理员</option>
              <option value="member">成员</option>
            </select></div>
          <div class="form-item"><label>状态</label>
            <select v-model="filter.status">
              <option value="">全部</option>
              <option value="待接受">待接受</option>
              <option value="已取消">已取消</option>
              <option value="未启用">未启用</option>
              <option value="已启用">已启用</option>
            </select></div>
          <div class="form-item"><label>创建时间（起）</label><input type="date" v-model="filter.createdStart"></div>
          <div class="form-item"><label>创建时间（止）</label><input type="date" v-model="filter.createdEnd"></div>
          <div class="form-item"><label>最新登录（起）</label><input type="date" v-model="filter.loginStart"></div>
          <div class="form-item"><label>最新登录（止）</label><input type="date" v-model="filter.loginEnd"></div>
          <div class="form-item filter-actions"><button class="btn btn-sm" @click="resetFilter">重置筛选</button></div>
        </div>
      </div>

      <!-- 成员列表 -->
      <div class="card">
        <h3>成员（{{filteredMembers.length}}）
          <button class="btn btn-primary btn-sm" @click="openAdd">+ 添加成员</button>
          <button class="btn btn-sm" @click="reload" :disabled="loading">刷新</button>
        </h3>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>邮箱 / 名称</th><th>角色</th><th>权限</th><th>状态</th>
                <th>创建时间</th><th>最新登录时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in filteredMembers" :key="m.id">
                <td data-label="邮箱 / 名称">{{ m.email || '—' }} <span class="muted" v-if="m.name">（{{ m.name }}）</span> <span class="muted" v-if="isSelf(m)">（我）</span></td>
                <td data-label="角色"><span :class="roleTag(m.role)">{{ roleLabel(m.role) }}</span></td>
                <td class="muted" data-label="权限">{{ summary(m.permissions, m.role) }}</td>
                <td data-label="状态"><span :class="statusTag(m.status)">{{ m.status || '已启用' }}</span></td>
                <td class="col-created muted" data-label="创建时间">{{ fmt(m.created_at) }}</td>
                <td class="col-login muted" data-label="最新登录时间">{{ fmt(m.last_sign_in_at) }}</td>
                <td style="white-space:nowrap" data-label="操作">
                  <template v-if="m.role === 'owner'"><span class="muted">—</span></template>
                  <template v-else>
                    <button class="btn btn-sm" @click="openEdit(m)">修改</button>
                    <button class="btn btn-sm" @click="toggleStatus(m)">
                      {{ (m.status === '未启用' || m.status === '已停用') ? '启用' : '停用' }}
                    </button>
                    <button class="btn btn-sm btn-danger" :disabled="m.status !== '未启用'" @click="remove(m)">删除</button>
                  </template>
                </td>
              </tr>
              <tr v-if="!filteredMembers.length"><td colspan="7" class="muted" style="text-align:center;padding:18px">暂无匹配成员</td></tr>
            </tbody>
          </table>
        </div>
        <div style="margin-top:12px" v-if="P.isOwner()">
          <button class="btn" @click="openTransfer">转让账套所有权</button>
        </div>
      </div>

      <!-- 邀请中 -->
      <div class="card" v-if="invites.length">
        <h3>待接受的邀请（{{filteredInvites.length}}）</h3>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr><th>邮箱</th><th>名称</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="iv in filteredInvites" :key="iv.id">
                <td data-label="邮箱">{{ iv.email }}</td>
                <td data-label="名称" class="muted">{{ iv.name || '—' }}</td>
                <td data-label="角色"><span :class="roleTag(iv.role)">{{ roleLabel(iv.role) }}</span></td>
                <td data-label="状态"><span class="tag tag-orange">{{ iv.status }}</span></td>
                <td class="col-created muted" data-label="创建时间">{{ fmt(iv.created_at) }}</td>
                <td style="white-space:nowrap" data-label="操作">
                  <button class="btn btn-sm" @click="iv.status === '已取消' ? enableInvite(iv) : cancelInvite(iv)">
                    {{ iv.status === '已取消' ? '重新邀请' : '取消邀请' }}
                  </button>
                  <button class="btn btn-sm" @click="openInviteEdit(iv)">修改</button>
                  <button class="btn btn-sm btn-danger" :disabled="iv.status !== '已取消'" @click="deleteInvite(iv)">删除</button>
                </td>
              </tr>
              <tr v-if="!filteredInvites.length"><td colspan="6" class="muted" style="text-align:center;padding:18px">暂无匹配邀请</td></tr>
            </tbody>
          </table>
        </div>
        <div class="form-hint">对方使用此邮箱注册后即可自动加入本账套。</div>
      </div>
    </template>

    <!-- 添加弹窗 -->
    <x-modal v-if="showAdd" title="添加成员" width="640" :fullscreen="$root.isMobile" position="bottom" @close="showAdd=false">
      <div class="form-grid">
        <div class="form-item full"><label>成员邮箱<b class="req">*</b></label>
          <input type="text" v-model="add.email" placeholder="对方注册所用的邮箱"></div>
        <div class="form-item full"><label>真实姓名</label>
          <input type="text" v-model="add.realName" placeholder="选填，留空则注册后显示邮箱前缀"></div>
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

    <!-- 编辑成员弹窗 -->
    <x-modal v-if="showEdit" title="修改成员权限" width="640" :fullscreen="$root.isMobile" position="bottom" @close="showEdit=false">
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
              <option value="未启用">未启用</option>
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

    <!-- 编辑邀请弹窗 -->
    <x-modal v-if="showInviteEdit" title="修改邀请" width="640" :fullscreen="$root.isMobile" position="bottom" @close="showInviteEdit=false">
      <div class="muted" style="margin-bottom:8px">邀请邮箱：{{ inviteEdit.email }}</div>
      <div class="form-grid" style="margin-bottom:10px">
        <div class="form-item"><label>角色</label>
          <select v-model="inviteEdit.role">
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </select></div>
      </div>
      <div style="margin:6px 0;font-weight:600;color:#0f172a">模块权限</div>
      <div class="perm-grid">
        <div class="perm-row" v-for="m in P.MODULES" :key="m.key">
          <span class="perm-name">{{ m.ico }} {{ m.label }}<em v-if="m.readonly" class="muted">（只读）</em></span>
          <select :value="inviteEdit.permissions[m.key]" @change="setInvitePerm(m.key, $event.target.value)">
            <option v-if="m.readonly" value="none">无权限</option>
            <option v-if="m.readonly" value="view">仅查看</option>
            <option v-if="!m.readonly" value="none">无权限</option>
            <option v-if="!m.readonly" value="view">仅查看</option>
            <option v-if="!m.readonly" value="edit">可编辑</option>
          </select>
        </div>
      </div>
      <template #foot>
        <button class="btn" @click="showInviteEdit=false">取消</button>
        <button class="btn btn-primary" @click="submitInviteEdit">保存</button>
        <span class="muted" v-if="inviteEditMsg">{{ inviteEditMsg }}</span>
      </template>
    </x-modal>

    <!-- 转让弹窗 -->
    <x-modal v-if="showTransfer" title="转让账套所有权" width="520" :fullscreen="$root.isMobile" @close="showTransfer=false">
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
