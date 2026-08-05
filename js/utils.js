/* 通用工具函数 */
window.U = {
  pad(n, w) { return String(n).padStart(w || 2, '0'); },

  now() {
    const d = new Date();
    return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())} ${U.pad(d.getHours())}:${U.pad(d.getMinutes())}:${U.pad(d.getSeconds())}`;
  },

  today() {
    const d = new Date();
    return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
  },

  ymd(dateStr) {
    if (dateStr instanceof Date) {
      const p = n => (n < 10 ? '0' : '') + n;
      return `${dateStr.getFullYear()}-${p(dateStr.getMonth() + 1)}-${p(dateStr.getDate())}`;
    }
    return (dateStr || '').slice(0, 10);
  },

  /* 偏移天数，返回 YYYY-MM-DD */
  addDays(dateStr, days) {
    const d = dateStr ? new Date(dateStr.slice(0, 10) + 'T00:00:00') : new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
  },

  daysBetween(a, b) { /* b - a 天数 */
    const da = new Date(U.ymd(a) + 'T00:00:00'), db = new Date(U.ymd(b) + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  },

  /* 某年某月的天数 */
  daysInMonth(y, m) { return new Date(y, m, 0).getDate(); },

  inRange(dateStr, d1, d2) {
    const d = U.ymd(dateStr);
    if (!d) return false;
    if (d1 && d < d1) return false;
    if (d2 && d > d2) return false;
    return true;
  },

  fmtMoney(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  fmtNum(n) { return (Number(n) || 0).toLocaleString('zh-CN'); },

  round2(n) { return Math.round((Number(n) || 0) * 100) / 100; },

  kw(text, kw) { /* 模糊匹配 */
    if (!kw) return true;
    return String(text || '').toLowerCase().includes(String(kw).trim().toLowerCase());
  },

  /* 浏览器下载（替代单机版的 Electron 文件保存对话框） */
  download(filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  },

  async exportExcel(filename, rows, sheetName) {
    if (!rows || !rows.length) { alert('没有可导出的数据'); return; }
    await U.ensureXLSX();
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    U.download(filename, new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
  },

  /* 按需加载第三方库：首屏不再同步下载 echarts / xlsx 等大体积脚本，
     仅在对应功能（图表 / 导出 Excel）首次用到时才动态注入并缓存。 */
  _scripts: {},
  loadScript(src) {
    if (this._scripts[src]) return this._scripts[src];
    this._scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('脚本加载失败: ' + src));
      document.head.appendChild(s);
    });
    return this._scripts[src];
  },
  ensureXLSX() { return window.XLSX ? Promise.resolve() : this.loadScript('vendor/xlsx.full.min.js'); },
  ensureECharts() { return window.echarts ? Promise.resolve() : this.loadScript('vendor/echarts.min.js'); },

  printHTML(html) {
    const area = document.getElementById('print-area');
    area.innerHTML = html;
    setTimeout(() => { window.print(); }, 60);
  },

  confirm(msg) { return window.confirm(msg); }
};

/* 统一收支方式（收款方式 = 付款方式共用）；已按需求去掉“银行转账” */
window.PAY_METHODS = ['现金', '微信', '支付宝', '收款码', '对公', '银行卡', '其他'];
