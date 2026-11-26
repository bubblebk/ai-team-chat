/* sync.js — 선택적 동기화 클라이언트 (Cloudflare Workers + D1 대비)
 *
 * 계약(권장):
 *   GET  {server}/api/rooms/{roomKey}/messages?since={ISO8601}
 *        → 200 {"messages":[ {id, room_id, author_type, author_id, author_name, role, text, tag, ts, created_at} ]}
 *   POST {server}/api/rooms/{roomKey}/messages
 *        body {"room":{"id":"...","title":"..."}, "messages":[ ... ]}
 *        → 200 {"ok":true}
 *   서버는 id를 기본키로 upsert(중복 무시)하면 된다. roomKey가 방 접근 키 역할을 한다.
 *
 * 설정의 동기화 URL·방 키가 비어 있으면 아무 요청도 보내지 않는다(완전 로컬).
 */
(function () {
  'use strict';
  const AIC = (window.AIC = window.AIC || {});
  const store = AIC.store;
  const U = AIC.util;

  const state = { lastError: null, lastSyncAt: null, warned: false, syncedIds: new Set() };

  function normalize(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  function cfg(opt) {
    if (opt) {
      return { url: normalize(opt.url), roomKey: String(opt.roomKey || '').trim() };
    }
    const s = (store.state.settings && store.state.settings.sync) || {};
    return { url: normalize(s.url), roomKey: String(s.roomKey || '').trim() };
  }

  function enabled(opt) {
    const c = cfg(opt);
    return !!(c.url && c.roomKey);
  }

  function endpoint(c) {
    return c.url + '/api/rooms/' + encodeURIComponent(c.roomKey) + '/messages';
  }

  function serialize(msg, room) {
    return {
      id: msg.id,
      room_id: room.id,
      author_type: msg.authorType,
      author_id: msg.agentId || null,
      author_name: msg.authorName || '',
      role: msg.role || '',
      text: msg.text,
      tag: msg.tag || null,
      ts: msg.ts,
      created_at: msg.createdAt || new Date(msg.ts).toISOString()
    };
  }

  async function request(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, Object.assign({ signal: controller.signal }, options || {}));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json().catch(() => ({}));
    } finally {
      clearTimeout(timer);
    }
  }

  function warnOnce(message) {
    state.lastError = message;
    if (state.warned) return;
    state.warned = true;
    U.toast('동기화 실패: ' + message + ' (로컬 저장은 계속됩니다)', 'err', 3600);
  }

  /** 로컬에서 새 메시지가 생기면 best-effort로 올린다 */
  function onLocalMessage(room, msg) {
    if (!enabled() || !msg || msg.authorType === 'system') return;
    if (state.syncedIds.has(msg.id)) return;
    const c = cfg();
    request(endpoint(c), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: { id: room.id, title: room.title }, messages: [serialize(msg, room)] })
    }).then(() => {
      state.syncedIds.add(msg.id);
      state.lastSyncAt = Date.now();
      state.lastError = null;
    }).catch((err) => {
      warnOnce(err && err.message ? err.message : '연결 오류');
    });
  }

  async function pull(room, opt) {
    const c = cfg(opt);
    if (!c.url || !c.roomKey) throw new Error('동기화 URL과 방 키를 먼저 입력해 주세요.');
    const since = room.messages.length
      ? new Date(Math.max.apply(null, room.messages.map((m) => m.ts))).toISOString()
      : '1970-01-01T00:00:00.000Z';
    const data = await request(endpoint(c) + '?since=' + encodeURIComponent(since));
    const incoming = Array.isArray(data.messages) ? data.messages : [];
    const existing = new Set(room.messages.map((m) => m.id));
    let added = 0;
    incoming.forEach((m) => {
      if (!m || !m.id || existing.has(m.id)) return;
      const ts = Number(m.ts) || Date.parse(m.created_at) || Date.now();
      room.messages.push({
        schema: 1,
        id: m.id,
        roomId: room.id,
        authorType: m.author_type || 'agent',
        agentId: m.author_id || null,
        authorId: m.author_id || null,
        authorName: m.author_name || '',
        role: m.role || '',
        authorEmoji: m.author_emoji || '',
        authorColor: m.author_color || '',
        text: m.text || '',
        tag: m.tag || null,
        ts,
        createdAt: m.created_at || new Date(ts).toISOString(),
        synced: true
      });
      existing.add(m.id);
      added += 1;
    });
    room.messages.sort((a, b) => a.ts - b.ts);
    store.saveRooms();
    state.lastSyncAt = Date.now();
    state.lastError = null;
    return { added, total: incoming.length };
  }

  async function pushAll(room, opt) {
    const c = cfg(opt);
    if (!c.url || !c.roomKey) throw new Error('동기화 URL과 방 키를 먼저 입력해 주세요.');
    const messages = room.messages.filter((m) => m.authorType !== 'system').map((m) => serialize(m, room));
    if (!messages.length) return { pushed: 0 };
    await request(endpoint(c), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: { id: room.id, title: room.title }, messages })
    });
    messages.forEach((m) => state.syncedIds.add(m.id));
    state.lastSyncAt = Date.now();
    state.lastError = null;
    return { pushed: messages.length };
  }

  async function test(opt) {
    const c = cfg(opt);
    if (!c.url || !c.roomKey) throw new Error('동기화 URL과 방 키를 모두 입력해 주세요.');
    const data = await request(endpoint(c));
    return { count: Array.isArray(data.messages) ? data.messages.length : 0 };
  }

  async function syncNow(room, opt) {
    const pulled = await pull(room, opt);
    const pushed = await pushAll(room, opt);
    return { added: pulled.added, pushed: pushed.pushed };
  }

  AIC.sync = { enabled, cfg, onLocalMessage, pull, pushAll, test, syncNow, state };
})();
