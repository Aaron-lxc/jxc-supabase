/* 演示数据构建器：所有日期相对当前时间生成，保证仪表盘/报表有数据可看 */
window.Demo = {
  build() {
    let _id = 1;
    const id = () => _id++;
    const seq = {};
    const no = (prefix, dateStr) => {
      const ymd = dateStr.slice(0, 10).replace(/-/g, '');
      const key = prefix + ymd;
      seq[key] = (seq[key] || 0) + 1;
      return `${prefix}-${ymd}-${U.pad(seq[key], 5)}`;
    };
    const code = (prefix) => {
      seq[prefix] = (seq[prefix] || 0) + 1;
      return `${prefix}-${U.pad(seq[prefix], 4)}`;
    };
    const ago = (days, h) => { /* days 天前，返回 YYYY-MM-DD HH:mm:ss */
      const d = new Date();
      d.setDate(d.getDate() - days);
      d.setHours(h == null ? 10 : h, Math.floor(Math.random() * 50) + 5, 30, 0);
      return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())} ${U.pad(d.getHours())}:${U.pad(d.getMinutes())}:${U.pad(d.getSeconds())}`;
    };
    const later = (days) => U.addDays(U.today(), days);
    const EN = '已启用';

    const db = S.emptyDB ? S.emptyDB() : {};
    db.meta = { id: 1, seq };
    /* 继承自 emptyDB 的 settings 默认值（含 feeRates / opened 等嵌套字段），仅覆盖公司名 */
    db.settings.company = '清泉贸易有限公司';

    /* ---- 字典 ---- */
    const mk = (arr, days) => arr.map((name, i) => ({ id: id(), name, createTime: ago(days - i * 2), status: EN }));
    db.goodsTypes = mk(['净水设备', '滤芯耗材', '饮水机'], 90);
    db.units = mk(['台', '支', '箱'], 90);
    db.suppliers = [
      { name: '深圳康泉科技', address: '深圳市南山区科技园南区', contactBiz: '王经理/13911110001', contactBizWechat: 'wjsz001', contactFin: '李会计/13911110002', contactFinWechat: 'kj_lina', payCycle: '货到付款', payMethod: '对公', taxPoint: 13 },
      { name: '广州蓝海水处理', address: '广州市天河区科韵路', contactBiz: '陈主管/13922220001', contactBizWechat: 'lhsj_c', contactFin: '财务-黄/13922220002', contactFinWechat: '', payCycle: '现结', payMethod: '收款码', taxPoint: 9 },
      { name: '佛山净源设备', address: '佛山市顺德区容桂', contactBiz: '梁先生/13933330001', contactBizWechat: '', contactFin: '财务部/13933330002', contactFinWechat: 'jy_fin', payCycle: '货到付款', payMethod: '银行卡', taxPoint: 11 }
    ].map((s, i) => ({ id: id(), ...s, createTime: ago(88 - i * 2), status: EN }));
    db.custLevels = mk(['A级', 'B级', 'C级'], 86);
    /* 赋值客户级别「平均月采购金额范围」示意区间：A[10000,∞) / B[5000,10000) / C[0,5000) */
    db.custLevels.forEach((lv, i) => {
      if (i === 0) { lv.minAmount = 10000; lv.maxAmount = null; }
      else if (i === 1) { lv.minAmount = 5000; lv.maxAmount = 10000; }
      else { lv.minAmount = 0; lv.maxAmount = 5000; }
    });
    db.custTypes = mk(['经销商', '连锁商超', '直营门店'], 86);
    db.regions = mk(['华南区', '华东区', '华北区', '西南区'], 85);
    db.complaintTypes = mk(['产品投诉', '设备投诉', '服务投诉', '物流投诉'], 80);
    db.expenseCats = mk(['房租物业', '工资社保', '水电网络', '差旅招待'], 80);
    const GT = db.goodsTypes, UN = db.units, SP = db.suppliers;
    const LV = db.custLevels, CT = db.custTypes, RG = db.regions;

    /* ---- 商品 ---- */
    const G = [
      ['家用净水器A1', 0, 'JSA1-500G', 0, 0, 750, 1299, 1150, 999, 10],
      ['商用净水器B2', 0, 'JSB2-800G', 0, 1, 2400, 3999, 3600, 3200, 5],
      ['PP棉滤芯10寸', 1, 'PP-10', 1, 0, 8, 25, 20, 15, 400],
      ['RO反渗透膜', 1, 'RO-75G', 1, 1, 65, 168, 140, 120, 50],
      ['立式饮水机C3', 2, 'YSC3-L', 0, 2, 420, 799, 720, 650, 25],
      ['管线机D5', 2, 'GXD5-W', 0, 2, 560, 1099, 980, 880, 8]
    ].map((g, i) => ({
      id: id(), code: code('GD'), name: g[0], typeId: GT[g[1]].id, sku: g[2],
      unitId: UN[g[3]].id, supplierId: SP[g[4]].id,
      purchasePrice: g[5], retailPrice: g[6], bigPrice: g[7], wholePrice: g[8],
      minStock: g[9], createTime: ago(75 - i * 3), status: EN
    }));
    db.goods = G;

    /* ---- 合伙人 ---- */
    db.resourcePartners = [
      ['张伟', '13800001111'], ['李娜', '13800002222'], ['王强', '13800003333'], ['赵敏', '13800004444']
    ].map((p, i) => ({ id: id(), name: p[0], phone: p[1], remark: '', createTime: ago(70 - i * 8), status: EN }));
    db.regionPartners = [
      ['陈国华', '13900001111', 0], ['刘芳', '13900002222', 1], ['周建军', '13900003333', 2]
    ].map((p, i) => ({ id: id(), name: p[0], phone: p[1], regionId: RG[p[2]].id, remark: '', createTime: ago(68 - i * 10), status: EN }));
    const RP = db.resourcePartners, GP = db.regionPartners;

    /* ---- 佣金比例 ---- */
    db.resourceRates = [1, 2, 3].map((L, i) => ({ id: id(), level: L, rate: [5, 3, 1][i], createTime: ago(65), status: EN }));
    db.regionRates = [
      { id: id(), partnerId: GP[0].id, rate: 2, createTime: ago(65), status: EN },
      { id: id(), partnerId: GP[1].id, rate: 2, createTime: ago(65), status: EN },
      { id: id(), partnerId: GP[2].id, rate: 1.5, createTime: ago(65), status: EN }
    ];

    /* ---- 仓库 ---- */
    db.warehouses = [
      { id: id(), name: '广州白云仓', address: '广州市白云区机场路88号', manager: '黄志明', phone: '13711112222', rent: 8000, expireDate: later(210), landlord: '罗先生/13600001111', createTime: ago(66), status: EN },
      { id: id(), name: '上海嘉定仓', address: '上海市嘉定区宝安公路100号', manager: '孙丽', phone: '13733334444', rent: 12000, expireDate: later(38), landlord: '钱女士/13600002222', createTime: ago(60), status: EN }
    ];
    const W = db.warehouses;

    /* ---- 客户 ---- */
    const custDef = [
      /* name, region, type, level, payMethod, payCycle, payDay, r1,r2,r3, gp, daysAgo, remark */
      ['广州百汇商贸', 0, 0, 0, '对公', '次月结', 10, 0, 1, 2, 0, 58, '大客户，优先发货'],
      ['深圳鑫源水业', 0, 0, 1, '银行卡', '当月结', 25, 0, 2, null, 0, 52, ''],
      ['佛山家和超市', 0, 1, 1, '微信', '现结', null, 1, null, null, 0, 46, '每周五集中报货'],
      ['上海清源商行', 1, 0, 0, '对公', '次月结', 15, 1, 0, 3, 1, 44, '发货前需电话确认'],
      ['杭州净活馆', 1, 2, 2, '收款码', '现结', null, 2, null, null, 1, 36, ''],
      ['苏州万家乐超市', 1, 1, 1, '对公', '当月结', 28, 2, 3, null, 1, 30, ''],
      ['北京京福水站', 2, 0, 1, '银行卡', '次月结', 5, 3, 0, null, 2, 24, '冬季需防冻包装'],
      ['成都锦水商贸', 3, 0, 2, '微信', '当月结', 20, 3, 1, 0, null, 12, '']
    ];
    db.customers = custDef.map((c, i) => ({
      id: id(), code: code('CU'), name: c[0],
      regionId: RG[c[1]].id, typeId: CT[c[2]].id, levelId: LV[c[3]].id,
      contactRes: '资源联系人/1380000' + c[11], contactOrder: '报货联系人/1390000' + c[11],
      contactPay: '结算联系人/1370000' + c[11], contactOther: '',
      address: c[0] + '所在地详细地址',
      payMethod: c[4], payCycle: c[5], payDay: c[6],
      r1: c[7] == null ? null : RP[c[7]].id, r2: c[8] == null ? null : RP[c[8]].id, r3: c[9] == null ? null : RP[c[9]].id,
      regionPartnerId: c[10] == null ? null : GP[c[10]].id,
      remark: c[12],
      bankCard: '6222****' + (c[11] + 1000) + '（工行）',
      corpAccount: '对公 7559****' + (c[11] + 100),
      invoiceInfo: '抬头：' + c[0] + '｜税号：9144****' + (c[11] + 10),
      taxRate: [3, 6, 0, 4, 0, 5, 0, 2][i] || 0,
      taxExempt: ['否', '否', '是', '否', '是', '否', '否', '否'][i] || '否',
      createTime: ago(c[11]), status: EN
    }));
    const C = db.customers;

    /* ---- 采购（自动累加库存） ---- */
    const stocks = {};
    const stockKey = (w, g) => w + '_' + g;
    const purDef = [ /* goodsIdx, whIdx, qty, daysAgo */
      [0, 0, 60, 55], [0, 1, 30, 50], [1, 0, 20, 48],
      [2, 0, 1400, 45], [2, 1, 500, 42], [3, 0, 300, 40],
      [4, 1, 30, 35], [5, 0, 25, 30], [5, 1, 10, 18], [3, 0, 0, 0]
    ].filter(p => p[2] > 0);
    db.purchases = purDef.map(p => {
      const g = G[p[0]], t = ago(p[3], 9);
      const k = stockKey(W[p[1]].id, g.id);
      stocks[k] = stocks[k] || { whId: W[p[1]].id, goodsId: g.id, qty: 0, lastInTime: '', lastCheckTime: '' };
      stocks[k].qty += p[2];
      if (t > stocks[k].lastInTime) stocks[k].lastInTime = t;
      return {
        id: id(), no: no('PO', t), typeId: g.typeId, goodsId: g.id, supplierId: g.supplierId,
        unitId: g.unitId, qty: p[2], price: g.purchasePrice,
        amount: U.round2(p[2] * g.purchasePrice), whId: W[p[1]].id, inTime: t
      };
    });

    /* ---- 销售（已完成的扣库存） ---- */
    const PT = { r: '零售价', b: '大客价', w: '批发价' };
    const PF = { r: 'retailPrice', b: 'bigPrice', w: 'wholePrice' };
    const saleDef = [ /* daysAgo, custIdx, whIdx, items:[goodsIdx,qty,pt], done, paid */
      [42, 0, 0, [[0, 10, 'b'], [2, 400, 'w']], 1, 1],
      [40, 3, 1, [[0, 8, 'b']], 1, 0],            /* 次月结15号 → 已超期未支付 */
      [38, 1, 0, [[1, 3, 'b'], [3, 80, 'w']], 1, 1],
      [35, 2, 0, [[2, 350, 'r']], 1, 1],
      [32, 4, 1, [[2, 300, 'r']], 1, 1],
      [30, 0, 0, [[0, 12, 'b'], [5, 5, 'b']], 1, 1],
      [28, 5, 1, [[4, 6, 'w']], 1, 0],            /* 当月结28号 → 超期未支付 */
      [26, 6, 0, [[1, 2, 'w'], [3, 60, 'w']], 1, 1],
      [24, 3, 1, [[0, 6, 'b'], [4, 4, 'w']], 1, 0],
      [21, 7, 0, [[2, 300, 'w']], 1, 1],
      [18, 1, 0, [[0, 5, 'b'], [5, 3, 'b']], 1, 1],
      [15, 2, 0, [[2, 200, 'r']], 1, 1],
      [12, 5, 1, [[5, 2, 'b']], 1, 0],
      [10, 0, 0, [[1, 4, 'b']], 1, 0],
      [7, 6, 0, [[3, 0, 'w']], 0, 0],
      [6, 4, 1, [[2, 0, 'r']], 0, 0],
      [3, 7, 0, [[0, 0, 'w']], 0, 0]
    ];
    /* 未完成单的数量补上（不扣库存） */
    saleDef[14][3] = [[3, 40, 'w']];
    saleDef[15][3] = [[2, 100, 'r']];
    saleDef[16][3] = [[0, 6, 'w']];

    db.sales = saleDef.map(sd => {
      const cust = C[sd[1]], wh = W[sd[2]], t = ago(sd[0], 14);
      let total = 0;
      const items = sd[3].map(it => {
        const g = G[it[0]];
        const price = g[PF[it[2]]];
        const amt = U.round2(it[1] * price);
        total += amt;
        return { goodsId: g.id, sku: g.sku, qty: it[1], unitId: g.unitId, priceType: PT[it[2]], price, amount: amt };
      });
      const done = sd[4] === 1;
      if (done) items.forEach(it => { stocks[stockKey(wh.id, it.goodsId)].qty -= it.qty; });
      return {
        id: id(), no: no('SO', t), customerId: cust.id, whId: wh.id, items,
        total: U.round2(total), custRemark: cust.remark,
        taxRate: cust.taxRate, taxExempt: cust.taxExempt,
        status: done ? '已完成' : '未完成', payStatus: done ? (sd[5] ? '已支付' : '未支付') : '',
        payTime: done && sd[5] ? ago(sd[0] - 1, 16) : '',
        createTime: t, finishTime: done ? ago(sd[0], 15) : ''
      };
    });

    /* ---- 退货（回补库存） ---- */
    const mkReturn = (saleIdx, itemIdx, qty, daysAgo) => {
      const s = db.sales[saleIdx];
      const it = s.items[itemIdx];
      const t = ago(daysAgo, 16);
      stocks[stockKey(s.whId, it.goodsId)].qty += qty;
      return {
        id: id(), no: no('RT', t), saleId: s.id, saleNo: s.no, customerId: s.customerId, whId: s.whId,
        items: [{ itemIdx, goodsId: it.goodsId, qty, price: it.price, amount: U.round2(qty * it.price) }],
        total: U.round2(qty * it.price), createTime: t
      };
    };
    db.returns = [mkReturn(5, 0, 2, 28), mkReturn(11, 0, 30, 13)];

    db.stocks = Object.values(stocks).map(s => ({ id: id(), ...s }));

    /* ---- 财务 ---- */
    const EC = db.expenseCats;
    db.expenses = [
      [0, 6000, '7月办公室租金', 32, 1], [1, 32000, '7月工资社保', 28, 1],
      [2, 1850, '7月水电网络费', 26, 1], [3, 3200, '华东客户拜访差旅', 20, 1],
      [0, 6000, '8月办公室租金', 4, 0], [3, 1500, '新客户招待费', 2, 0]
    ].map(x => ({
      id: id(), catId: EC[x[0]].id, amount: x[1], desc: x[2],
      createTime: ago(x[3], 11), status: x[4] ? '已计算' : '未计算'
    }));

    /* ---- 投诉 ---- */
    const CPT = db.complaintTypes;
    const cmpDef = [ /* typeIdx, custIdx, desc, daysAgo, done */
      [0, 0, '一台净水器A1出水浑浊，要求换货', 25, 1],
      [3, 3, '物流破损，外包装挤压变形', 18, 1],
      [1, 6, '商用净水器B2噪音偏大', 12, 0],
      [2, 4, '售后响应慢，两天未回复', 8, 0],
      [3, 0, '发货延迟三天，影响门店销售', 5, 1]
    ];
    db.complaints = cmpDef.map(x => {
      const cust = C[x[1]], t = ago(x[3], 15);
      return {
        id: id(), no: no('CO', t), typeId: CPT[x[0]].id, customerId: cust.id,
        regionPartnerId: cust.regionPartnerId, r1: cust.r1, r2: cust.r2, r3: cust.r3,
        desc: x[2], time: t, status: x[4] ? '已处理' : '未处理', createTime: t
      };
    });

    db.stockChecks = [];
    db.commissionPayments = [
      { id: id(), partnerId: RP[0].id, type: '资源', amount: 1200, time: ago(22, 14), remark: '7月佣金首付款' },
      { id: id(), partnerId: RP[0].id, type: '资源', amount: 800, time: ago(8, 14), remark: '7月佣金尾款' },
      { id: id(), partnerId: GP[1].id, type: '区域', amount: 600, time: ago(15, 14), remark: '区域佣金6月' }
    ];
    db.meta.id = _id;
    return db;
  }
};
