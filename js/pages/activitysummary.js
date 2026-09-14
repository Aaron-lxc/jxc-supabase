/* 活动运营情况汇总：运营报表下的只读子页面
   三张汇总表：商家推荐（按客户）/ 个人推荐（按推荐人）/ 个人推广（按推广人+商品）
   仅统计有效记录；金额/数量按从大到小排序；每表含合计行。 */
if (!window.Pages) window.Pages = {};

window.Pages['page-activitysummary'] = {
  data() { return {}; },
  computed: {
    S() { return window.S; },

    /* ① 商家推荐汇总：按客户名称分组 */
    merchantRows() {
      const S = window.S, acc = {};
      (S.db.merchantRefs || []).forEach(r => {
        if (r.status !== '已预存' && r.status !== '已发放') return; // 仅有效记录
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
      })).sort((a, b) => b.reward - a.reward); // 按累计实际奖励从大到小
    },
    merchantTotal() {
      return {
        custCount: this.merchantRows.reduce((a, r) => a + r.custCount, 0),
        reward: U.round2(this.merchantRows.reduce((a, r) => a + r.reward, 0))
      };
    },

    /* ② 个人推荐汇总：按推荐人分组 */
    personRefRows() {
      const S = window.S, acc = {};
      (S.db.personRefs || []).forEach(r => {
        if (r.status !== '已发放') return; // 仅已发放
        const key = (r.recommender || '').trim();
        if (!acc[key]) acc[key] = { name: key, custSet: {}, reward: 0 };
        if (r.refCustomerId) acc[key].custSet[r.refCustomerId] = 1;
        acc[key].reward += Number(r.paidAmount || 0);
      });
      return Object.values(acc).map(x => ({
        name: x.name,
        custCount: Object.keys(x.custSet).length,
        reward: U.round2(x.reward)
      })).sort((a, b) => b.reward - a.reward); // 按累计奖励从大到小
    },
    personRefTotal() {
      return {
        custCount: this.personRefRows.reduce((a, r) => a + r.custCount, 0),
        reward: U.round2(this.personRefRows.reduce((a, r) => a + r.reward, 0))
      };
    },

    /* ③ 个人推广汇总：按推广人 + 奖励商品分组 */
    personPromoRows() {
      const S = window.S, acc = {};
      (S.db.personPromos || []).forEach(r => {
        if (r.status !== '已发放') return; // 仅已发放
        const key = (r.promoter || '').trim() + '|' + r.goodsId;
        const g = S.byId('goods', r.goodsId);
        const goodsName = g ? (g.sku ? g.name + '（' + g.sku + '）' : g.name) : '';
        if (!acc[key]) acc[key] = { promoter: (r.promoter || '').trim(), goods: goodsName, qty: 0 };
        acc[key].qty += Number(r.qty || 0);
      });
      return Object.values(acc).map(x => ({
        promoter: x.promoter, goods: x.goods, qty: U.round2(x.qty)
      })).sort((a, b) => b.qty - a.qty); // 按累计奖励数量从大到小
    },
    personPromoTotal() {
      return { qty: U.round2(this.personPromoRows.reduce((a, r) => a + r.qty, 0)) };
    }
  },
  template: `
  <div>
    <div class="page-title">活动运营情况汇总</div>

    <div class="card">
      <div class="card-title">商家推荐汇总（按客户）</div>
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>客户名称</th><th>累计推荐客户数量</th><th>累计实际奖励</th>
        </tr></thead>
        <tbody>
          <tr v-for="(r,i) in merchantRows" :key="r.name">
            <td>{{ i + 1 }}</td>
            <td>{{ r.name }}</td>
            <td>{{ r.custCount }}</td>
            <td>￥{{ U.fmtMoney(r.reward) }}</td>
          </tr>
          <tr v-if="!merchantRows.length"><td colspan="4" class="empty">暂无数据</td></tr>
          <tr v-if="merchantRows.length" style="background:#eff6ff;font-weight:700">
            <td colspan="2">合计</td>
            <td>{{ merchantTotal.custCount }}</td>
            <td>￥{{ U.fmtMoney(merchantTotal.reward) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-title">个人推荐汇总（按推荐人）</div>
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>推荐人</th><th>累计推荐客户数量</th><th>累计奖励</th>
        </tr></thead>
        <tbody>
          <tr v-for="(r,i) in personRefRows" :key="r.name">
            <td>{{ i + 1 }}</td>
            <td>{{ r.name }}</td>
            <td>{{ r.custCount }}</td>
            <td>￥{{ U.fmtMoney(r.reward) }}</td>
          </tr>
          <tr v-if="!personRefRows.length"><td colspan="4" class="empty">暂无数据</td></tr>
          <tr v-if="personRefRows.length" style="background:#eff6ff;font-weight:700">
            <td colspan="2">合计</td>
            <td>{{ personRefTotal.custCount }}</td>
            <td>￥{{ U.fmtMoney(personRefTotal.reward) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-title">个人推广汇总（按推广人 + 奖励商品）</div>
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>推广人</th><th>奖励商品</th><th>累计奖励数量</th>
        </tr></thead>
        <tbody>
          <tr v-for="(r,i) in personPromoRows" :key="r.promoter + r.goods">
            <td>{{ i + 1 }}</td>
            <td>{{ r.promoter }}</td>
            <td>{{ r.goods }}</td>
            <td>{{ r.qty }}</td>
          </tr>
          <tr v-if="!personPromoRows.length"><td colspan="4" class="empty">暂无数据</td></tr>
          <tr v-if="personPromoRows.length" style="background:#eff6ff;font-weight:700">
            <td colspan="3">合计</td>
            <td>{{ personPromoTotal.qty }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`
};
