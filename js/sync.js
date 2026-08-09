/* ============================================================================
   同步引擎：内存 db  ⇄  Supabase records 表

   设计要点
   1. 页面代码保持单机版写法（直接操作 S.db.xxx 数组），零改动；
   2. 深度 watch 内存 db，与 shadow 快照做 diff，得出「哪几条记录变了」，
      只推送变化的行 —— 行级并发，两个人同时开不同的单不会互相覆盖；
   3. Realtime 订阅同账套的 records 变更，实时合并进内存；
      合并时同步更新 shadow，因此不会被 diff 误判成本地改动而回推（天然防回环）；
   4. shadow 只在推送成功后更新，推送失败下次自动重试，不丢数据。
   ========================================================================== */
window.Sync = {
  /* 数组型集合（每条记录一行） */
  COLLS: [
    'goodsTypes', 'units', 'suppliers', 'goods',
    'custLevels', 'custTypes', 'regions', 'customers',
    'resourcePartners', 'regionPartners',
    'warehouses', 'purchases', 'stocks', 'stockChecks',
    'sales', 'returns', 'transfers', 'productions', 'expenseCats', 'expenses',
    'complaintTypes', 'complaints',
    'resourceRates', 'regionRates', 'commissionPayments',
    'openingStocks', 'openingAr', 'openingAp', 'openingFunds', 'capitalInjections'
  ],
  /* 单对象集合（固定一行，rid = '_'） */
  SINGLETONS: ['meta', 'settings'],

  shadow: {},
  channel: null,
  _timer: null,
  _poll: null,
  _stopWatch: null,
  lastStamp: '1970-01-01T00:00:00Z',

  state: Vue.reactive({
    status: 'idle',      // idle | loading | saving | error | offline
    error: '',
    lastSync: '',
    remoteHits: 0        // 收到他人改动的次数（用于提示）
  }),

  wsId() { return Cloud.state.ws ? Cloud.state.ws.id : null; },

  /* ---------------- 拉取 ---------------- */
  async loadAll() {
    const ws = this.wsId();
    if (!ws) throw new Error('未选择账套');
    this.state.status = 'loading';
    const db = S.emptyDB();
    let empty = true, from = 0;
    const SIZE = 1000;
    for (;;) {
      const { data, error } = await Cloud.sb.from('records')
        .select('coll,rid,data,updated_at')
        .eq('workspace_id', ws)
        .order('coll', { ascending: true })
        .order('rid', { ascending: true })
        .range(from, from + SIZE - 1);
      if (error) { this.state.status = 'error'; throw error; }
      const rows = data || [];
      rows.forEach(r => {
        empty = false;
        this._put(db, r.coll, r.data);
        if (r.updated_at && r.updated_at > this.lastStamp) this.lastStamp = r.updated_at;
      });
      if (rows.length < SIZE) break;
      from += SIZE;
    }
    this.state.status = 'idle';
    return { db, empty };
  },

  _put(db, coll, data) {
    if (this.SINGLETONS.includes(coll)) { if (data) db[coll] = data; return; }
    if (!Array.isArray(db[coll])) db[coll] = [];
    db[coll].push(data);
  },

  /* ---------------- 快照 / 差异 ---------------- */
  snapshot(db) {
    const sh = {};
    this.COLLS.forEach(c => {
      const m = {};
      (db[c] || []).forEach(r => { if (r && r.id != null) m[String(r.id)] = JSON.stringify(r); });
      sh[c] = m;
    });
    this.SINGLETONS.forEach(k => { sh[k] = JSON.stringify(db[k] || null); });
    return sh;
  },

  resetShadow(db) { this.shadow = this.snapshot(db); },

  diff(db) {
    const ups = [], dels = [];
    this.COLLS.forEach(c => {
      const prev = this.shadow[c] || {};
      const seen = {};
      (db[c] || []).forEach(r => {
        if (!r || r.id == null) return;
        const rid = String(r.id);
        const json = JSON.stringify(r);
        seen[rid] = true;
        if (prev[rid] !== json) ups.push({ coll: c, rid, json, data: JSON.parse(json) });
      });
      Object.keys(prev).forEach(rid => { if (!seen[rid]) dels.push({ coll: c, rid }); });
    });
    this.SINGLETONS.forEach(k => {
      const json = JSON.stringify(db[k] || null);
      if (this.shadow[k] !== json) ups.push({ coll: k, rid: '_', json, data: JSON.parse(json) });
    });
    return { ups, dels };
  },

  /* ---------------- 推送 ---------------- */
  schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.push(), 500);
  },

  async push() {
    const ws = this.wsId();
    if (!ws || !S.db || this.state.status === 'saving') return;
    const { ups, dels } = this.diff(S.db);
    if (!ups.length && !dels.length) return;

    this.state.status = 'saving';
    this.state.error = '';
    try {
      if (ups.length) {
        const rows = ups.map(u => ({ workspace_id: ws, coll: u.coll, rid: u.rid, data: u.data }));
        for (const chunk of this._chunks(rows, 200)) {
          const { error } = await Cloud.sb.from('records')
            .upsert(chunk, { onConflict: 'workspace_id,coll,rid' });
          if (error) throw error;
        }
      }
      /* 删除按集合合并，减少往返 */
      const byColl = {};
      dels.forEach(d => { (byColl[d.coll] = byColl[d.coll] || []).push(d.rid); });
      for (const coll of Object.keys(byColl)) {
        for (const chunk of this._chunks(byColl[coll], 100)) {
          const { error } = await Cloud.sb.from('records').delete()
            .eq('workspace_id', ws).eq('coll', coll).in('rid', chunk);
          if (error) throw error;
        }
      }

      /* 仅把本次成功推送的条目写入 shadow，避免吞掉推送期间产生的新改动 */
      ups.forEach(u => {
        if (this.SINGLETONS.includes(u.coll)) this.shadow[u.coll] = u.json;
        else { (this.shadow[u.coll] = this.shadow[u.coll] || {})[u.rid] = u.json; }
      });
      dels.forEach(d => { if (this.shadow[d.coll]) delete this.shadow[d.coll][d.rid]; });

      this.state.status = 'idle';
      this.state.lastSync = U.now();
    } catch (e) {
      const msg = String(e.message || e);
      if (/row-level security|violates row-level|permission denied/i.test(msg)) {
        /* 越权写入：本地改动无效，拉回云端权威数据 */
        this.state.status = 'error';
        this.state.error = '权限不足，改动未保存';
        alert('权限不足：当前账号无权修改该模块的数据，界面将恢复为云端最新数据。');
        await this.reload();
      } else {
        this.state.status = 'error';
        this.state.error = msg;
        /* 网络类错误自动重试 */
        setTimeout(() => { if (this.state.status === 'error') this.push(); }, 5000);
      }
    }
  },

  _chunks(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  },

  /* 强制把当前内存 db 全量写入云端（新建账套 / 导入备份时使用） */
  async pushAll() {
    this.shadow = {};
    this.COLLS.forEach(c => { this.shadow[c] = {}; });
    this.SINGLETONS.forEach(k => { this.shadow[k] = '__none__'; });
    await this.push();
  },

  /* 清空账套内全部业务数据（导入备份前调用） */
  async wipeRemote() {
    const ws = this.wsId();
    if (!ws) return;
    const { error } = await Cloud.sb.from('records').delete().eq('workspace_id', ws);
    if (error) throw error;
  },

  async reload() {
    const { db } = await this.loadAll();
    S.applyRemoteDB(db);
    this.resetShadow(S.db);
    this.state.status = 'idle';
    this.state.error = '';
  },

  /* ---------------- 实时订阅 ---------------- */
  /* Realtime 属于增强能力：订阅失败（WebSocket 被拦截、未开启 Realtime 等）
     不能影响进入系统，此时由 30s 增量轮询兜底 */
  subscribe() {
    const ws = this.wsId();
    if (!ws || !Cloud.sb) return;
    try {
      this.unsubscribe();
      this.channel = Cloud.sb.channel('jxc-records-' + ws)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'records', filter: 'workspace_id=eq.' + ws },
          payload => {
            try { this.onRemote(payload); }
            catch (e) { console.error('[Sync] 合并远端改动失败', e); }
          })
        .subscribe();
    } catch (e) {
      console.error('[Sync] 实时订阅失败，已降级为轮询同步', e);
      this.channel = null;
    }
  },

  unsubscribe() {
    if (this.channel) { try { Cloud.sb.removeChannel(this.channel); } catch (e) { /* ignore */ } }
    this.channel = null;
  },

  onRemote(payload) {
    const ev = payload.eventType || payload.event;
    const row = ev === 'DELETE' ? payload.old : payload.new;
    if (!row || !row.coll) return;
    const { coll, rid } = row;
    if (row.updated_at && row.updated_at > this.lastStamp) this.lastStamp = row.updated_at;

    if (ev === 'DELETE') {
      const has = this.shadow[coll] && this.shadow[coll][rid] !== undefined;
      if (!has) return;                       // 本地本来就没有 → 是自己删的
      const arr = S.db[coll];
      if (Array.isArray(arr)) {
        const i = arr.findIndex(x => String(x.id) === String(rid));
        if (i >= 0) arr.splice(i, 1);
      }
      delete this.shadow[coll][rid];
      this.state.remoteHits++;
      return;
    }

    const json = JSON.stringify(row.data);
    if (this.SINGLETONS.includes(coll)) {
      if (this.shadow[coll] === json) return;  // 与本地一致 → 自己推的
      S.db[coll] = row.data;
      this.shadow[coll] = json;
    } else {
      const prev = (this.shadow[coll] || {})[rid];
      if (prev === json) return;
      const arr = S.db[coll] || (S.db[coll] = []);
      const i = arr.findIndex(x => String(x.id) === String(rid));
      if (i >= 0) arr.splice(i, 1, row.data); else arr.push(row.data);
      (this.shadow[coll] = this.shadow[coll] || {})[rid] = json;
      S.noteId(row.data.id);
    }
    this.state.remoteHits++;
  },

  /* ---------------- 增量轮询兜底（Realtime 不可用时仍能同步） ---------------- */
  startPolling() {
    clearInterval(this._poll);
    this._poll = setInterval(() => this.pollDelta(), 30000);
  },

  async pollDelta() {
    const ws = this.wsId();
    if (!ws || this.state.status === 'saving' || document.hidden) return;
    try {
      const { data, error } = await Cloud.sb.from('records')
        .select('coll,rid,data,updated_at')
        .eq('workspace_id', ws).gt('updated_at', this.lastStamp)
        .order('updated_at', { ascending: true }).limit(500);
      if (error || !data || !data.length) return;
      data.forEach(r => this.onRemote({ eventType: 'UPDATE', new: r }));
    } catch (e) { /* 静默，下一轮再试 */ }
  },

  /* ---------------- 启动 / 停止 ---------------- */
  /* shadow 由 S.init() 负责初始化（新账套走 pushAll，老账套走 resetShadow），
     此处不再重置，否则首次全量推送失败时会被误判为「已同步」而丢数据 */
  start() {
    this._stopWatch = Vue.watch(() => S.state.db, () => this.schedule(), { deep: true });
    this.subscribe();
    this.startPolling();
    window.addEventListener('beforeunload', this._flush = () => {
      const { ups, dels } = this.diff(S.db);
      if (ups.length || dels.length) this.push();
    });
  },

  stop() {
    clearTimeout(this._timer);
    clearInterval(this._poll);
    if (this._stopWatch) { this._stopWatch(); this._stopWatch = null; }
    if (this._flush) { window.removeEventListener('beforeunload', this._flush); this._flush = null; }
    this.unsubscribe();
    this.shadow = {};
    this.lastStamp = '1970-01-01T00:00:00Z';
    this.state.status = 'idle';
    this.state.error = '';
  },

  statusText() {
    const s = this.state;
    if (s.status === 'saving') return '正在保存…';
    if (s.status === 'loading') return '正在加载…';
    if (s.status === 'error') return '同步异常：' + (s.error || '未知错误');
    return s.lastSync ? ('已同步 ' + s.lastSync.slice(11)) : '已连接';
  }
};
