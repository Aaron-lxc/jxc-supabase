/* Supabase 连接配置：首次运行由使用者在界面上填写，保存在浏览器本地 */
window.CFG = {
  KEY: 'jxc.supabase.config',

  /* 已为 GitHub Pages 部署预置：成员打开即跳过「连接配置」页，无需填 key */
  preset: {
    url: 'https://rfyuxjaewsgjsespogyw.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmeXV4amFld3NnanNlc3BvZ3l3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NjczNTcsImV4cCI6MjEwMTE0MzM1N30.b3fCOI0w2peZw0oPeRSzDMRY_H52HKlEmcemlovKSvI'
  },

  read() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.url && c.anonKey) return c;
      }
    } catch (e) { /* ignore */ }
    if (this.preset.url && this.preset.anonKey) return { ...this.preset };
    return null;
  },

  save(url, anonKey) {
    const c = { url: String(url || '').trim().replace(/\/+$/, ''), anonKey: String(anonKey || '').trim() };
    localStorage.setItem(this.KEY, JSON.stringify(c));
    return c;
  },

  clear() { localStorage.removeItem(this.KEY); },

  ok() { return !!this.read(); },

  /* 基本格式校验，尽早给出人话提示 */
  validate(url, anonKey) {
    const u = String(url || '').trim();
    const k = String(anonKey || '').trim();
    if (!u) return '请填写 Project URL';
    if (!/^https?:\/\//i.test(u)) return 'Project URL 需以 https:// 开头';
    if (!k) return '请填写 anon public key';
    if (k.split('.').length !== 3) return 'anon key 格式不正确（应为三段式 JWT，形如 xxx.yyy.zzz）';
    return null;
  },

  /* 记住上次使用的账套 */
  lastWs() { return localStorage.getItem('jxc.lastWorkspace') || ''; },
  setLastWs(id) { if (id) localStorage.setItem('jxc.lastWorkspace', id); },
  clearLastWs() { localStorage.removeItem('jxc.lastWorkspace'); }
};
