/* llm.js — Gemini / OpenAI / Anthropic 호출 (브라우저 직접) */
(function () {
  'use strict';
  const AIC = (window.AIC = window.AIC || {});
  const U = AIC.util;

  const DEFAULT_MODELS = {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-haiku-latest'
  };

  const LABEL = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude' };

  function keyFor(provider, settings) {
    return (settings.keys && settings.keys[provider]) || '';
  }

  /** 에이전트가 실제로 쓸 프로바이더/모델/키 결정 */
  function resolve(agent, settings) {
    const m = (agent && agent.model) || {};
    const custom = m.mode === 'custom';
    const provider = custom ? (m.provider || settings.shared.provider) : settings.shared.provider;
    const model = (custom ? m.model : '') || settings.shared.model || DEFAULT_MODELS[provider];
    const ownKey = custom ? (m.apiKey || '') : '';
    return {
      provider,
      model: model || DEFAULT_MODELS[provider],
      apiKey: ownKey || keyFor(provider, settings),
      hasOwnKey: !!ownKey,
      label: LABEL[provider] || provider
    };
  }

  function timeoutSignal(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms || 60000);
    return { signal: controller.signal, done: () => clearTimeout(timer), controller };
  }

  function friendlyError(err, provider, status) {
    const base = LABEL[provider] || provider;
    const msg = (err && err.message) ? err.message : String(err);
    if (status === 401 || status === 403) return base + ' API 키가 거부되었어요. 키와 사용 권한을 확인해 주세요.';
    if (status === 429) return base + ' 사용 한도(무료 쿼터)에 걸렸어요. 잠시 후 다시 시도하거나 다른 모델/키를 쓰세요.';
    if (status === 404) return base + ' 모델 이름을 찾지 못했어요. 설정의 모델명을 확인해 주세요.';
    if (status === 400) return base + ' 요청이 거부되었어요: ' + msg.slice(0, 180);
    if (/abort/i.test(msg)) return base + ' 응답이 너무 오래 걸려 중단했어요(60초).';
    if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
      return base + ' 연결에 실패했어요. 인터넷 연결과 브라우저의 CORS 차단 여부를 확인해 주세요.';
    }
    return base + ' 오류: ' + msg.slice(0, 200);
  }

  function mergeRoles(msgs) {
    const out = [];
    msgs.forEach((m) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const last = out[out.length - 1];
      if (last && last.role === role) last.content += '\n\n' + m.content;
      else out.push({ role, content: m.content });
    });
    return out;
  }

  async function callGemini(opts) {
    const key = opts.apiKey;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(opts.model) + ':generateContent?key=' + encodeURIComponent(key);
    const contents = mergeRoles(opts.messages).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const body = {
      contents,
      generationConfig: {
        temperature: opts.temperature == null ? 0.7 : opts.temperature,
        maxOutputTokens: opts.maxTokens || 2048
      }
    };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
    if (opts.json) body.generationConfig.responseMimeType = 'application/json';

    const t = timeoutSignal(opts.timeout);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: t.signal
      });
    } finally { t.done(); }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (data && data.error && data.error.message) || res.statusText;
      const e = new Error(detail);
      e.status = res.status;
      throw e;
    }
    const cand = (data.candidates || [])[0];
    if (!cand) {
      const blocked = data.promptFeedback && data.promptFeedback.blockReason;
      throw new Error(blocked ? '안전 정책으로 응답이 차단되었어요(' + blocked + ').' : '빈 응답을 받았어요.');
    }
    const parts = (cand.content && cand.content.parts) || [];
    return parts.map((p) => p.text || '').join('').trim();
  }

  async function callOpenAI(opts) {
    const messages = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    opts.messages.forEach((m) => messages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));
    const body = {
      model: opts.model,
      messages,
      temperature: opts.temperature == null ? 0.7 : opts.temperature,
      max_tokens: opts.maxTokens || 2048
    };
    if (opts.json) body.response_format = { type: 'json_object' };

    const t = timeoutSignal(opts.timeout);
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + opts.apiKey
        },
        body: JSON.stringify(body),
        signal: t.signal
      });
    } finally { t.done(); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error((data.error && data.error.message) || res.statusText);
      e.status = res.status;
      throw e;
    }
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    return (msg && msg.content ? msg.content : '').trim();
  }

  async function callAnthropic(opts) {
    const body = {
      model: opts.model,
      max_tokens: opts.maxTokens || 2048,
      temperature: opts.temperature == null ? 0.7 : opts.temperature,
      messages: opts.messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    };
    if (opts.system) body.system = opts.system;

    const t = timeoutSignal(opts.timeout);
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body),
        signal: t.signal
      });
    } finally { t.done(); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error((data.error && data.error.message) || res.statusText);
      e.status = res.status;
      throw e;
    }
    return (data.content || []).map((b) => b.text || '').join('').trim();
  }

  async function chat(opts) {
    if (!opts.apiKey) throw new Error('API 키가 없습니다.');
    try {
      if (opts.provider === 'openai') return await callOpenAI(opts);
      if (opts.provider === 'anthropic') return await callAnthropic(opts);
      return await callGemini(opts);
    } catch (err) {
      const wrapped = new Error(friendlyError(err, opts.provider, err.status));
      wrapped.cause = err;
      throw wrapped;
    }
  }

  /** 코드펜스/잡설이 섞여도 첫 JSON 객체를 뽑아낸다 */
  function parseJSON(text) {
    if (!text) return null;
    let s = String(text).trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (e) { /* continue */ }
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const slice = s.slice(start, end + 1);
      try { return JSON.parse(slice); } catch (e) { /* continue */ }
      // 후행 쉼표 제거 후 재시도
      try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); } catch (e) { /* continue */ }
    }
    return null;
  }

  /** 설정 화면의 키 연결 테스트 */
  async function testConnection(settings) {
    const provider = settings.shared.provider;
    const apiKey = keyFor(provider, settings);
    if (!apiKey) throw new Error('공용 프로바이더(' + (LABEL[provider] || provider) + ')의 API 키가 비어 있어요.');
    const text = await chat({
      provider,
      model: settings.shared.model || DEFAULT_MODELS[provider],
      apiKey,
      system: 'You are a connection test. Reply with exactly: OK',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 16,
      temperature: 0
    });
    return { text, provider, model: settings.shared.model || DEFAULT_MODELS[provider] };
  }

  AIC.llm = { chat, resolve, parseJSON, testConnection, keyFor, DEFAULT_MODELS, LABEL };
})();
