# 进销存定时推送（企微 + GitHub Actions）

把佣金 / 欠款 / 库存 / 经营报表，按你定的时间表，自动推送到企业微信。全部免费。

## 一、前置：企业微信需要两个应用（不是同一个！）
1. **自建应用（用于推送）** —— 后台「应用管理 → 创建应用」，拿 `corpid / AgentId / Secret`。
   推送脚本用它的消息接口，按 userid 主动发给合伙人 / 对账人 / 库管 / 管理者。
2. **企微 AIBot（用于内部对话）** —— 仅你 + 内部成员可用，合伙人**不**放进可见范围。
   （你已完成 AIBot；推送还需上面的自建应用。）

> 合伙人只在「通讯录」里（用于收推送），**不**进 AIBot 可见范围，彻底隔离。

## 二、填配置（本项目内）
1. `cp config.example.json config.json` → 填：
   - `supabaseUrl` / `supabaseServiceKey`（Service Role Key，**仅服务端用**）/ `workspaceId`（Supabase `workspaces` 表的 id）
   - `wecom.corpid` / `agentSecret`（自建应用 Secret）/ `agentid`
   - `detailBaseUrl`：`https://<你的github用户名>.github.io/jxc-supabase/detail.html`
   - `detailSecret`：一段长随机串（`openssl rand -hex 32`）
2. `cp recipients.example.json recipients.json` → 填接收人：
   - `collectors` / `stockManagers` / `managers`：企微 userid 数组
   - `resourcePartners` / `regionPartners`：**键 = 合伙人档案里的姓名（完全一致）**，值 = 企微 userid

## 三、部署定时任务（GitHub Actions）
仓库 **Settings → Secrets → Actions** 增加：
`SUPABASE_URL` `SUPABASE_SERVICE_KEY` `WORKSPACE_ID` `WECOM_CORPID` `WECOM_AGENT_SECRET` `WECOM_AGENTID` `DETAIL_BASE_URL` `DETAIL_SECRET` `RECIPIENTS_JSON`（完整 recipients.json 内容）
推送代码即自动按 cron 运行（时间已按北京时间换算为 UTC）。

## 四、启用「查看明细」链接（可选但推荐）
1. 部署 Edge Function：
   ```
   supabase functions deploy report-detail --no-verify-jwt
   ```
2. 在 Supabase 项目环境变量设置 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE` / `DETAIL_SECRET`（与上面同一串）。
3. `detail.html` 里的 `EDGE_URL` 已指向本项目 Supabase，无需改（部署后生效）。

## 五、本地自测
```
node run.js resource --dry     # 只看计算出的消息，不真发
node run.js arrears --dry
node run.js stock --dry
node run.js weekly --dry
node run.js monthly --dry
```
去掉 `--dry` 即真实发送。

## 六、时间表（北京时间）
- 每月 1 号 09:00 → 资源 / 区域合伙人月佣金
- 每天 08:00 → 欠款预警（对账人）+ 库存预警（库管）
- 每周六 15:00 → 本周经营（管理者）
- 每月 1 号 15:00 → 上月经营（管理者）

## 文件说明
- `compute-core.js` —— 佣金/欠款/库存/经营算法（Node 与浏览器共用，口径对齐 `js/store.js`）
- `wecom.js` —— 企微自建应用消息发送
- `run.js` —— 主脚本，按报表类型计算并推送
- `config.example.json` / `recipients.example.json` —— 配置模板
- `../../.github/workflows/reports.yml` —— 定时触发
- `../../detail.html` —— 只读明细页（手机打开，点报表里的「查看明细」）
- `../../supabase/functions/report-detail/index.ts` —— 明细取数（token 校验 + 按合伙人裁剪）
