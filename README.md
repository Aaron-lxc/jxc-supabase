# 进销存管理系统 · 云端版（Supabase）

一套与单机版（Electron 版）**功能完全一致**的进销存管理系统，数据层改为 **Supabase（PostgreSQL + Auth + Realtime）**，
并额外提供 **多账户 / 多账套 / 按模块授权** 的协作能力。原单机版仍保留，互不影响。

- 纯网页前端，无需后端服务器，可托管到 Vercel / Netlify / 任意静态服务器 / 内网 Nginx。
- 所有改动自动实时保存并同步给同一账套的其他成员（行级并发，多人同时开单不会互相覆盖）。
- 首次运行由使用者在界面上填写 Supabase 连接（URL + anon key），保存在本机浏览器，不依赖任何部署配置。

---

## 一、目录结构

```
jxc-supabase/
├─ index.html              # 入口（按依赖顺序加载脚本）
├─ css/style.css           # 样式
├─ vendor/                 # 本地化第三方库（可离线运行）
│  ├─ vue.global.prod.js   # Vue 3 完整构建（含模板编译器）
│  ├─ echarts.min.js       # 图表
│  ├─ xlsx.full.min.js     # Excel 导入导出
│  └─ supabase.js          # @supabase/supabase-js v2（UMD）
├─ sql/
│  └─ schema.sql           # ★ 数据库初始化脚本（必须在 Supabase 后台执行一次）
├─ js/
│  ├─ utils.js             # 通用工具 U
│  ├─ config.js            # 连接配置 CFG（本机 localStorage）
│  ├─ cloud.js             # 云端接入层 Cloud（认证 / 账套 / 成员）
│  ├─ perm.js              # 权限层 P（按模块 none/view/edit）
│  ├─ sync.js              # 同步引擎 Sync（内存 db ⇄ Supabase records 表）
│  ├─ store.js             # 数据存储 + 全部业务逻辑 S（与单机版算法一致）
│  ├─ demo-data.js         # 演示数据 Demo
│  ├─ components.js        # 通用组件（x-modal / x-pager / x-combobox 等）
│  ├─ app.js               # 应用入口 + 启动门禁（三步向导）
│  └─ pages/               # 13 个业务页 + 账户管理页（members）
└─ validate-templates.cjs  # 开发期校验脚本（模板编译 + 逻辑断言）
```

---

## 二、前置准备：初始化 Supabase 数据库

