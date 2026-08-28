/* 经销商管理：经销商列表 / 奖励规则 / 奖励发放
   经销商 = 客户类型（settings.dealerReward.typeIds 指定的 custTypes）。
   全年采购额 = 该客户当年已完成销售净额；奖励 = 全年采购额 × 命中阶梯比例（全额档）。
   奖励可「计提为预存货款」（进入可用余额，销售结算时手动抵扣）或「现金发放」。 */
window.Pages = window.Pages || {};

/* ---------------- 经销商列表 ---------------- */
const DealerList = {
  data() {
    return {
      q: { name: '', year: new Date().getFullYear(), d1: '', d2: '' },
      page: 1, pageSize: 10, detail: null
    };
  },
  computed: {
    S() { return window.S; },
    rows() {
      const list = S.dealerRewardReport(String(this.q.year)).filter(c =>
        U.kw(c.name, this.q.name));
      return list;
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    yearOpts() {
      const y = new Date().getFullYear();
      return [y, y - 1, y - 2, y - 3].map(v => ({ value: String(v), label: String(v) + ' 年' }));
    }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    tierText(t) {
      if (!t) return '-';
      const max = (t.max == null || t.max === '') ? '∞' : U.fmtMoney(Number(t.max));
      return U.fmtMoney(Number(t.min)) + ' ~ ' + max + ' / ' + (Number(t.rate) || 0) + '%';
    },
    detailFields(r) {
      return [
        { label: '客户名称', value: r.name },
        { label: '区域', value: r.region || '-' },
        { label: '全年采购额', value: U.fmtMoney(r.annualAmount) },
        { label: '命中阶梯', value: this.tierText(r.tier) },
        { label: '应得奖励', value: U.fmtMoney(r.rewardAmount) },
        { label: '预存货款余额', value: U.fmtMoney(r.prepaidBalance) },
        { label: '本年已计提', value: U.fmtMoney(r.settled) }
      ];
    },
    exportData() {
      U.exportExcel('经销商年度奖励_' + this.q.year + '.xlsx', this.rows.map((r, i) => ({
        '序号': i + 1, '客户名称': r.name, '区域': r.region || '',
        '全年采购额': r.annualAmount, '命中阶梯': this.tierText(r.tier),
        '应得奖励': r.rewardAmount, '预存货款余额': r.prepaidBalance, '本年已计提': r.settled
      })));
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <input type="text" v-model="q.name" placeholder="客户名称模糊查询">
      <x-combobox v-model="q.year" :options="yearOpts" placeholder="选择年度"/>
      <div class="spacer"></div>
      <button class="btn" @click="exportData">导出</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr>
        <th>序号</th><th>客户名称</th><th>区域</th>
        <th class="num">全年采购额</th><th>命中阶梯（区间/比例）</th>
        <th class="num">应得奖励</th><th class="num">预存货款余额</th><th class="num">本年已计提</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="(r,i) in paged" :key="r.id">
          <td data-label="序号">{{(page-1)*pageSize+i+1}}</td>
          <td data-label="客户名称">{{r.name}}</td>
          <td data-label="区域">{{r.region||'-'}}</td>
          <td class="num money" data-label="全年采购额">{{fmtMoney(r.annualAmount)}}</td>
          <td data-label="命中阶梯">{{tierText(r.tier)}}</td>
          <td class="num money green" data-label="应得奖励">{{fmtMoney(r.rewardAmount)}}</td>
          <td class="num money" :class="{red:r.prepaidBalance>0}" data-label="预存货款余额">{{fmtMoney(r.prepaidBalance)}}</td>
          <td class="num money" data-label="本年已计提">{{fmtMoney(r.settled)}}</td>
          <td class="ops" data-label="操作">
            <span class="link" @click="detail=r">查看</span>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="9" class="empty">暂无经销商客户（请在「奖励规则」中选择经销商类型）</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <x-modal v-if="detail" :title="'经销商详情 - '+detail.name" :width="560" @close="detail=null">
      <div class="form-grid">
        <div class="form-item" v-for="f in detailFields(detail)" :key="f.label">
          <label>{{f.label}}</label><div>{{f.value}}</div>
        </div>
      </div>
      <template #foot><button class="btn" @click="detail=null">关闭</button></template>
    </x-modal>
  </div>`
};

/* ---------------- 奖励规则 ---------------- */
const DealerRule = {
  data() {
    return { form: { tiers: [], typeIds: [] } };
  },
  computed: {
    S() { return window.S; },
    custTypes() { return S.enabled('custTypes'); }
  },
  created() {
    const dr = (S.db.settings.dealerReward) || {};
    this.form.typeIds = (dr.typeIds || []).slice();
    this.form.tiers = (dr.tiers && dr.tiers.length)
      ? dr.tiers.map(t => ({ min: t.min, max: t.max, rate: t.rate }))
      : [{ min: 0, max: '', rate: 0 }];
  },
  methods: {
    addTier() { this.form.tiers.push({ min: 0, max: '', rate: 0 }); },
    delTier(i) { this.form.tiers.splice(i, 1); },
    save() {
      const dr = (S.db.settings.dealerReward = S.db.settings.dealerReward || {});
      dr.tiers = this.form.tiers
        .filter(t => t.min != null && t.min !== '')
        .map(t => ({ min: Number(t.min) || 0, max: (t.max === '' || t.max == null) ? '' : Number(t.max), rate: Number(t.rate) || 0 }))
        .sort((a, b) => a.min - b.min);
      dr.typeIds = this.form.typeIds.map(Number).filter(Boolean);
      alert('奖励规则已保存');
    }
  },
  template: `
  <div>
    <div class="card" style="padding:16px;margin-bottom:14px">
      <div class="form-grid">
        <div class="form-item full">
          <label>选择「经销商」客户类型（多选：被勾选的客户类型视为经销商）</label>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">
            <label v-for="t in custTypes" :key="t.id" style="display:flex;align-items:center;gap:4px">
              <input type="checkbox" :value="t.id" v-model="form.typeIds"> {{t.name}}
            </label>
            <span v-if="!custTypes.length" class="muted">请先在「客户类型」中创建类型</span>
          </div>
        </div>
      </div>
    </div>

    <div class="toolbar">
      <b>阶梯规则（全年采购额 × 命中比例）</b>
      <div class="spacer"></div>
      <button class="btn" @click="addTier">+ 新增阶梯</button>
      <button class="btn btn-primary" @click="save">保存规则</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr>
        <th>下限（≥，元）</th><th>上限（<，元，留空=∞）</th><th>奖励比例（%）</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="(t,i) in form.tiers" :key="i">
          <td><input type="number" min="0" step="0.01" v-model.number="t.min"></td>
          <td><input type="number" min="0" step="0.01" v-model.number="t.max" placeholder="∞"></td>
          <td><input type="number" min="0" step="0.01" v-model.number="t.rate"></td>
          <td class="ops"><span class="link danger" @click="delTier(i)">删除</span></td>
        </tr>
        <tr v-if="!form.tiers.length"><td colspan="4" class="empty">暂无阶梯，点击「新增阶梯」添加</td></tr>
      </tbody>
    </table>
    </div>
    <div class="form-hint" style="margin-top:8px">
      说明：奖励金额 = 全年采购净额 × 命中区间的比例（全额档）。例如采购额落在「10万~50万 / 3%」区间，则全部采购额按 3% 计提。请将最高一档「上限」留空表示无上限。
    </div>
  </div>`
};

/* ---------------- 奖励发放 ---------------- */
const DealerSettle = {
  data() {
    return { year: String(new Date().getFullYear()), page: 1, pageSize: 10 };
  },
  computed: {
    S() { return window.S; },
    yearOpts() {
      const y = new Date().getFullYear();
      return [y, y - 1, y - 2, y - 3].map(v => ({ value: String(v), label: String(v) + ' 年' }));
    },
    rows() {
      const recs = S.db.dealerRewards || [];
      return S.dealerRewardReport(this.year).map(r => {
        const rec = recs.find(x => x.dealerId === r.id && String(x.year) === String(this.year));
        return Object.assign({}, r, { rec });
      });
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    tierText(t) {
      if (!t) return '-';
      const max = (t.max == null || t.max === '') ? '∞' : U.fmtMoney(Number(t.max));
      return U.fmtMoney(Number(t.min)) + ' ~ ' + max + ' / ' + (Number(t.rate) || 0) + '%';
    },
    canIssueNew(r) {
      // 已有「预存货款」且被抵扣则不允许切换类型
      return !(r.rec && r.rec.settleType === '预存货款' && (Number(r.rec.usedAmount) || 0) > 0);
    },
    issue(r, type) {
      if (!r.rewardAmount || r.rewardAmount <= 0) return alert('该经销商本年采购额未落入任何阶梯，无奖励可发');
      if (r.rec && r.rec.settleType === '预存货款' && (Number(r.rec.usedAmount) || 0) > 0)
        return alert('该预存货款已被销售结算抵扣 ￥' + U.fmtMoney(Number(r.rec.usedAmount)) + '，请先在结算中撤销抵扣后再操作');
      const rec = {
        dealerId: r.id, year: Number(this.year), annualAmount: r.annualAmount,
        tierRate: r.tier ? Number(r.tier.rate) || 0 : 0, rewardAmount: r.rewardAmount,
        settleType: type, operator: (Cloud.state.user && Cloud.state.user.name) || '', createdAt: U.now()
      };
      S.addDealerReward(rec);
      alert(type === '预存货款' ? '已计提为预存货款，可在销售结算时抵扣' : '已现金发放');
    },
    removeRec(r) {
      if (!r.rec) return;
      const msg = S.deleteDealerReward(r.rec.id);
      if (msg) alert(msg);
    },
    exportData() {
      U.exportExcel('经销商奖励发放_' + this.year + '.xlsx', this.rows.map((r, i) => ({
        '序号': i + 1, '客户名称': r.name, '区域': r.region || '',
        '全年采购额': r.annualAmount, '命中阶梯': this.tierText(r.tier), '应得奖励': r.rewardAmount,
        '发放方式': r.rec ? r.rec.settleType : '未发放', '预存货款余额': r.prepaidBalance, '备注': r.rec ? (r.rec.remark || '') : ''
      })));
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <x-combobox v-model="year" :options="yearOpts" placeholder="选择年度"/>
      <div class="spacer"></div>
      <button class="btn" @click="exportData">导出</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr>
        <th>序号</th><th>客户名称</th><th>区域</th>
        <th class="num">全年采购额</th><th>命中阶梯</th><th class="num">应得奖励</th>
        <th class="num">预存货款余额</th><th>发放状态</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="(r,i) in paged" :key="r.id">
          <td data-label="序号">{{(page-1)*pageSize+i+1}}</td>
          <td data-label="客户名称">{{r.name}}</td>
          <td data-label="区域">{{r.region||'-'}}</td>
          <td class="num money" data-label="全年采购额">{{fmtMoney(r.annualAmount)}}</td>
          <td data-label="命中阶梯">{{tierText(r.tier)}}</td>
          <td class="num money green" data-label="应得奖励">{{fmtMoney(r.rewardAmount)}}</td>
          <td class="num money" :class="{red:r.prepaidBalance>0}" data-label="预存货款余额">{{fmtMoney(r.prepaidBalance)}}</td>
          <td data-label="发放状态">
            <span v-if="!r.rec" class="tag tag-gray">未发放</span>
            <span v-else :class="r.rec.settleType==='预存货款'?'tag tag-blue':'tag tag-green'">{{r.rec.settleType}}
              <span v-if="r.rec.settleType==='预存货款' && Number(r.rec.usedAmount)">（已抵扣{{fmtMoney(r.rec.usedAmount)}}）</span>
            </span>
          </td>
          <td class="ops" data-label="操作">
            <template v-if="!r.rec">
              <span class="link" @click="issue(r,'预存货款')">计提预存货款</span>
              <span class="link" @click="issue(r,'现金发放')">现金发放</span>
            </template>
            <template v-else-if="canIssueNew(r)">
              <span class="link danger" @click="removeRec(r)">删除</span>
            </template>
            <span v-else class="muted">已抵扣</span>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="9" class="empty">暂无经销商客户（请在「奖励规则」中选择经销商类型）</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>
  </div>`
};

Pages['page-dealer'] = {
  components: { 'dealer-list': DealerList, 'dealer-rule': DealerRule, 'dealer-settle': DealerSettle },
  data() { return { tab: '经销商列表' }; },
  template: `
  <div>
    <div class="page-title">经销商管理</div>
    <div class="tabs">
      <div class="tab" v-for="t in ['经销商列表','奖励规则','奖励发放']" :key="t" :class="{active:tab===t}" @click="tab=t">{{t}}</div>
    </div>
    <div class="card">
      <dealer-list v-if="tab==='经销商列表'"/>
      <dealer-rule v-else-if="tab==='奖励规则'"/>
      <dealer-settle v-else/>
    </div>
  </div>`
};
