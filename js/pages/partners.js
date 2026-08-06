/* 合伙人管理：资源合伙人 / 区域合伙人 */
window.Pages = window.Pages || {};

function partnerListFactory(isRegion) {
  const coll = isRegion ? 'regionPartners' : 'resourcePartners';
  const label = isRegion ? '区域合伙人' : '资源合伙人';
  return {
    data() {
      return {
        kw: '', st: '', page: 1, pageSize: 10, showForm: false, editing: null, form: {}, detail: null,
        payForm: null
      };
    },
    computed: {
      S() { return window.S; },
      rows() {
        return S.db[coll].filter(p =>
          U.kw(p.name + (p.phone || ''), this.kw) && (!this.st || p.status === this.st)
        ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
      },
      paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
      statusOpts() { return [{ value: '', label: '全部状态' }, { value: '已启用', label: '已启用' }, { value: '未启用', label: '未启用' }]; },
      regionOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('regions').map(r => ({ value: r.id, label: r.name }))); },
      ptype() { return isRegion ? '区域' : '资源'; },
      detailAcc() { return this.detail ? S.partnerCommissionAccount(this.detail.id, this.ptype) : null; },
      detailPledge() { return this.detail ? S.pledgeList(this.detail.id, this.ptype) : []; },
      detailPays() { return this.detail ? S.commissionPayList(this.detail.id, this.ptype) : []; }
    },
    methods: {
      fmtMoney: U.fmtMoney,
      isRegion: () => isRegion,
      rowFields(p) {
        const f = [
          { label: '姓名', value: p.name },
          { label: '电话', value: p.phone || '-' }
        ];
        if (this.isRegion()) {
          f.push({ label: '负责区域', value: S.name('regions', p.regionId) || '-' });
          f.push({ label: '佣金比例', value: this.rateOf(p) + '%' });
          f.push({ label: '名下客户数', value: this.custCount(p) });
        } else {
          const cc = this.custCount(p);
          f.push({ label: '担任一级', value: cc[0] + ' 家' });
          f.push({ label: '担任二级', value: cc[1] + ' 家' });
          f.push({ label: '担任三级', value: cc[2] + ' 家' });
        }
        f.push({ label: '累计佣金', value: '￥' + U.fmtMoney(this.acc(p).earned) });
        f.push({ label: '已支付', value: '￥' + U.fmtMoney(this.acc(p).paid) });
        f.push({ label: '质押中', value: '￥' + U.fmtMoney(this.acc(p).pledge) });
        f.push({ label: '可支付', value: '￥' + U.fmtMoney(this.acc(p).payable) });
        f.push({ label: '备注', value: p.remark || '-' });
        f.push({ label: '创建时间', value: p.createTime });
        f.push({ label: '状态', value: p.status });
        return f;
      },
      custCount(p) {
        if (isRegion) return S.db.customers.filter(c => c.regionPartnerId === p.id).length;
        const n = [0, 0, 0];
        S.db.customers.forEach(c => { [1, 2, 3].forEach(L => { if (c['r' + L] === p.id) n[L - 1]++; }); });
        return n;
      },
      rateOf(p) { return S.activeRegionRate(p.id); },
      commTotal(p) {
        if (isRegion) {
          const r = S.regionCommission(null, null).find(x => x.partnerId === p.id);
          return r ? r.commission : 0;
        }
        return U.round2(S.resourceCommission(null, null).filter(x => x.partnerId === p.id).reduce((a, x) => a + x.commission, 0));
      },
      detailRows(p) {
        if (isRegion) return S.db.customers.filter(c => c.regionPartnerId === p.id).map(c => ({ name: c.name, role: '区域客户' }));
        const out = [];
        S.db.customers.forEach(c => {
          [1, 2, 3].forEach(L => { if (c['r' + L] === p.id) out.push({ name: c.name, role: ['一级', '二级', '三级'][L - 1] + '资源' }); });
        });
        return out;
      },
      detailComm(p) {
        if (isRegion) {
          const r = S.regionCommission(null, null).find(x => x.partnerId === p.id);
          return r ? [{ level: '区域佣金', sales: r.sales, rate: r.rate, commission: r.commission }] : [];
        }
        return S.resourceCommission(null, null).filter(x => x.partnerId === p.id)
          .map(x => ({ level: ['一级', '二级', '三级'][x.level - 1], sales: x.sales, rate: x.rate, commission: x.commission }));
      },
      openNew() { this.editing = null; this.form = { name: '', phone: '', regionId: '', remark: '' }; this.showForm = true; },
      openEdit(p) { this.editing = p; this.form = { ...p }; this.showForm = true; },
      save() {
        const f = this.form;
        if (!f.name.trim()) return alert('请输入姓名');
        if (isRegion && !f.regionId) return alert('请选择负责区域');
        const data = { name: f.name.trim(), phone: f.phone, remark: f.remark };
        if (isRegion) data.regionId = f.regionId;
        if (this.editing) Object.assign(this.editing, data);
        else S.db[coll].push({ id: S.genId(), ...data, createTime: U.now(), status: '已启用' });
        this.showForm = false;
      },
      del(p) {
        if (S.usedBy(coll, p.id)) return alert('该合伙人已被客户或佣金比例引用，无法删除，可改为停用');
        if (!U.confirm('确定删除「' + p.name + '」吗？')) return;
        S.db[coll] = S.db[coll].filter(x => x.id !== p.id);
      },
      toggle(p) { p.status = p.status === '已启用' ? '未启用' : '已启用'; },
      /* ---- 佣金账户 / 支付 ---- */
      acc(p) { return S.partnerCommissionAccount(p.id, isRegion ? '区域' : '资源'); },
      openPay() {
        const a = this.detailAcc;
        this.payForm = { amount: a ? a.payable : 0, remark: '' };
      },
      savePay() {
        const a = this.detailAcc, f = this.payForm;
        const amt = Number(f.amount);
        if (!amt || amt <= 0) return alert('请输入有效的支付金额');
        if (amt > a.payable) {
          if (!U.confirm('本次支付 ￥' + U.fmtMoney(amt) + ' 已超过可支付金额 ￥' + U.fmtMoney(a.payable)
            + '（质押中 ￥' + U.fmtMoney(a.pledge) + '）。超额支付存在退货/跑单风险，确定继续吗？')) return;
        }
        S.addCommissionPay({ partnerId: this.detail.id, type: this.ptype, amount: amt, remark: f.remark });
        this.payForm = null;
      },
      delPay(rec) {
        if (!U.confirm('撤销该笔佣金支付记录（￥' + U.fmtMoney(rec.amount) + '）吗？')) return;
        S.db.commissionPayments = S.db.commissionPayments.filter(x => x.id !== rec.id);
      },
      exportPledge() {
        U.exportExcel((this.detail.name || '') + '-质押佣金明细.xlsx', this.detailPledge.map((r, i) => ({
          '序号': i + 1, '销售单号': r.no, '客户名称': r.custName, '销售净额': r.net,
          '对应佣金': r.commission, '质押原因': r.reasons.join(' + '), '支付状态': r.payStatus, '完成时间': r.finishTime
        })));
      }
    },
    template: `
    <div>
      <div class="toolbar">
        <input type="text" v-model="kw" placeholder="姓名/电话模糊查询">
        <x-combobox v-model="st" :options="statusOpts" placeholder="全部状态"/>
        <div class="spacer"></div>
        <button class="btn btn-primary" @click="openNew">+ 新增${label}</button>
      </div>
      <div class="table-wrap">
      <template v-if="!$root.isMobile">
      <table class="grid wide-table">
        <thead><tr>
          <th>序号</th><th>姓名</th><th>电话</th>
          ${isRegion ? '<th>负责区域</th><th class="num">佣金比例</th><th class="num">名下客户数</th>' : '<th>担任一级</th><th>担任二级</th><th>担任三级</th>'}
          <th class="num">累计佣金</th><th class="num">已支付</th><th class="num">质押中</th><th class="num">可支付</th>
          <th>备注</th><th>创建时间</th><th>状态</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="(p,i) in paged" :key="p.id">
            <td>{{(page-1)*pageSize+i+1}}</td><td>{{p.name}}</td><td>{{p.phone||'-'}}</td>
            ${isRegion
              ? `<td>{{S.name('regions',p.regionId)||'-'}}</td><td class="num">{{rateOf(p)}}%</td><td class="num">{{custCount(p)}}</td>`
              : `<td class="num">{{custCount(p)[0]}} 家</td><td class="num">{{custCount(p)[1]}} 家</td><td class="num">{{custCount(p)[2]}} 家</td>`}
            <td class="num money">{{fmtMoney(acc(p).earned)}}</td>
            <td class="num money green-t">{{fmtMoney(acc(p).paid)}}</td>
            <td class="num money" :class="{orange:acc(p).pledge>0}">{{fmtMoney(acc(p).pledge)}}</td>
            <td class="num money"><b>{{fmtMoney(acc(p).payable)}}</b></td>
            <td>{{p.remark||'-'}}</td><td>{{p.createTime}}</td>
            <td><x-status :v="p.status"/></td>
            <td class="ops">
              <span class="link" @click="detail=p">详情</span>
              <span class="link" @click="openEdit(p)">修改</span>
              <span class="link danger" @click="del(p)">删除</span>
              <span class="link" :class="p.status==='已启用'?'warn':'green'" @click="toggle(p)">{{p.status==='已启用'?'停用':'启用'}}</span>
            </td>
          </tr>
          <tr v-if="!paged.length"><td colspan="15" class="empty">暂无数据</td></tr>
        </tbody>
      </table>
      </template>
      <div v-else class="row-cards">
        <div v-for="p in paged" :key="p.id" class="row-card" @click="$root.openRow(p, rowFields(p), isRegion() ? '区域合伙人详情' : '资源合伙人详情')">
          <div class="rc-title">{{p.name}}</div>
          <div class="rc-sub">{{isRegion() ? '区域合伙人' : '资源合伙人'}} · {{p.phone||'-'}}</div>
          <div class="rc-row"><span>可支付</span><b class="money">{{fmtMoney(acc(p).payable)}}</b></div>
          <div class="rc-row"><span>状态</span><span>{{p.status}}</span></div>
        </div>
        <div v-if="!paged.length" class="empty">暂无数据</div>
      </div>
      </div>
      <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

      <x-modal v-if="showForm" :title="(editing?'修改':'新增')+'${label}'" :width="560" :fullscreen="$root.isMobile" @close="showForm=false">
        <div class="form-grid">
          <div class="form-item"><label>姓名<b class="req">*</b></label><input type="text" v-model="form.name"></div>
          <div class="form-item"><label>电话</label><input type="text" v-model="form.phone"></div>
          ${isRegion ? `<div class="form-item"><label>负责区域<b class="req">*</b></label>
            <x-combobox v-model="form.regionId" :options="regionOpts" placeholder="请选择"/></div>` : ''}
          <div class="form-item full"><label>备注</label><textarea rows="2" v-model="form.remark"></textarea></div>
        </div>
        ${isRegion ? '<div class="form-hint" style="margin-top:8px">佣金比例请在「佣金管理 - 区域佣金比例」中设置。</div>'
                   : '<div class="form-hint" style="margin-top:8px">资源合伙人不固定级别，级别由客户档案中的一级/二级/三级资源槽位决定，同一人可同时担任多个级别。</div>'}
        <template #foot>
          <button class="btn" @click="showForm=false">取消</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </template>
      </x-modal>

      <x-modal v-if="detail" :title="'${label}详情 - '+detail.name" :width="860" @close="detail=null">
        <!-- 佣金总账 -->
        <div class="acc-grid">
          <div class="acc-item"><div class="t">累计应得佣金</div><div class="v money">￥{{fmtMoney(detailAcc.earned)}}</div></div>
          <div class="acc-item green"><div class="t">累计已支付</div><div class="v money">￥{{fmtMoney(detailAcc.paid)}}</div></div>
          <div class="acc-item orange"><div class="t">质押中（暂扣）</div><div class="v money">￥{{fmtMoney(detailAcc.pledge)}}</div></div>
          <div class="acc-item blue"><div class="t">当前可支付</div><div class="v money">￥{{fmtMoney(detailAcc.payable)}}</div></div>
        </div>
        <div class="form-hint">质押规则：名下每个客户的「最后一次销售单」佣金 + 所有「未支付货款销售单」佣金全额暂扣，用于防止退货 / 跑单造成佣金超额支付；货款结清且不再是最后一单后自动释放。</div>

        <div class="section-title" style="margin-top:14px">名下客户</div>
        <table class="grid">
          <thead><tr><th>客户名称</th><th>角色</th></tr></thead>
          <tbody>
            <tr v-for="r in detailRows(detail)"><td>{{r.name}}</td><td>{{r.role}}</td></tr>
            <tr v-if="!detailRows(detail).length"><td colspan="2" class="empty">暂无关联客户</td></tr>
          </tbody>
        </table>

        <div class="section-title" style="margin-top:14px">累计佣金（全部时间，按已完成销售净额计算）</div>
        <table class="grid">
          <thead><tr><th>级别</th><th class="num">销售净额</th><th class="num">比例</th><th class="num">佣金</th></tr></thead>
          <tbody>
            <tr v-for="r in detailComm(detail)"><td>{{r.level}}</td><td class="num money">{{fmtMoney(r.sales)}}</td><td class="num">{{r.rate}}%</td><td class="num money">{{fmtMoney(r.commission)}}</td></tr>
            <tr v-if="!detailComm(detail).length"><td colspan="4" class="empty">暂无佣金记录</td></tr>
          </tbody>
        </table>

        <div class="section-title" style="margin-top:14px">质押（绑定）佣金明细
          <span class="muted">共 {{detailPledge.length}} 单，合计 ￥{{fmtMoney(detailAcc.pledge)}}</span>
          <button class="btn btn-sm" style="margin-left:8px" @click="exportPledge">导出</button>
        </div>
        <div class="table-wrap" style="max-height:220px;overflow-y:auto">
        <table class="grid">
          <thead><tr><th>销售单号</th><th>客户</th><th class="num">销售净额</th><th class="num">对应佣金</th><th>质押原因</th><th>支付状态</th><th>完成时间</th></tr></thead>
          <tbody>
            <tr v-for="r in detailPledge" :key="r.saleId">
              <td>{{r.no}}</td><td>{{r.custName}}</td>
              <td class="num money">{{fmtMoney(r.net)}}</td>
              <td class="num money orange"><b>{{fmtMoney(r.commission)}}</b></td>
              <td><span class="tag tag-orange" v-for="x in r.reasons" :key="x" style="margin-right:4px">{{x}}</span></td>
              <td><x-status :v="r.payStatus"/></td><td>{{r.finishTime}}</td>
            </tr>
            <tr v-if="!detailPledge.length"><td colspan="7" class="empty">无质押佣金，全部可支付</td></tr>
          </tbody>
        </table>
        </div>

        <div class="section-title" style="margin-top:14px">佣金支付记录
          <span class="muted">累计已支付 ￥{{fmtMoney(detailAcc.paid)}}</span>
          <button class="btn btn-sm btn-primary" style="margin-left:8px" @click="openPay">+ 支付佣金</button>
        </div>
        <table class="grid">
          <thead><tr><th>序号</th><th class="num">支付金额</th><th>支付时间</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in detailPays" :key="r.id">
              <td>{{i+1}}</td><td class="num money green-t"><b>{{fmtMoney(r.amount)}}</b></td>
              <td>{{r.time}}</td><td>{{r.remark||'-'}}</td>
              <td class="ops"><span class="link danger" @click="delPay(r)">撤销</span></td>
            </tr>
            <tr v-if="!detailPays.length"><td colspan="5" class="empty">暂无支付记录</td></tr>
          </tbody>
        </table>
        <template #foot><button class="btn" @click="detail=null">关闭</button></template>
      </x-modal>

      <!-- 支付佣金 -->
      <x-modal v-if="payForm" title="支付佣金" :width="560" @close="payForm=null">
        <div class="form-grid">
          <div class="form-item full"><label>合伙人</label><div class="ro-field">{{detail.name}}（${label}）</div></div>
          <div class="form-item"><label>当前可支付</label><div class="ro-field money">￥{{fmtMoney(detailAcc.payable)}}</div></div>
          <div class="form-item"><label>质押中</label><div class="ro-field money">￥{{fmtMoney(detailAcc.pledge)}}</div></div>
          <div class="form-item full"><label>本次支付金额<b class="req">*</b></label>
            <input type="number" min="0" step="0.01" v-model.number="payForm.amount"></div>
          <div class="form-item full"><label>备注</label><input type="text" v-model="payForm.remark" placeholder="如：2026年7月佣金结算"></div>
        </div>
        <div class="form-hint">支付金额默认带出「当前可支付」，超过可支付金额时会二次确认提示超额风险。</div>
        <template #foot>
          <button class="btn" @click="payForm=null">取消</button>
          <button class="btn btn-primary" @click="savePay">确认支付</button>
        </template>
      </x-modal>
    </div>`
  };
}

Pages['page-partners'] = {
  components: {
    'resource-partner-list': partnerListFactory(false),
    'region-partner-list': partnerListFactory(true)
  },
  data() { return { tab: '资源合伙人' }; },
  template: `
  <div>
    <div class="page-title">合伙人管理</div>
    <div class="tabs">
      <div class="tab" v-for="t in ['资源合伙人','区域合伙人']" :key="t" :class="{active:tab===t}" @click="tab=t">{{t}}</div>
    </div>
    <div class="card">
      <resource-partner-list v-if="tab==='资源合伙人'"/>
      <region-partner-list v-else/>
    </div>
  </div>`
};
