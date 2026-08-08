/* 云端接入层：Supabase 客户端 / 认证 / 账套 / 成员 */
window.Cloud = {
  sb: null,
  state: Vue.reactive({
    user: null,          // { id, email, name }
    workspaces: [],      // [{id,name,owner_id,role,permissions,member_count}]
    ws: null,            // 当前账套
    recipient: null,     // 当前用户在所选账套的报表接收人档案（null=非接收人）
    online: true,
    lastError: '',
    globalHasWs: false   // 全局是否已有账套（建账套权限判断用）
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

  /* 受邀注册通道：调用 Edge Function（service_role 创建用户 + 接受邀请）。
     仅被邀请邮箱可成功；无有效邀请返回 403 中文提示。返回 null=成功，字符串=错误。 */
  async inviteSignup(email, password, name) {
    try {
      const cfg = CFG.read() || {};
      const base = cfg.url || '';
      if (!base) return '未配置 Supabase 连接';
      const res = await fetch(base + '/functions/v1/invite-signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.anonKey || ''
        },
        body: JSON.stringify({ email: String(email).trim(), password, name: name || '' })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) return (j && j.error) || ('注册失败（HTTP ' + res.status + '）');
      return null;
    } catch (e) { return String((e && e.message) || e); }
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
    // 记录全局是否已有账套（首个账套放开创建，之后仅管理员可建）
    try {
      const r = await this.sb.rpc('any_workspace_exists');
      if (!r.error) this.state.globalHasWs = !!r.data;
    } catch (_) { /* 忽略：不影响主流程 */ }
    return this.state.workspaces;
  },

  async createWorkspace(name) {
    // 权限闸门：全局无账套（引导）放开首个账套；之后仅账套创建者(owner)可新建
    try {
      const { data: hasAny, error: e1 } = await this.sb.rpc('any_workspace_exists');
      if (e1) return { error: this._dbErr(e1) };
      if (hasAny) {
        const mine = this.state.workspaces || [];
        const can = mine.some(w => w.role === 'owner');
        if (!can) {
          return { error: '只有账套创建者可以创建新账套。' };
        }
      }
    } catch (e) { return { error: this._dbErr(e) }; }
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

  /* 读取当前用户在所选账套的报表接收人档案（null 表示不是接收人） */
  async loadRecipient(wsId) {
    this.state.recipient = null;
    if (!this.sb || !this.state.user || !wsId) return null;
    const { data, error } = await this.sb
      .from('recipient_profiles').select('*')
      .eq('ws_id', wsId).eq('auth_uid', this.state.user.id).eq('status', '启用').maybeSingle();
    if (error) return null;
    this.state.recipient = data || null;
    return this.state.recipient;
  },

  /* ---------- 报表接收人档案 ---------- */
  async listRecipients(wsId) {
    const { data, error } = await this.sb.from('recipient_profiles').select('*').eq('ws_id', wsId);
    if (error) return [];
    return data || [];
  },
  async upsertRecipient(wsId, authUid, payload) {
    const row = Object.assign({ ws_id: wsId, auth_uid: authUid }, payload);
    const { error } = await this.sb.from('recipient_profiles').upsert(row, { onConflict: 'auth_uid,ws_id' });
    return error ? this._dbErr(error) : null;
  },
  async deleteRecipient(wsId, authUid) {
    const { error } = await this.sb.from('recipient_profiles').delete().eq('ws_id', wsId).eq('auth_uid', authUid);
    return error ? this._dbErr(error) : null;
  },
  async setRecipientStatus(wsId, authUid, status) {
    const { error } = await this.sb.from('recipient_profiles').update({ status }).eq('ws_id', wsId).eq('auth_uid', authUid);
    return error ? this._dbErr(error) : null;
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
      .select('*').eq('workspace_id', wsId)
      .order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
  },

  async cancelInvite(id) {
    // 软取消：置为已取消（行保留，该邮箱不能再注册入伙），需再点删除才彻底移除
    const { error } = await this.sb.from('invites').update({ status: '已取消' }).eq('id', id);
    return error ? this._dbErr(error) : null;
  },

  async deleteInvite(id) {
    const { error } = await this.sb.from('invites').delete().eq('id', id);
    return error ? this._dbErr(error) : null;
  },

  async updateInvite(id, patch) {
    const { error } = await this.sb.from('invites').update(patch).eq('id', id);
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
