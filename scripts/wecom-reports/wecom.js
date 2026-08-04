/* ============================================================================
 * wecom.js — 企业微信「自建应用」消息推送（Node）
 *
 * 与「企微 AIBot（对话机器人）」是两回事：
 *   - 这里是**自建应用**的消息接口，可主动按 userid 给指定成员推送消息；
 *   - AIBot 是对话入口（仅内部使用，合伙人不可见）。
 *
 * 凭证：corpid + 自建应用 Secret（agent secret）→ 换 access_token → 发送。
 * 依赖：Node 18+ 内置 fetch，无需额外安装包。
 * ========================================================================== */
'use strict';
const API = 'https://qyapi.weixin.qq.com/cgi-bin';

async function getToken(corpid, corpsecret) {
  const u = `${API}/gettoken?corpid=${encodeURIComponent(corpid)}&corpsecret=${encodeURIComponent(corpsecret)}`;
  const r = await fetch(u);
  const j = await r.json();
  if (j.errcode) throw new Error('获取企微 access_token 失败：' + JSON.stringify(j));
  return j.access_token;
}

/**
 * 发送 markdown 消息给指定成员（多个用 '|' 分隔 userid）。
 * @returns {Promise<object>} 企微返回
 */
async function sendMarkdown(corpid, corpsecret, agentid, touser, content) {
  const token = await getToken(corpid, corpsecret);
  const u = `${API}/message/send?access_token=${token}`;
  const body = {
    touser,
    msgtype: 'markdown',
    agentid: Number(agentid),
    markdown: { content }
  };
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (j.errcode) throw new Error('企微发送失败：' + JSON.stringify(j));
  return j;
}

/**
 * 发送「图文（news）」消息（带点击跳转链接），适合放「查看明细」按钮。
 */
async function sendNews(corpid, corpsecret, agentid, touser, articles) {
  const token = await getToken(corpid, corpsecret);
  const u = `${API}/message/send?access_token=${token}`;
  const body = {
    touser,
    msgtype: 'news',
    agentid: Number(agentid),
    news: { articles: articles.slice(0, 8) }
  };
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (j.errcode) throw new Error('企微发送失败：' + JSON.stringify(j));
  return j;
}

module.exports = { getToken, sendMarkdown, sendNews };
