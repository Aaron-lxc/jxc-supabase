/* 活动管理：商家推荐明细 / 个人推荐明细 / 个人推广明细
   三个子模块在同一页面内通过 Tab 切换，注册为 page-activity。
   - 合作时间：系统自动匹配「被推荐客户」已完成销售单中含洗洁精≥5袋的最早时间（store.coopTime）。
   - 商家推荐「计提预存货款」复用 dealerRewards（绑定客户名称对应客户），销售结算可抵扣。
   - 商家/个人推荐「现金发放/发放」计入运营成本（expenses, status='已计算'）。
   - 个人推广「发放」按所选仓库+批次精确扣库存（store.issuePromoReward）。 */
window.Pages = window.Pages || {};

/* ---------------- 下拉选项辅助（运行时取 S） ---------------- */
function actCustAll() {
  return [{ value: '', label: '全部客户' }].concat((window.S.enabled('customers') || []).map(c => ({ value: c.id, label: c.name })));
}
function actCustPick() {
  return [{ value: '', label: '请选择' }].concat((window.S.enabled('customers') || []).map(c => ({ value: c.id, label: c.name })));
}
function actGoodsAll() {
  return [{ value: '', label: '全部商品' }].concat((window.S.enabled('goods') || []).map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name })));
}
function actGoodsPick() {
  return [{ value: '', label: '请选择' }].concat((window.S.enabled('goods') || []).map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name })));
}
function actWhAll() {
  return [{ value: '', label: '全部仓库' }].concat((window.S.enabled('warehouses') || []).map(w => ({ value: w.id, label: w.name })));
}
function actWhPick() {
  return [{ value: '', label: '请选择' }].concat((window.S.enabled('warehouses') || []).map(w => ({ value: w.id, label: w.name })));
}

