/* 云端接入层：Supabase 客户端 / 认证 / 账套 / 成员 */
window.Cloud = {
  sb: null,
  state: Vue.reactive({
    user: null,          // { id, email, name }
    workspaces: [],      // [{id,name,owner_id,role,permissions,member_count}]
    ws: null,            // 当前账套
    online: true,
    lastError: ''
  }),

  /* ---------- 客户端 ---------- */
  connect() {
    const c = CFG.read();
    if (!c) return null;
    this.sb = supabase.createClient(c.url, c.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'jxc.auth' },
      realtime: { params: { eventsPerSecond: 5 } }
    });
    return this.sb;
  },

  /* 连接自检：区分「地址错」「密钥错」「表没建」 */
  async healthCheck() {
    if (!this.sb) return '尚未连接';
    try {
      const { error } = await this.sb.from('workspaces').select('id').limit(1);
      if (!error) return null;
      const msg = String(error.message || '');
      if (/Invalid API key|JWT/i.test(msg)) return 'anon key 无效，请检查是否复制完整';
      if (/relation .* does not exist|schema cache/i.test(msg)) {
        return '数据库尚未初始化：请在 Supabase 控制台的 SQL Editor 里执行 sql/schema.sql';
      }
      return msg;
    } catch (e) {
      return '无法连接到 Supabase，请检查 Project URL 与网络：' + (e.message || e);
    }
  },

  /* ---------- 认证 ---------- */
  async restoreSession() {
    if (!this.sb) return null;
    const { data } = await this.sb.auth.getSession();
    if (data && data.session) { this._setUser(data.session.user); return this.state.user; }
    return null;
  },

  _setUser(u) {
    this.state.user = u ? {
      id: u.id,
      email: u.email,
      name: (u.user_metadata && u.user_metadata.name) || (u.email || '').split('@')[0]
    } : null;
  },

  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({
      email: String(email).trim(), password
    });
    if (error) return this._authErr(error);
    this._setUser(data.user);
    return null;
  },

  async signUp(email, password, name) {
    const { data, error } = await this.sb.auth.signUp({
      email: String(email).trim(), password,
      options: { data: { name: name || String(email).split('@')[0] } }
    });
    if (error) return this._authErr(error);
    /* 关闭邮箱验证时会直接返回 session */
    if (data.session) { this._setUser(data.user); return null; }
    return '__NEED_CONFIRM__';
  },

  async signOut() {
    try { await this.sb.auth.signOut(); } catch (e) { /* ignore */ }
    this.state.user = null;
    this.state.ws = null;
    this.state.workspaces = [];
  },

  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(String(email).trim(), {
      redirectTo: location.href.split('#')[0]
    });
    return error ? this._authErr(error) : null;
  },

  async changePassword(newPwd) {
    const { error } = await this.sb.auth.updateUser({ password: newPwd });
    return error ? this._authErr(error) : null;
  },

  _authErr(error) {
    const m = String(error.message || error);
    if (/Invalid login credentials/i.test(m)) return '邮箱或密码不正确';
    if (/Email not confirmed/i.test(m)) return '邮箱尚未验证，请查收验证邮件（或在 Supabase 后台关闭邮箱验证）';
    if (/User already registered/i.test(m)) return '该邮箱已注册，请直接登录';
    if (/Password should be at least/i.test(m)) return '密码太短，至少 6 位';
    if (/rate limit|too many/i.test(m)) return '操作过于频繁，请稍后再试';
    if (/Signups not allowed/i.test(m)) return '该项目已关闭注册，请联系管理员在 Supabase 后台开启';
    return m;
  },

  /* ---------- 账套 ---------- */
  /* 返回数组 = 成功（空数组表示确实没有账套）；返回 null = 读取失败（见 state.lastError） */
  async loadWorkspaces() {
    const { data, error } = await this.sb.rpc('my_workspaces');
    if (error) { this.state.lastError = this._dbErr(error); return null; }
    this.state.lastError = '';
    this.state.workspaces = data || [];
    return this.state.workspaces;
  },

  async createWorkspace(name) {
    const { data, error } = await this.sb.rpc('create_workspace', { ws_name: name });
    if (error) return { error: this._dbErr(error) };
    await this.loadWorkspaces();
    return { id: data };
  },

  async renameWorkspace(id, name) {
    const { error } = await this.sb.from('workspaces').update({ name }).eq('id', id);
    if (error) return this._dbErr(error);
    await this.loadWorkspaces();
    if (this.state.ws && this.state.ws.id === id) this.state.ws.name = name;
    return null;
  },

  async deleteWorkspace(id) {
    const { error } = await this.sb.from('workspaces').delete().eq('id', id);
    if (error) return this._dbErr(error);
    await this.loadWorkspaces();
    return null;
  },

  selectWorkspace(id) {
    const w = this.state.workspaces.find(x => x.id === id);
    if (!w) return false;
    this.state.ws = w;
    CFG.setLastWs(id);
    return true;
  },

  /* ---------- 成员 ---------- */
  async listMembers(wsId) {
    const { data, error } = await this.sb.rpc('workspace_members_view', { ws: wsId });
    if (error) { this.state.lastError = error.message; return []; }
    return data || [];
  },

  async addMember(wsId, email, role, permissions) {
    const { data, error } = await this.sb.rpc('add_member', {
      ws: wsId, member_email: email, member_role: role || 'member', perms: permissions || {}
    });
    if (error) return { error: this._dbErr(error) };
    return { result: data };  // 'joined' | 'invited'
  },

  async updateMember(memberId, patch) {
    const { error } = await this.sb.from('workspace_members').update(patch).eq('id', memberId);
    return error ? this._dbErr(error) : null;
  },

  async removeMember(memberId) {
    const { error } = await this.sb.from('workspace_members').delete().eq('id', memberId);
    return error ? this._dbErr(error) : null;
  },

  async listInvites(wsId) {
    const { data, error } = await this.sb.from('invites')
      .select('*').eq('workspace_id', wsId).eq('status', '待接受')
      .order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
  },

  async cancelInvite(id) {
    const { error } = await this.sb.from('invites').delete().eq('id', id);
    return error ? this._dbErr(error) : null;
  },

  async transferOwnership(wsId, newOwnerId) {
    const { error } = await this.sb.rpc('transfer_ownership', { ws: wsId, new_owner: newOwnerId });
    if (error) return this._dbErr(error);
    await this.loadWorkspaces();
    return null;
  },

  /* 刷新当前账套内我的权限（管理员改动后即时生效） */
  async refreshMyPermission() {
    if (!this.state.ws) return;
    const id = this.state.ws.id;
    await this.loadWorkspaces();
    const w = this.state.workspaces.find(x => x.id === id);
    if (w) this.state.ws = w;
  },

  _dbErr(error) {
    const m = String(error.message || error);
    if (/could not find the function|function .* does not exist|schema cache/i.test(m)) {
      return '数据库尚未初始化（缺少函数/表）：请在 Supabase 控制台 SQL Editor 完整执行 sql/schema.sql 后重试。\n原始信息：' + m;
    }
    if (/relation .* does not exist/i.test(m)) {
      return '数据表不存在：请在 Supabase 控制台 SQL Editor 完整执行 sql/schema.sql 后重试。\n原始信息：' + m;
    }
    if (/infinite recursion/i.test(m)) return '数据库策略递归：请重新完整执行一次 sql/schema.sql（旧策略未清干净）。';
    if (/row-level security|violates row-level/i.test(m)) return '权限不足：当前账号无权执行该操作';
    if (/duplicate key/i.test(m)) return '记录已存在';
    if (/不能移除账套创建者/.test(m)) return '不能移除账套创建者';
    if (/Failed to fetch|NetworkError/i.test(m)) return '网络连接失败：请检查网络或 Project URL 是否正确';
    return m;
  }
};