1. 在 [supabase.com](https://supabase.com) 新建一个项目（免费版即可）。
2. 进入 **SQL Editor**（SQL 编辑器）→ **New query**。
3. 打开本项目的 `sql/schema.sql`，全选复制，粘贴到编辑器，**Run** 执行一次。
4. 该脚本会创建：
   - 表：`profiles` / `workspaces` / `workspace_members` / `records` / `invites`
   - 行级安全（RLS）策略、权限判定函数、触发器、以及若干 RPC 函数
   - 开启 `records` 表的 Realtime 发布（实时同步支持）

> 仅需执行一次。后续新增成员、开单、改权限都由前端通过 RPC / RLS 自动完成，无需再动数据库。

### （可选）关闭邮箱验证，便于内网快速试用
Supabase 默认开启注册邮箱验证。若在内网/演示环境不想配置邮件：
**Authentication → Providers → Email** 取消勾选 **Confirm email**。这样注册后可直接登录。

---

## 三、获取连接信息（供首次运行填写）

在 Supabase 控制台 **Project Settings → API** 复制两项：
- **Project URL**：形如 `https://xxxx.supabase.co`
- **anon public key**：一段 `eyJ...` 的 JWT（三段式）

这两项**仅包含公开只读权限**，配合 RLS 才能读写，可安全存放在前端/浏览器。

---

## 四、部署（任选其一）

### 方式 A：静态托管（Vercel / Netlify）
1. 把整个 `jxc-supabase/` 目录作为站点根目录上传（或连接 Git 仓库）。
2. 构建命令留空，发布目录设为 `jxc-supabase`（含 `index.html` 的那一层）。
3. 部署完成后打开站点地址即可。

### 方式 B：内网 / 自有服务器（Nginx / 任意静态服务）
把 `jxc-supabase/` 目录放到 Web 根目录，例如 Nginx：
```nginx
server {
  listen 80;
  root /var/www/jxc-supabase;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
}
```
或直接用 Python 起一个静态服务做临时试用：
```bash
cd jxc-supabase && python3 -m http.server 8080
# 浏览器打开 http://<服务器IP>:8080
```

### 方式 C：GitHub Pages（免费、永久子域名，成员免填 key）

本仓库已把 Supabase 连接**预置进 `js/config.js` 的 `preset`**，并附带 `.nojekyll`，可直接托管到 GitHub Pages，成员打开即用、无需填写任何连接信息。

1. 在 GitHub 新建一个**空仓库**（如 `jxc-supabase`）。
2. 在本项目 `jxc-supabase/` 目录下初始化并提交（含 `index.html`、`.nojekyll`、`css/`、`js/`、`vendor/`、`sql/`）：
   ```bash
   cd jxc-supabase
   git init
   git add -A
   git commit -m "init jxc-supabase"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```
3. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **Deploy from a branch**，分支选 `main`、目录选 `/(root)`，保存。
4. 等待 1–2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/` 即可。
5. 之后更新代码：`git add -A && git commit -m "..." && git push`。
   - 若 `sql/schema.sql` 有改动（如新增 RPC / 策略），需同时在 Supabase 控制台 **SQL Editor** 重新执行一遍 `sql/schema.sql`（脚本全部幂等：`drop policy ... create policy`、`create or replace function`），否则前端调用的新函数不存在会报错。

> GitHub Pages 会把站点放在 `https://<用户>.github.io/<仓库>/` **子路径**下；本项目 `index.html` 全部使用相对路径，已适配，无需改动。`.nojekyll` 用于禁用 Jekyll，避免页面里的 `{{ }}` 被误当模板破坏。

> 注意：因使用了浏览器本地存储与 Supabase 登录回调，建议通过 **http(s)://** 访问，不要用 `file://` 直接打开。

---

## 五、首次运行：三步向导

打开站点后，首次使用会经历引导屏（之后凭浏览器保存的会话自动跳过）：

- **已预置连接（如 GitHub Pages 部署版）**：成员打开直接到「登录 / 注册」页，跳过连接配置。
- **未预置**：首次会先看到「连接配置」页，填写 Project URL 与 anon key → 保存并继续
  （若提示「数据库尚未初始化」，说明 `schema.sql` 还没执行，回去执行即可）。

1. **登录 / 注册**：用邮箱注册一个账号（即账套创建者），或直接登录。
2. **账套选择 / 创建**：
   - 已有账套直接点「进入」；
   - 没有就填写账套名称「创建并进入」。新建账套会自动灌入演示数据，可在「系统设置 → 载入演示数据 / 清空全部数据」中调整。

进入主界面后，左侧菜单即为你有权限的模块；数据改动会自动保存到云端并实时同步给其他成员。

---

## 六、多账户与权限模型

- **多账套**：每个账套是一套完全独立的数据与成员，可在「系统设置 → 切换 / 新建账套」中切换。
- **成员角色**：`创建者(owner)` / `管理员(admin)` / `成员(member)`。
  - owner / admin 拥有全部模块编辑权，且可见「账户管理」菜单。
  - 普通成员按下面「模块权限」逐项是 view 还是 edit。
- **按模块授权（none / view / edit）**：在「账户管理」中，对每位成员按 13 个业务模块分别设置：
  - `无权限`：菜单不显示、不能查看也不能改；
  - `仅查看`：菜单可见、可看但不可改（表单/按钮置灰）；
  - `可编辑`：可正常增删改。
  - 仪表盘、运营报表为系统只读模块，只能设为「无权限 / 仅查看」。
  - 财务、佣金、系统设置默认对普通成员关闭，可按需开放。
- **添加成员**：填写对方注册邮箱即可。
  - 对方已注册 → 立即加入；
  - 对方未注册 → 生成待接受邀请，对方用该邮箱注册后自动加入。
- **转让所有权**：仅 owner 可在「账户管理」中将创建者转让给另一名成员（不可逆）。

---

## 七、数据备份与迁移

- **备份**：「系统设置 → 备份数据（下载 JSON）」会把当前账套全部数据导出为 JSON 文件留档。
- **恢复 / 迁移**：「系统设置 → 恢复数据（上传 JSON）」会整库替换当前账套并同步到云端（其他成员同步生效）。
- 云端本身由 Supabase 负责高可用与备份，上述 JSON 主要用于跨环境迁移或本地留档。

---

## 八、与单机版（Electron）的关系

| 维度 | 单机版 `jxc-system` | 云端版 `jxc-supabase` |
|---|---|---|
| 运行形态 | 桌面 Electron 应用 | 纯网页（浏览器/静态托管） |
| 数据存储 | 本机 JSON 文件 | Supabase（PostgreSQL） |
| 多用户 | 不支持 | 多账户 / 多账套 / 实时协作 |
| 权限 | 无 | 按模块逐项授权 |
| 业务功能 | 完整 | **完全一致**（税点计入应付、下拉模糊检索、分页条数等均已保留） |

业务逻辑（`store.js` 中的采购/销售/退货/库存/佣金/质押/账期等算法）在两个版本间保持一致，仅持久化层与 ID 生成策略不同（云端版使用时间戳+随机的全局唯一 ID，并扫描现有数据取最大单号+1，以抗多人并发）。

---

## 九、常见问题

- **打开后停在「连接配置」且提示数据库未初始化**：在 Supabase 后台 SQL Editor 执行 `sql/schema.sql` 后刷新。
- **注册后无法登录，提示邮箱未验证**：去注册邮箱点验证链接；或在 Supabase 后台关闭邮箱验证（见第二节）。
- **提示「权限不足，改动未保存」**：当前账号对该模块只有查看权，联系账套管理员在「账户管理」中开放 `可编辑`。
- **改了权限后菜单没变**：权限改动会即时刷新；若仍异常，点右上角「同步」或刷新页面。
- **部署到公网安全吗**：anon key 是公开只读密钥，所有写操作都受 RLS 约束，只有登录用户且在其被授权的账套/模块内才能写入。请勿把 `service_role` key 放到前端。

### 页面异常自查

系统已做到「绝不白屏」：任何启动失败都会显示**错误屏**（含原因与「重试 / 重选账套 / 重新登录 / 重置连接配置」按钮），
任何运行期异常都会在页面底部弹出**红色错误条**。若遇到问题，请把错误屏或错误条上的文字发出来即可定位。

常见启动失败与含义：

| 提示 | 原因 | 处理 |
| --- | --- | --- |
| 数据库尚未初始化（缺少函数/表） | `sql/schema.sql` 没执行或只执行了一部分 | 到 SQL Editor 完整执行一次 |
| 数据库策略递归 | 旧策略残留 | 重新完整执行一次 `sql/schema.sql` |
| 权限不足 / RLS 拒绝 | 账号被移出账套或被停用 | 请管理员在「账户管理」中恢复 |
| 网络连接失败 | URL 填错或网络不通 | 点「重置连接配置」重填 |

> 请使用 **http/https 方式访问**（如 `python -m http.server` 或部署到 Vercel/Nginx）。
> 直接双击以 `file://` 打开可能导致本地存储与网络请求受浏览器限制。

---

## 十、开发者：自检脚本

修改代码后建议依次运行（需 Node 18+）：

```bash
# 1. 语法检查
for f in js/*.js js/pages/*.js; do node --check "$f"; done

# 2. 模板编译 + 业务逻辑断言
node validate-templates.cjs

# 3. 模板标识符扫描（防白屏回归，重要）
node scan-template-refs.cjs

# 4. 真实 DOM 启动演练（需 jsdom：npm i jsdom）
SCENE=ok      node debug-boot.cjs   # 正常：登录→账套→主界面，并逐页渲染
SCENE=nows    node debug-boot.cjs   # 新账号无账套 → 账套选择屏
SCENE=norpc   node debug-boot.cjs   # schema 未执行 → 错误屏
SCENE=rlsdeny node debug-boot.cjs   # 读数据被拒 → 错误屏
```

### ⚠️ 改模板时必须知道的一条规则

Vue 运行时编译的模板被编译为 `with (_ctx) { ... }`，配合 Vue 的
`RuntimeCompiledPublicInstanceProxyHandlers`：**任何不以 `_` 开头、且不在 JS 内置白名单里的标识符，
都会被当作组件自身属性去取，不会回退到 `window`。**

所以模板里写 `Cloud.state.xxx` 得到的是 `undefined`，渲染时抛 `TypeError`，**整页白屏**。

在模板中使用全局对象，必须二选一：

1. 已由 `app.js` 注入（推荐）：`app.config.globalProperties` 中已注入
   `Cloud / P / S / Sync / U / CFG / roleText`，可直接在任意组件模板里使用；
2. 或在该组件的 `computed` 里显式暴露，例如 `computed: { S() { return window.S; } }`。

新增其它全局对象（如某页面的模块级常量）时，务必按上述任一方式暴露，
并运行 `node scan-template-refs.cjs` 确认为 0 问题。
