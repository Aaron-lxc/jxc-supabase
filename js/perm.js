/* 权限层：按菜单模块逐项授权（none / view / edit） */
window.P = {
  /* 全部可授权模块（顺序与侧边栏一致） */
  MODULES: [
    { key: 'dashboard',  label: '仪表盘',    ico: '📊', readonly: true },
    { key: 'goods',      label: '商品管理',  ico: '📦' },
    { key: 'customers',  label: '客户管理',  ico: '👥' },
    { key: 'partners',   label: '合伙人管理', ico: '🤝' },
    { key: 'warehouse',  label: '仓库管理',  ico: '🏬' },
    { key: 'purchase',   label: '采购管理',  ico: '🛒' },
    { key: 'inventory',  label: '库存管理',  ico: '📋' },
    { key: 'loss',       label: '报损管理',  ico: '📉', hidden: true },
    { key: 'overflow',   label: '报溢管理',  ico: '📈', hidden: true },
    { key: 'sales',      label: '销售管理',  ico: '💰' },
    { key: 'opening',    label: '期初管理',  ico: '🗓️' },
    { key: 'capital',    label: '注资管理',  ico: '🏦' },
    { key: 'finance',    label: '财务管理',  ico: '💳' },
    { key: 'complaint',  label: '投诉管理',  ico: '📣' },
    { key: 'report',     label: '运营报表',  ico: '📈', readonly: true },
    { key: 'commission', label: '佣金管理',  ico: '🎯' },
    { key: 'settings',   label: '系统设置',  ico: '⚙️' },
    { key: 'reportcenter', label: '佣金报表', ico: '📊', readonly: true }
  ],

  /* 账户管理：仅 owner / admin 可见，不参与逐项授权 */
  MEMBER_MENU: { key: 'members', label: '账户管理', ico: '🔑' },
  RECIPIENT_MENU: { key: 'recipientmgr', label: '报表接收人', ico: '📨' },

  LEVELS: [
    { v: 'none', label: '无权限' },
    { v: 'view', label: '仅查看' },
    { v: 'edit', label: '可编辑' }
  ],

  /* 新成员默认权限：日常业务可编辑，钱与设置默认不开放 */
  defaultPermissions() {
    return {
      dashboard: 'view',       goods: 'edit', customers: 'edit', partners: 'view',
      warehouse: 'view', purchase: 'edit', inventory: 'edit', sales: 'edit', loss: 'edit', overflow: 'edit',
      opening: 'none', capital: 'none',
      finance: 'none', complaint: 'edit', report: 'view',
      commission: 'none', settings: 'none'
    };
  },

  role() { return (Cloud.state.ws && Cloud.state.ws.role) || 'member'; },
  isRecipient() { return !!(Cloud.state && Cloud.state.recipient); },
  isOwner() { return this.role() === 'owner'; },
  isManager() { return ['owner', 'admin'].includes(this.role()); },

  roleLabel(r) {
    return { owner: '创建者', admin: '管理员', member: '成员' }[r || 'member'] || r;
  },

  /* 某模块的权限级别 */
  level(mod) {
    if (this.isManager()) return 'edit';
    const perms = (Cloud.state.ws && Cloud.state.ws.permissions) || {};
    const v = perms[mod];
    if (v === 'edit' || v === 'view' || v === 'none') return v;
    return 'none';
  },

  canView(mod) {
    if (mod === 'reportcenter') return this.isRecipient() || this.isManager();
    const m = this.MODULES.find(x => x.key === mod);
    if (m && m.readonly) return this.level(mod) !== 'none';
    return this.level(mod) !== 'none';
  },

  canEdit(mod) {
    const m = this.MODULES.find(x => x.key === mod);
    if (m && m.readonly) return false;   // 仪表盘 / 报表 本身无写操作
    return this.level(mod) === 'edit';
  },

  /* 侧边栏菜单（按权限过滤） */
  menus() {
    // 纯接收人（非管理者）独占报表中心；管理者保留全部菜单并额外带报表中心入口
    if (this.isRecipient() && !this.isManager()) return [{ key: 'reportcenter', label: '佣金报表', ico: '📊' }];
    const list = this.MODULES.filter(m => !m.hidden && this.canView(m.key))
      .map(m => ({ key: m.key, label: m.label, ico: m.ico }));
    if (this.isManager()) {
      list.push({ ...this.MEMBER_MENU });
      list.push({ ...this.RECIPIENT_MENU });
      // 报表中心入口已由 MODULES 内的 reportcenter 提供，此处不再重复 push（避免重复）
    }
    return list;
  },

  /* 无权访问时的首个可用页面 */
  firstMenu() {
    if (this.isRecipient() && !this.isManager()) return 'reportcenter';
    const list = this.menus();
    return list.length ? list[0].key : 'members';
  },

  /* 页面内统一提示 */
  denyTip(mod) {
    const m = this.MODULES.find(x => x.key === mod);
    return `当前账号对「${m ? m.label : mod}」只有查看权限，如需修改请联系账套管理员`;
  },

  /* 把权限对象补全为完整键值（供成员管理页编辑） */
  normalize(perms) {
    const out = {};
    this.MODULES.forEach(m => {
      const v = (perms || {})[m.key];
      out[m.key] = (v === 'edit' || v === 'view') ? v : 'none';
      if (m.readonly && out[m.key] === 'edit') out[m.key] = 'view';
    });
    return out;
  },

  /* 权限摘要文字，用于成员列表展示 */
  summary(perms, role) {
    if (role === 'owner' || role === 'admin') return '全部模块 · 可编辑';
    const p = this.normalize(perms);
    const e = this.MODULES.filter(m => p[m.key] === 'edit').length;
    const v = this.MODULES.filter(m => p[m.key] === 'view').length;
    if (!e && !v) return '未授权任何模块';
    return `可编辑 ${e} 项 · 仅查看 ${v} 项`;
  }
};