/* ==================== 商家推荐明细 ==================== */
const MerchantRef = {
  data() {
    return {
      page: 1, size: 10,
      q: { customerId: '', refCustomerId: '', status: '', d1: '', d2: '' },
      form: { id: '', customerId: '', refCustomerId: '', reward: 150, coopTime: '', status: '未生效', remark: '' },
      showForm: false, editingId: '',
      showIssue: false, issueForm: { amount: 0 }
    };
  },
  computed: {
    S() { return window.S; },
    canEdit() { return window.P.canEdit('activity'); },
    custAll() { return actCustAll(); },
    custPick() { return actCustPick(); },
    statusOpts() { return [{ value: '', label: '全部状态' }, { value: '未生效', label: '未生效' }, { value: '已预存', label: '已预存' }, { value: '已发放', label: '已发放' }, { value: '已作废', label: '已作废' }]; },
    coopHint() { return this.form.refCustomerId ? window.S.coopTime(this.form.refCustomerId) : ''; },
    rows() {
      const S = window.S, q = this.q;
      return (S.db.merchantRefs || []).filter(r =>
        (!q.customerId || r.customerId === q.customerId) &&
        (!q.refCustomerId || r.refCustomerId === q.refCustomerId) &&
        (!q.status || r.status === q.status) &&
        U.inRange(r.createTime, q.d1, q.d2) &&
        U.inRange(r.coopTime, q.d1b, q.d2b)
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.size, this.page * this.size); },
    total() { return this.rows.length; },
    mTotals() {
      return {
        reward: U.round2(this.rows.reduce((a, r) => a + (Number(r.reward) || 0), 0)),
        actual: U.round2(this.rows.reduce((a, r) => a + (Number(r.actualReward) || 0), 0))
      };
    }
  },
  methods: {
    custName(id) { const c = window.S.byId('customers', id); return c ? c.name : ''; },
    resetForm() { this.form = { id: '', customerId: '', refCustomerId: '', reward: 150, coopTime: '', status: '未生效', remark: '' }; this.editingId = ''; },
    openNew() { this.resetForm(); this.showForm = true; },
    openEdit(r) { this.form = Object.assign({}, r); this.editingId = r.id; this.showForm = true; },
    save() {
      const f = this.form;
      if (!f.customerId) return alert('请选择客户名称');
      if (!f.refCustomerId) return alert('请选择被推荐客户名称');
      const ct = window.S.coopTime(f.refCustomerId);
      if (!ct) return alert('未匹配到该被推荐客户首次采购洗洁精≥5袋的合作时间，不可保存');
      f.coopTime = ct;
      f.reward = Number(f.reward) || 0;
      if (this.editingId) {
        const ex = window.S.byId('merchantRefs', this.editingId);
        if (ex) Object.assign(ex, f);
      } else {
        window.S.db.merchantRefs.push({ id: window.S.genId(), createTime: U.now(), status: '未生效', prepaidRewardId: '', actualReward: 0, remark: f.remark, customerId: f.customerId, refCustomerId: f.refCustomerId, reward: f.reward, coopTime: ct });
      }
      this.showForm = false;
    },
    accruePrepaid(r) {
      if (r.status !== '未生效') return alert('仅「未生效」记录可计提预存货款');
      const rec = window.S.accrueActivityPrepaid(r.customerId, r.reward);
      r.prepaidRewardId = rec.id;
      r.actualReward = r.reward;
      r.status = '已预存';
      alert('已计提预存货款 ￥' + U.fmtMoney(r.reward) + '，可在销售结算时抵扣');
    },
    openIssue(r) { this.issueForm = { id: r.id, amount: Number(r.reward) || 0 }; this.showIssue = true; },
    doIssue() {
      const r = window.S.byId('merchantRefs', this.issueForm.id);
      if (!r) return;
      const amt = Number(this.issueForm.amount) || 0;
      if (amt <= 0) return alert('请填写发放金额');
      window.S.db.expenses.push({ id: window.S.genId(), catId: null, amount: amt, desc: '活动奖励-商家推荐现金发放', payMethod: '', createTime: U.now(), status: '已计算' });
      r.actualReward = amt;
      r.status = '已发放';
      this.showIssue = false;
      alert('已现金发放并计入运营成本 ￥' + U.fmtMoney(amt));
    },
    voidRec(r) {
      if (r.status === '已作废') return;
      if (r.prepaidRewardId) {
        const m = window.S.deleteDealerReward(r.prepaidRewardId);
        if (m) return alert(m);
        r.prepaidRewardId = '';
      }
      r.actualReward = 0;
      r.status = '已作废';
    },
    delRec(r) {
      if (r.status !== '已作废') return alert('请先作废再删除');
      window.S.db.merchantRefs = window.S.db.merchantRefs.filter(x => x.id !== r.id);
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <button class="btn btn-primary" v-if="canEdit" @click="openNew">新增</button>
      <x-combobox v-model="q.customerId" :options="custAll" placeholder="客户名称" style="width:160px"/>
      <x-combobox v-model="q.refCustomerId" :options="custAll" placeholder="被推荐客户名称" style="width:160px"/>
      <x-combobox v-model="q.status" :options="statusOpts" placeholder="状态" style="width:120px"/>
      <label>创建时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <label>合作时间</label><input type="date" v-model="q.d1b"> - <input type="date" v-model="q.d2b">
    </div>
    <table class="grid">
      <thead><tr>
        <th>序号</th><th>客户名称</th><th>被推荐客户名称</th><th>本次奖励</th><th>实际奖励</th><th>创建时间</th>
        <th>合作时间</th><th>状态</th><th>备注</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="(r,i) in paged" :key="r.id">
          <td>{{ (page-1)*size + i + 1 }}</td>
          <td>{{ custName(r.customerId) }}</td>
          <td>{{ custName(r.refCustomerId) }}</td>
          <td>￥{{ U.fmtMoney(r.reward) }}</td>
          <td>￥{{ U.fmtMoney(r.actualReward || 0) }}</td>
          <td>{{ r.createTime }}</td>
          <td>{{ r.coopTime }}</td>
          <td>{{ r.status }}</td>
          <td>{{ r.remark }}</td>
          <td class="ops">
            <a v-if="canEdit" @click="openEdit(r)">修改</a>
            <a v-if="canEdit && r.status==='未生效'" @click="accruePrepaid(r)">计提预存货款</a>
            <a v-if="canEdit && r.status!=='已发放' && r.status!=='已作废'" @click="openIssue(r)">现金发放</a>
            <a v-if="canEdit && r.status!=='已作废' && r.status!=='已发放'" @click="voidRec(r)">作废</a>
            <a v-if="canEdit && r.status==='已作废'" @click="delRec(r)">删除</a>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="10" class="empty">暂无数据</td></tr>
        <tr v-if="paged.length" style="background:#eff6ff;font-weight:700">
          <td colspan="3">合计</td>
          <td>￥{{ U.fmtMoney(mTotals.reward) }}</td>
          <td>￥{{ U.fmtMoney(mTotals.actual) }}</td>
          <td colspan="5"></td>
        </tr>
      </tbody>
    </table>
    <x-pager :total="total" v-model:page="page" v-model:size="size"/>

    <x-modal v-if="showForm" :title="editingId?'修改商家推荐':'新增商家推荐'" :width="560" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>客户名称<b class="req">*</b></label><x-combobox v-model="form.customerId" :options="custPick" placeholder="请选择"/></div>
        <div class="form-item"><label>被推荐客户名称<b class="req">*</b></label><x-combobox v-model="form.refCustomerId" :options="custPick" placeholder="请选择"/></div>
        <div class="form-item"><label>本次奖励（元）</label><input type="number" min="0" step="0.01" v-model.number="form.reward"></div>
        <div class="form-item"><label>合作时间</label>
          <div v-if="coopHint" class="coop-ok">已匹配：{{ coopHint }}</div>
          <div v-else class="coop-no">未匹配（被推荐客户需有首次采购洗洁精≥5袋的已完成销售单）</div>
        </div>
        <div class="form-item full"><label>备注</label><textarea rows="2" v-model="form.remark"></textarea></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>

    <x-modal v-if="showIssue" title="现金发放（计入运营成本）" :width="460" :fullscreen="$root.isMobile" position="bottom" @close="showIssue=false">
      <div class="form-grid">
        <div class="form-item"><label>发放金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="issueForm.amount"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showIssue=false">取消</button>
        <button class="btn btn-primary" @click="doIssue">确认发放</button>
      </template>
    </x-modal>
  </div>`
};

/* ==================== 个人推荐明细 ==================== */
const PersonRef = {
  data() {
    return {
      page: 1, size: 10,
      q: { recommender: '', refCustomerId: '', status: '', d1: '', d2: '' },
      form: { id: '', recommender: '', phone: '', refCustomerId: '', reward: 50, coopTime: '', status: '未发放', remark: '' },
      showForm: false, editingId: '',
      showIssue: false, issueForm: { id: '', amount: 0 }
    };
  },
  computed: {
    S() { return window.S; },
    canEdit() { return window.P.canEdit('activity'); },
    custAll() { return actCustAll(); },
    custPick() { return actCustPick(); },
    recommenderOpts() {
      const set = {};
      (window.S.db.personRefs || []).forEach(r => { if (r.recommender) set[r.recommender] = 1; });
      return Object.keys(set).map(v => ({ value: v, label: v }));
    },
    recommenderAll() { return [{ value: '', label: '全部推荐人' }].concat(this.recommenderOpts); },
    phoneOpts() {
      const set = {};
      (window.S.db.personRefs || []).forEach(r => { if (r.phone) set[r.phone] = 1; });
      return Object.keys(set).map(v => ({ value: v, label: v }));
    },
    statusOpts() { return [{ value: '', label: '全部状态' }, { value: '未发放', label: '未发放' }, { value: '已发放', label: '已发放' }]; },
    coopHint() { return this.form.refCustomerId ? window.S.coopTime(this.form.refCustomerId) : ''; },
    rows() {
      const S = window.S, q = this.q;
      return (S.db.personRefs || []).filter(r =>
        (!q.recommender || U.kw(r.recommender, q.recommender)) &&
        (!q.refCustomerId || r.refCustomerId === q.refCustomerId) &&
        (!q.status || r.status === q.status) &&
        U.inRange(r.createTime, q.d1, q.d2) &&
        U.inRange(r.coopTime, q.d1b, q.d2b)
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.size, this.page * this.size); },
    total() { return this.rows.length; },
    prTotals() {
      return {
        reward: U.round2(this.rows.reduce((a, r) => a + (Number(r.reward) || 0), 0))
      };
    }
  },
  methods: {
    custName(id) { const c = window.S.byId('customers', id); return c ? c.name : ''; },
    resetForm() { this.form = { id: '', recommender: '', phone: '', refCustomerId: '', reward: 50, coopTime: '', status: '未发放', remark: '' }; this.editingId = ''; },
    openNew() { this.resetForm(); this.showForm = true; },
    openEdit(r) { this.form = Object.assign({}, r); this.editingId = r.id; this.showForm = true; },
    save() {
      const f = this.form;
      if (!f.recommender || !f.recommender.trim()) return alert('请填写推荐人');
      if (!f.refCustomerId) return alert('请选择被推荐客户名称');
      const ct = window.S.coopTime(f.refCustomerId);
      if (!ct) return alert('未匹配到该被推荐客户首次采购洗洁精≥5袋的合作时间，不可保存');
      f.coopTime = ct;
      f.reward = Number(f.reward) || 0;
      if (this.editingId) {
        const ex = window.S.byId('personRefs', this.editingId);
        if (ex) Object.assign(ex, f);
      } else {
        window.S.db.personRefs.push({ id: window.S.genId(), createTime: U.now(), status: '未发放', paidAmount: 0, recommender: f.recommender.trim(), phone: f.phone, refCustomerId: f.refCustomerId, reward: f.reward, coopTime: ct, remark: f.remark });
      }
      this.showForm = false;
    },
    openIssue(r) { this.issueForm = { id: r.id, amount: Number(r.reward) || 0 }; this.showIssue = true; },
    doIssue() {
      const r = window.S.byId('personRefs', this.issueForm.id);
      if (!r) return;
      const amt = Number(this.issueForm.amount) || 0;
      if (amt <= 0) return alert('请填写发放金额');
      window.S.db.expenses.push({ id: window.S.genId(), catId: null, amount: amt, desc: '活动奖励-个人推荐发放', payMethod: '', createTime: U.now(), status: '已计算' });
      r.paidAmount = amt;
      r.status = '已发放';
      this.showIssue = false;
      alert('已发放并计入运营成本 ￥' + U.fmtMoney(amt));
    },
    delRec(r) {
      if (r.status !== '未发放') return alert('仅「未发放」记录可删除');
      window.S.db.personRefs = window.S.db.personRefs.filter(x => x.id !== r.id);
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <button class="btn btn-primary" v-if="canEdit" @click="openNew">新增</button>
      <x-combobox v-model="q.recommender" :options="recommenderAll" editable placeholder="推荐人" style="width:150px"/>
      <x-combobox v-model="q.refCustomerId" :options="custAll" placeholder="被推荐客户名称" style="width:160px"/>
      <x-combobox v-model="q.status" :options="statusOpts" placeholder="状态" style="width:120px"/>
      <label>创建时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <label>合作时间</label><input type="date" v-model="q.d1b"> - <input type="date" v-model="q.d2b">
    </div>
    <table class="grid">
      <thead><tr>
        <th>序号</th><th>推荐人</th><th>联系电话/微信</th><th>被推荐客户名称</th><th>本次奖励</th>
        <th>创建时间</th><th>合作时间</th><th>状态</th><th>备注</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="(r,i) in paged" :key="r.id">
          <td>{{ (page-1)*size + i + 1 }}</td>
          <td>{{ r.recommender }}</td>
          <td>{{ r.phone }}</td>
          <td>{{ custName(r.refCustomerId) }}</td>
          <td>￥{{ U.fmtMoney(r.reward) }}</td>
          <td>{{ r.createTime }}</td>
          <td>{{ r.coopTime }}</td>
          <td>{{ r.status }}</td>
          <td>{{ r.remark }}</td>
          <td class="ops">
            <a v-if="canEdit" @click="openEdit(r)">修改</a>
            <a v-if="canEdit && r.status==='未发放'" @click="openIssue(r)">发放</a>
            <a v-if="canEdit && r.status==='未发放'" @click="delRec(r)">删除</a>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="10" class="empty">暂无数据</td></tr>
        <tr v-if="paged.length" style="background:#eff6ff;font-weight:700">
          <td colspan="4">合计</td>
          <td>￥{{ U.fmtMoney(prTotals.reward) }}</td>
          <td colspan="5"></td>
        </tr>
      </tbody>
    </table>
    <x-pager :total="total" v-model:page="page" v-model:size="size"/>

    <x-modal v-if="showForm" :title="editingId?'修改个人推荐':'新增个人推荐'" :width="560" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>推荐人<b class="req">*</b></label>
          <x-combobox v-model="form.recommender" :options="recommenderOpts" editable placeholder="可手填新推荐人"/>
        </div>
        <div class="form-item"><label>联系电话/微信</label><x-combobox v-model="form.phone" :options="phoneOpts" editable placeholder="可手填"/></div>
        <div class="form-item"><label>被推荐客户名称<b class="req">*</b></label><x-combobox v-model="form.refCustomerId" :options="custPick" placeholder="请选择"/></div>
        <div class="form-item"><label>本次奖励（元）</label><input type="number" min="0" step="0.01" v-model.number="form.reward"></div>
        <div class="form-item"><label>合作时间</label>
          <div v-if="coopHint" class="coop-ok">已匹配：{{ coopHint }}</div>
          <div v-else class="coop-no">未匹配（被推荐客户需有首次采购洗洁精≥5袋的已完成销售单）</div>
        </div>
        <div class="form-item full"><label>备注</label><textarea rows="2" v-model="form.remark"></textarea></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>

    <x-modal v-if="showIssue" title="发放（计入运营成本）" :width="460" :fullscreen="$root.isMobile" position="bottom" @close="showIssue=false">
      <div class="form-grid">
        <div class="form-item"><label>发放金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="issueForm.amount"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showIssue=false">取消</button>
        <button class="btn btn-primary" @click="doIssue">确认发放</button>
      </template>
    </x-modal>
  </div>`
};

/* ==================== 个人推广明细 ==================== */
const PersonPromo = {
  data() {
    return {
      page: 1, size: 10,
      q: { promoter: '', refCustomerId: '', status: '', d1: '', d2: '' },
      form: { id: '', promoter: '', phone: '', refCustomerId: '', goodsId: '', whId: '', batchNo: '', qty: 1, status: '未发放', remark: '' },
      showForm: false, editingId: ''
    };
  },
  computed: {
    S() { return window.S; },
    canEdit() { return window.P.canEdit('activity'); },
    custAll() { return actCustAll(); },
    custPick() { return actCustPick(); },
    whPick() { return actWhPick(); },
    promoterOpts() {
      const set = {};
      (window.S.db.personPromos || []).forEach(r => { if (r.promoter) set[r.promoter] = 1; });
      return Object.keys(set).map(v => ({ value: v, label: v }));
    },
    promoterAll() { return [{ value: '', label: '全部推广人' }].concat(this.promoterOpts); },
    phoneOpts() {
      const set = {};
      (window.S.db.personPromos || []).forEach(r => { if (r.phone) set[r.phone] = 1; });
      return Object.keys(set).map(v => ({ value: v, label: v }));
    },
    batchOpts() {
      if (!this.form.whId) return [{ value: '', label: '请先选择仓库' }];
      const S = window.S, set = {}, arr = [];
      (S.db.stocks || []).filter(s => s.whId === this.form.whId && Number(s.qty) > 0).forEach(s => {
        (s.lots || []).forEach(l => {
          if (Number(l.qty) > 0 && !set[l.batchNo]) { set[l.batchNo] = true; arr.push(l.batchNo); }
        });
      });
      if (!arr.length) return [{ value: '', label: '该仓库无库存批次' }];
      return [{ value: '', label: '请选择批次' }].concat(arr.map(b => ({ value: b, label: b })));
    },
    goodsPick() {
      if (!this.form.whId || !this.form.batchNo) return [{ value: '', label: '请先选择仓库和批次' }];
      const S = window.S;
      const goodsIds = new Set();
      (S.db.stocks || []).filter(s => s.whId === this.form.whId && Number(s.qty) > 0).forEach(s => {
        if ((s.lots || []).some(l => l.batchNo === this.form.batchNo && Number(l.qty) > 0)) goodsIds.add(s.goodsId);
      });
      if (!goodsIds.size) return [{ value: '', label: '该仓库批次下无可用商品' }];
      return [{ value: '', label: '请选择' }].concat((S.enabled('goods') || [])
        .filter(g => goodsIds.has(g.id))
        .map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name })));
    },
    statusOpts() { return [{ value: '', label: '全部状态' }, { value: '未发放', label: '未发放' }, { value: '已发放', label: '已发放' }]; },
    rows() {
      const S = window.S, q = this.q;
      return (S.db.personPromos || []).filter(r =>
        (!q.promoter || U.kw(r.promoter, q.promoter)) &&
        (!q.refCustomerId || r.refCustomerId === q.refCustomerId) &&
        (!q.status || r.status === q.status) &&
        U.inRange(r.createTime, q.d1, q.d2)
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.size, this.page * this.size); },
    total() { return this.rows.length; },
    ppTotals() {
      return {
        qty: U.round2(this.rows.reduce((a, r) => a + (Number(r.qty) || 0), 0))
      };
    }
  },
  methods: {
    custName(id) { const c = window.S.byId('customers', id); return c ? c.name : ''; },
    goodsName(id) { const g = window.S.byId('goods', id); return g ? (g.sku ? g.name + '（' + g.sku + '）' : g.name) : ''; },
    whName(id) { const w = window.S.byId('warehouses', id); return w ? w.name : ''; },
    resetForm() { this.form = { id: '', promoter: '', phone: '', refCustomerId: '', goodsId: '', whId: '', batchNo: '', qty: 1, status: '未发放', remark: '' }; this.editingId = ''; },
    openNew() { this.resetForm(); this.showForm = true; },
    openEdit(r) { this.form = Object.assign({}, r); this.editingId = r.id; this.showForm = true; },
    save() {
      const f = this.form;
      if (!f.promoter || !f.promoter.trim()) return alert('请填写推广人');
      if (!f.refCustomerId) return alert('请选择被推荐客户名称');
      if (!f.goodsId) return alert('请选择本次奖励商品');
      if (!f.whId) return alert('请选择仓库');
      if (!f.batchNo) return alert('请选择批次');
      if (!f.qty || f.qty <= 0) return alert('请填写奖励数量');
      if (this.editingId) {
        const ex = window.S.byId('personPromos', this.editingId);
        if (ex) Object.assign(ex, f);
      } else {
        window.S.db.personPromos.push({ id: window.S.genId(), createTime: U.now(), status: '未发放', promoter: f.promoter.trim(), phone: f.phone, refCustomerId: f.refCustomerId, goodsId: f.goodsId, whId: f.whId, batchNo: f.batchNo, qty: Number(f.qty), remark: f.remark });
      }
      this.showForm = false;
    },
    issue(r) {
      if (r.status !== '未发放') return alert('仅「未发放」记录可发放');
      const res = window.S.issuePromoReward(r);
      if (!res.ok) return alert(res.msg);
      r.status = '已发放';
      alert('已发放并扣减库存');
    },
    delRec(r) {
      if (r.status !== '未发放') return alert('仅「未发放」记录可删除');
      window.S.db.personPromos = window.S.db.personPromos.filter(x => x.id !== r.id);
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <button class="btn btn-primary" v-if="canEdit" @click="openNew">新增</button>
      <x-combobox v-model="q.promoter" :options="promoterAll" editable placeholder="推广人" style="width:150px"/>
      <x-combobox v-model="q.refCustomerId" :options="custAll" placeholder="被推荐客户名称" style="width:160px"/>
      <x-combobox v-model="q.status" :options="statusOpts" placeholder="状态" style="width:120px"/>
      <label>创建时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
    </div>
    <table class="grid">
      <thead><tr>
        <th>序号</th><th>推广人</th><th>联系电话/微信</th><th>被推荐客户名称</th><th>仓库名称</th>
        <th>批次</th><th>本次奖励商品</th><th>奖励数量</th><th>创建时间</th><th>状态</th><th>备注</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="(r,i) in paged" :key="r.id">
          <td>{{ (page-1)*size + i + 1 }}</td>
          <td>{{ r.promoter }}</td>
          <td>{{ r.phone }}</td>
          <td>{{ custName(r.refCustomerId) }}</td>
          <td>{{ whName(r.whId) }}</td>
          <td>{{ r.batchNo }}</td>
          <td>{{ goodsName(r.goodsId) }}</td>
          <td>{{ r.qty }}</td>
          <td>{{ r.createTime }}</td>
          <td>{{ r.status }}</td>
          <td>{{ r.remark }}</td>
          <td class="ops">
            <a v-if="canEdit" @click="openEdit(r)">修改</a>
            <a v-if="canEdit && r.status==='未发放'" @click="issue(r)">发放</a>
            <a v-if="canEdit && r.status==='未发放'" @click="delRec(r)">删除</a>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="12" class="empty">暂无数据</td></tr>
        <tr v-if="paged.length" style="background:#eff6ff;font-weight:700">
          <td colspan="7">合计</td>
          <td>{{ ppTotals.qty }}</td>
          <td colspan="4"></td>
        </tr>
      </tbody>
    </table>
    <x-pager :total="total" v-model:page="page" v-model:size="size"/>

    <x-modal v-if="showForm" :title="editingId?'修改个人推广':'新增个人推广'" :width="600" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>推广人<b class="req">*</b></label>
          <x-combobox v-model="form.promoter" :options="promoterOpts" editable placeholder="可手填新推广人"/>
        </div>
        <div class="form-item"><label>联系电话/微信</label><x-combobox v-model="form.phone" :options="phoneOpts" editable placeholder="可手填"/></div>
        <div class="form-item"><label>被推荐客户名称<b class="req">*</b></label><x-combobox v-model="form.refCustomerId" :options="custPick" placeholder="请选择"/></div>
        <div class="form-item"><label>仓库名称<b class="req">*</b></label><x-combobox v-model="form.whId" :options="whPick" placeholder="请选择"/></div>
        <div class="form-item"><label>批次<b class="req">*</b></label><x-combobox v-model="form.batchNo" :options="batchOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>本次奖励商品<b class="req">*</b></label><x-combobox v-model="form.goodsId" :options="goodsPick" placeholder="请选择"/></div>
        <div class="form-item"><label>奖励数量<b class="req">*</b></label><input type="number" min="0" step="1" v-model.number="form.qty"></div>
        <div class="form-item full"><label>备注</label><textarea rows="2" v-model="form.remark"></textarea></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
  </div>`
};

/* ==================== 活动运营汇总（三张汇总表，均支持分页 / 查询 / 导出） ==================== */
const ActivitySummary = {
  data() {
    return {
      mPage: 1, mSize: 10, mQ: { customerId: '' },
      prPage: 1, prSize: 10, prQ: { recommender: '' },
      ppPage: 1, ppSize: 10, ppQ: { promoter: '', goodsId: '' }
    };
  },
  computed: {
    S() { return window.S; },
    custAll() { return actCustAll(); },
    goodsAll() { return actGoodsAll(); },
    recommenderOpts() {
      const set = {};
      (window.S.db.personRefs || []).forEach(r => { if (r.recommender) set[r.recommender] = 1; });
      return Object.keys(set).map(v => ({ value: v, label: v }));
    },
    promoterOpts() {
      const set = {};
      (window.S.db.personPromos || []).forEach(r => { if (r.promoter) set[r.promoter] = 1; });
      return Object.keys(set).map(v => ({ value: v, label: v }));
    },

    /* ① 商家推荐汇总：按客户名称分组 */
    merchantRows() {
      const S = window.S, q = this.mQ, acc = {};
      (S.db.merchantRefs || []).forEach(r => {
        if (r.status !== '已预存' && r.status !== '已发放') return;
        if (q.customerId && r.customerId !== q.customerId) return;
        if (!acc[r.customerId]) {
          const c = S.byId('customers', r.customerId);
          acc[r.customerId] = { id: r.customerId, name: c ? c.name : '', custSet: {}, reward: 0 };
        }
        if (r.refCustomerId) acc[r.customerId].custSet[r.refCustomerId] = 1;
        acc[r.customerId].reward += Number(r.actualReward || 0);
      });
      return Object.values(acc).map(x => ({
        name: x.name,
        custCount: Object.keys(x.custSet).length,
        reward: U.round2(x.reward)
      })).sort((a, b) => b.reward - a.reward);
    },
    merchantPaged() { return this.merchantRows.slice((this.mPage - 1) * this.mSize, this.mPage * this.mSize); },
    merchantTotal() {
      return {
        custCount: this.merchantRows.reduce((a, r) => a + r.custCount, 0),
        reward: U.round2(this.merchantRows.reduce((a, r) => a + r.reward, 0))
      };
    },

    /* ② 个人推荐汇总：按推荐人分组 */
    personRefRows() {
      const S = window.S, q = this.prQ, acc = {};
      (S.db.personRefs || []).forEach(r => {
        if (r.status !== '已发放') return;
        if (q.recommender && !U.kw(r.recommender, q.recommender)) return;
        const key = (r.recommender || '').trim();
        if (!acc[key]) acc[key] = { name: key, custSet: {}, reward: 0 };
        if (r.refCustomerId) acc[key].custSet[r.refCustomerId] = 1;
        acc[key].reward += Number(r.paidAmount || 0);
      });
      return Object.values(acc).map(x => ({
        name: x.name,
        custCount: Object.keys(x.custSet).length,
        reward: U.round2(x.reward)
      })).sort((a, b) => b.reward - a.reward);
    },
    personRefPaged() { return this.personRefRows.slice((this.prPage - 1) * this.prSize, this.prPage * this.prSize); },
    personRefTotal() {
      return {
        custCount: this.personRefRows.reduce((a, r) => a + r.custCount, 0),
        reward: U.round2(this.personRefRows.reduce((a, r) => a + r.reward, 0))
      };
    },

    /* ③ 个人推广汇总：按推广人 + 奖励商品分组 */
    personPromoRows() {
      const S = window.S, q = this.ppQ, acc = {};
      (S.db.personPromos || []).forEach(r => {
        if (r.status !== '已发放') return;
        if (q.promoter && !U.kw(r.promoter, q.promoter)) return;
        if (q.goodsId && r.goodsId !== q.goodsId) return;
        const key = (r.promoter || '').trim() + '|' + r.goodsId;
        const g = S.byId('goods', r.goodsId);
        const goodsName = g ? (g.sku ? g.name + '（' + g.sku + '）' : g.name) : '';
        if (!acc[key]) acc[key] = { promoter: (r.promoter || '').trim(), goods: goodsName, qty: 0 };
        acc[key].qty += Number(r.qty || 0);
      });
      return Object.values(acc).map(x => ({
        promoter: x.promoter, goods: x.goods, qty: U.round2(x.qty)
      })).sort((a, b) => b.qty - a.qty);
    },
    personPromoPaged() { return this.personPromoRows.slice((this.ppPage - 1) * this.ppSize, this.ppPage * this.ppSize); },
    personPromoTotal() {
      return { qty: U.round2(this.personPromoRows.reduce((a, r) => a + r.qty, 0)) };
    }
  },
  methods: {
    custName(id) { const c = window.S.byId('customers', id); return c ? c.name : ''; },
    exportMerchant() {
      if (!this.merchantRows.length) return alert('没有可导出的数据');
      U.exportExcel('商家推荐汇总.xlsx', this.merchantRows.map((r, i) => ({
        序号: i + 1, 客户名称: r.name, 累计推荐客户数量: r.custCount, 累计实际奖励: r.reward
      })));
    },
    exportPersonRef() {
      if (!this.personRefRows.length) return alert('没有可导出的数据');
      U.exportExcel('个人推荐汇总.xlsx', this.personRefRows.map((r, i) => ({
        序号: i + 1, 推荐人: r.name, 累计推荐客户数量: r.custCount, 累计奖励: r.reward
      })));
    },
    exportPersonPromo() {
      if (!this.personPromoRows.length) return alert('没有可导出的数据');
      U.exportExcel('个人推广汇总.xlsx', this.personPromoRows.map((r, i) => ({
        序号: i + 1, 推广人: r.promoter, 奖励商品: r.goods, 累计奖励数量: r.qty
      })));
    }
  },
  template: `
  <div>
    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>商家推荐汇总（按客户）</span>
        <div class="toolbar" style="margin:0">
          <x-combobox v-model="mQ.customerId" :options="custAll" placeholder="客户名称" style="width:160px"/>
          <button class="btn" @click="exportMerchant">导出</button>
        </div>
      </div>
      <table class="grid">
        <thead><tr><th>序号</th><th>客户名称</th><th>累计推荐客户数量</th><th>累计实际奖励</th></tr></thead>
        <tbody>
          <tr v-for="(r,i) in merchantPaged" :key="r.name">
            <td>{{ (mPage-1)*mSize + i + 1 }}</td>
            <td>{{ r.name }}</td>
            <td>{{ r.custCount }}</td>
            <td>￥{{ U.fmtMoney(r.reward) }}</td>
          </tr>
          <tr v-if="!merchantPaged.length"><td colspan="4" class="empty">暂无数据</td></tr>
          <tr v-if="merchantPaged.length" style="background:#eff6ff;font-weight:700">
            <td colspan="2">合计</td>
            <td>{{ merchantTotal.custCount }}</td>
            <td>￥{{ U.fmtMoney(merchantTotal.reward) }}</td>
          </tr>
        </tbody>
      </table>
      <x-pager :total="merchantRows.length" v-model:page="mPage" v-model:size="mSize"/>
    </div>

    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>个人推荐汇总（按推荐人）</span>
        <div class="toolbar" style="margin:0">
          <x-combobox v-model="prQ.recommender" :options="recommenderOpts" editable placeholder="推荐人" style="width:150px"/>
          <button class="btn" @click="exportPersonRef">导出</button>
        </div>
      </div>
      <table class="grid">
        <thead><tr><th>序号</th><th>推荐人</th><th>累计推荐客户数量</th><th>累计奖励</th></tr></thead>
        <tbody>
          <tr v-for="(r,i) in personRefPaged" :key="r.name">
            <td>{{ (prPage-1)*prSize + i + 1 }}</td>
            <td>{{ r.name }}</td>
            <td>{{ r.custCount }}</td>
            <td>￥{{ U.fmtMoney(r.reward) }}</td>
          </tr>
          <tr v-if="!personRefPaged.length"><td colspan="4" class="empty">暂无数据</td></tr>
          <tr v-if="personRefPaged.length" style="background:#eff6ff;font-weight:700">
            <td colspan="2">合计</td>
            <td>{{ personRefTotal.custCount }}</td>
            <td>￥{{ U.fmtMoney(personRefTotal.reward) }}</td>
          </tr>
        </tbody>
      </table>
      <x-pager :total="personRefRows.length" v-model:page="prPage" v-model:size="prSize"/>
    </div>

    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>个人推广汇总（按推广人 + 奖励商品）</span>
        <div class="toolbar" style="margin:0">
          <x-combobox v-model="ppQ.promoter" :options="promoterOpts" editable placeholder="推广人" style="width:150px"/>
          <x-combobox v-model="ppQ.goodsId" :options="goodsAll" placeholder="奖励商品" style="width:160px"/>
          <button class="btn" @click="exportPersonPromo">导出</button>
        </div>
      </div>
      <table class="grid">
        <thead><tr><th>序号</th><th>推广人</th><th>奖励商品</th><th>累计奖励数量</th></tr></thead>
        <tbody>
          <tr v-for="(r,i) in personPromoPaged" :key="r.promoter + r.goods">
            <td>{{ (ppPage-1)*ppSize + i + 1 }}</td>
            <td>{{ r.promoter }}</td>
            <td>{{ r.goods }}</td>
            <td>{{ r.qty }}</td>
          </tr>
          <tr v-if="!personPromoPaged.length"><td colspan="4" class="empty">暂无数据</td></tr>
          <tr v-if="personPromoPaged.length" style="background:#eff6ff;font-weight:700">
            <td colspan="3">合计</td>
            <td>{{ personPromoTotal.qty }}</td>
          </tr>
        </tbody>
      </table>
      <x-pager :total="personPromoRows.length" v-model:page="ppPage" v-model:size="ppSize"/>
    </div>
  </div>`
};

/* ==================== 活动管理根组件（一个页面，顶部 Tab 切换 4 子模块） ==================== */
window.Pages['page-activity'] = {
  components: { 'merchant-ref': MerchantRef, 'person-ref': PersonRef, 'person-promo': PersonPromo, 'activity-summary': ActivitySummary },
  data() { return { tab: '商家推荐明细' }; },
  template: `
  <div>
    <div class="page-title">活动管理</div>
    <div class="tabs">
      <div class="tab" v-for="t in ['商家推荐明细','个人推荐明细','个人推广明细','活动运营汇总']" :key="t" :class="{active:tab===t}" @click="tab=t">{{t}}</div>
    </div>
    <div class="card">
      <merchant-ref v-if="tab==='商家推荐明细'"/>
      <person-ref v-else-if="tab==='个人推荐明细'"/>
      <person-promo v-else-if="tab==='个人推广明细'"/>
      <activity-summary v-else/>
    </div>
  </div>`
};
