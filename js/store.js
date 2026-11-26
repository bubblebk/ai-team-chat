/* store.js — 상태·localStorage */
(function () {
  'use strict';
  const AIC = (window.AIC = window.AIC || {});
  const U = AIC.util;

  const K = {
    agents: 'aic.agents.v1',
    settings: 'aic.settings.v1',
    rooms: 'aic.rooms.v1',
    active: 'aic.activeRoom.v1'
  };

  const DEFAULT_AGENTS = [
    {
      id: 'lead',
      name: '대표 AI',
      emoji: '👑',
      color: '#f5b942',
      role: '작업 분석·배분·검토 총괄 (팀장)',
      instructions:
        '너는 이 단톡방의 대표 AI이자 팀장이다. 사용자의 요청을 정확히 읽고, 팀원들의 주특기를 비교해 가장 적합한 담당자에게 순서대로 일을 나눈다. ' +
        '지시는 구체적으로(무엇을, 어떤 기준으로, 어디까지) 내리고, 담당자 결과가 요청을 충족하는지 비판적으로 검토한다. ' +
        '부족하면 딱 한 번 보완을 지시하고, 충분하면 핵심만 정리해 최종 결론을 낸다. 과장하지 않고 확인되지 않은 수치는 추정임을 밝힌다.',
      active: true,
      isLead: true,
      model: { mode: 'shared', provider: 'gemini', model: '', apiKey: '' }
    },
    {
      id: 'a-3d',
      name: '3D 모델링',
      emoji: '🧱',
      color: '#a855f7',
      role: 'STL 설계·치수·공차·경량화·Bambu Lab P2S 출력 설정',
      instructions:
        '너는 3D 프린팅·모델링 전문가다. 사용자의 아이디어를 실제로 출력 가능한 형태로 구체화한다.\n' +
        '- 항상 mm 단위 치수, 공차(끼워맞춤 0.2~0.4mm), 벽 두께(2.4mm=0.4노즐 6라인), 서포트 필요 여부를 명시한다.\n' +
        '- Bambu Lab P2S(0.4mm 노즐 기준) 프로필을 제안한다: 레이어 0.16~0.24mm, 외벽 3, 상하 4~5, 채움 15~25% 자이로이드, PETG 240~250℃/80℃, PLA 220℃/60℃, 외벽 속도 60~120mm/s.\n' +
        '- 출력 시간·필라멘트 사용량(g)을 대략 계산해 주고, 실패 위험(오버행 45° 초과, 브리지, 워핑)과 대응책을 적는다.\n' +
        '- 필요하면 OpenSCAD 파라메트릭 코드나 FreeCAD 절차를 단계별로 제공한다. 모르는 치수는 "가정"으로 표시하고 확인 질문을 남긴다.',
      active: true,
      isLead: false,
      model: { mode: 'shared', provider: 'gemini', model: '', apiKey: '' }
    },
    {
      id: 'a-work',
      name: '업무지원',
      emoji: '💼',
      color: '#3b82f6',
      role: '문서 작성·요약·일정 정리·기획·실무 자동화',
      instructions:
        '너는 실무 문서·기획 전문 비서다. 사용자의 요청을 바로 쓸 수 있는 결과물로 만든다.\n' +
        '- 문서는 제목 → 핵심 요약(3줄) → 본문(개요/항목) → 다음 할 일 순으로 구조화한다.\n' +
        '- 일정·할 일은 표(항목 | 기한 | 담당 | 비고)로 정리하고, 빠진 전제를 짚는다.\n' +
        '- 이메일·메시지는 상대와 목적에 맞는 톤으로 300자 내외 초안을 쓴다.\n' +
        '- 추측을 사실처럼 쓰지 않고, 확인이 필요한 값은 [확인 필요]로 표시한다.',
      active: true,
      isLead: false,
      model: { mode: 'shared', provider: 'gemini', model: '', apiKey: '' }
    },
    {
      id: 'a-shop',
      name: '쇼핑',
      emoji: '🛒',
      color: '#f59e0b',
      role: '가격 비교·가성비 분석·해외직구·구매 조건 검토',
      instructions:
        '너는 가격·구매 조건 분석가다. "싸게 사는 것"이 아니라 "총비용이 가장 낮은 선택"을 찾는다.\n' +
        '- 후보 2~4개를 표로 비교한다: 상품가, 배송비, 관세/부가세(직구 150달러 초과 시), 쿠폰, 총액, 배송기간, A/S.\n' +
        '- 3년 사용처럼 기간이 있으면 소모품·교체 비용까지 합산해 총소유비용(TCO)으로 비교한다.\n' +
        '- 구매 타이밍(세일 주기, 환율, 재고)과 사기 위험(판매자 평점, 리뷰 수, 정품 여부)을 짚는다.\n' +
        '- 실시간 가격은 확인하지 못할 수 있으니 "예시/확인 필요"를 구분해 표시한다. 사용자를 대신해 결제하지 않는다.',
      active: true,
      isLead: false,
      model: { mode: 'shared', provider: 'gemini', model: '', apiKey: '' }
    },
    {
      id: 'a-travel',
      name: '여행',
      emoji: '✈️',
      color: '#10b981',
      role: '일정 동선·숙소 비교·교통·날씨·예산 계획',
      instructions:
        '너는 여행 플래너다. 이동 시간을 아끼는 동선을 우선한다.\n' +
        '- 일자별 일정은 시간대(오전/점심/오후/저녁)로 나누고, 이동 수단·소요 시간·예상 비용을 붙인다.\n' +
        '- 숙소는 2~3개 후보를 위치·가격·후기·주차/조식 기준으로 비교한다.\n' +
        '- 날씨와 계절 변수를 반영하고, 비 오는 날 대안을 하나씩 둔다.\n' +
        '- 예산은 교통/숙박/식비/입장료/기타로 표를 만들고 총액을 낸다. 실시간 운임·객실은 확인 필요로 표시한다.',
      active: true,
      isLead: false,
      model: { mode: 'shared', provider: 'gemini', model: '', apiKey: '' }
    },
    {
      id: 'a-stock',
      name: '주식관리',
      emoji: '📈',
      color: '#ef4444',
      role: '종목·섹터 분석·리스크 체크·포트폴리오·시황 정리',
      instructions:
        '너는 주식·포트폴리오 분석 담당이다. 투자 권유가 아니라 정보 정리와 리스크 점검을 한다.\n' +
        '- 종목/섹터를 볼 때 사업 구조, 실적 추이, 밸류에이션(PER/PBR), 수급, 주요 리스크를 순서로 정리한다.\n' +
        '- 포트폴리오는 자산군·섹터·지역 비중과 집중도를 표로 보여주고, 리밸런싱 기준을 제안한다.\n' +
        '- 항상 "이 내용은 정보 정리이며 투자 판단과 책임은 본인에게 있다"를 한 줄 넣는다.\n' +
        '- 실시간 시세를 확인하지 못하면 기준일과 추정임을 명시한다.',
      active: true,
      isLead: false,
      model: { mode: 'shared', provider: 'gemini', model: '', apiKey: '' }
    },
    {
      id: 'a-external-lemon',
      name: '레몬',
      emoji: '🍋',
      color: '#eab308',
      role: '외부 AI · 일정·잔일·웹 작업 비서 (링크/복붙 참여)',
      instructions:
        '너는 사용자의 개인 AI 비서다. 단톡방의 최근 대화와 요청을 읽고, 맡은 일에 대해 결론부터 간결하게 답한다. ' +
        '확인하지 못한 값은 추정임을 밝히고, 실행이 필요한 일은 다음 행동을 한 줄로 제안한다. 답변은 Markdown으로 쓴다.',
      type: 'external',
      link: '',
      active: true,
      isLead: false,
      model: { mode: 'shared', provider: 'gemini', model: '', apiKey: '' }
    }
  ];

  const DEFAULT_SETTINGS = {
    demoMode: true,
    theme: 'dark',
    enterToSend: true,
    shared: { provider: 'gemini', model: 'gemini-2.5-flash' },
    keys: { gemini: '', openai: '', anthropic: '' },
    sync: { url: '', roomKey: '' }
  };

  const state = {
    agents: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    rooms: [],
    activeRoomId: null
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      U.toast('저장 공간이 부족해 저장하지 못했어요.', 'err', 3200);
      return false;
    }
  }

  function normalizeAgent(a) {
    return {
      id: a.id || U.uid('a'),
      name: a.name || '새 에이전트',
      emoji: a.emoji || '🤖',
      color: a.color || '#7c5cff',
      role: a.role || '',
      instructions: a.instructions || '',
      active: a.active !== false,
      isLead: !!a.isLead,
      type: a.type === 'external' ? 'external' : 'api',
      link: a.link || '',
      model: Object.assign({ mode: 'shared', provider: 'gemini', model: '', apiKey: '' }, a.model || {})
    };
  }

  function newRoom(name) {
    const now = Date.now();
    return {
      id: U.uid('room'),
      title: name || '새 단톡방',
      createdAt: now,
      updatedAt: now,
      messages: []
    };
  }

  function load() {
    const savedAgents = read(K.agents, null);
    if (Array.isArray(savedAgents) && savedAgents.length) {
      state.agents = savedAgents.map(normalizeAgent);
      // 대표 AI 누락 방지
      if (!state.agents.some((a) => a.isLead)) state.agents.unshift(normalizeAgent(DEFAULT_AGENTS[0]));
    } else {
      state.agents = DEFAULT_AGENTS.map((a) => normalizeAgent(Object.assign({}, a)));
    }

    state.settings = Object.assign({}, DEFAULT_SETTINGS, read(K.settings, {}));
    state.settings.keys = Object.assign({}, DEFAULT_SETTINGS.keys, state.settings.keys || {});
    state.settings.shared = Object.assign({}, DEFAULT_SETTINGS.shared, state.settings.shared || {});
    state.settings.sync = Object.assign({}, DEFAULT_SETTINGS.sync, state.settings.sync || {});

    const savedRooms = read(K.rooms, null);
    state.rooms = Array.isArray(savedRooms) && savedRooms.length
      ? savedRooms.map((r) => Object.assign({ messages: [] }, r))
      : [];

    if (!state.rooms.length) {
      const room = newRoom('우리 팀 단톡방');
      state.rooms.push(room);
    }

    const active = read(K.active, null);
    state.activeRoomId = state.rooms.some((r) => r.id === active) ? active : state.rooms[0].id;

    document.documentElement.dataset.theme = state.settings.theme === 'light' ? 'light' : 'dark';
  }

  function saveAgents() { write(K.agents, state.agents); }
  function saveSettings() { write(K.settings, state.settings); }
  function saveRooms() { write(K.rooms, state.rooms); }
  function saveActive() { write(K.active, state.activeRoomId); }

  function activeRoom() {
    return state.rooms.find((r) => r.id === state.activeRoomId) || state.rooms[0];
  }
  function findRoom(id) { return state.rooms.find((r) => r.id === id); }
  function getAgent(id) { return state.agents.find((a) => a.id === id); }
  function leadAgent() { return state.agents.find((a) => a.isLead) || state.agents[0]; }
  function teamAgents() { return state.agents.filter((a) => !a.isLead); }
  function activeTeam() { return state.agents.filter((a) => !a.isLead && a.active); }
  function apiTeam() { return state.agents.filter((a) => !a.isLead && a.active && a.type !== 'external'); }
  function externalAgents() { return state.agents.filter((a) => !a.isLead && a.type === 'external'); }

  function addMessage(room, msg) {
    const agentId = msg.agentId || msg.authorId || null;
    const agent = agentId ? getAgent(agentId) : null;
    const ts = msg.ts || Date.now();
    const message = {
      schema: 1,
      id: msg.id || U.uid('m'),
      roomId: room.id,
      authorType: msg.authorType || 'agent',
      authorId: agentId,
      agentId: agentId, // 하위 호환
      authorName: msg.authorName || (agent ? agent.name : (msg.authorType === 'user' ? '나' : '시스템')),
      role: msg.role || (agent ? agent.role : ''),
      authorEmoji: msg.authorEmoji || (agent ? agent.emoji : ''),
      authorColor: msg.authorColor || (agent ? agent.color : ''),
      text: msg.text || '',
      tag: msg.tag || null,
      demo: !!msg.demo,
      manual: !!msg.manual,
      copyText: msg.copyText || null,
      ts,
      createdAt: new Date(ts).toISOString()
    };
    room.messages.push(message);
    room.updatedAt = message.ts;
    saveRooms();
    if (AIC.sync && AIC.sync.onLocalMessage) AIC.sync.onLocalMessage(room, message);
    return message;
  }

  function updateRoom(id, patch) {
    const room = findRoom(id);
    if (!room) return;
    Object.assign(room, patch);
    saveRooms();
  }

  function resetAll() {
    Object.values(K).forEach((key) => {
      try { localStorage.removeItem(key); } catch (e) { /* noop */ }
    });
    state.agents = DEFAULT_AGENTS.map((a) => normalizeAgent(Object.assign({}, a)));
    state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    state.rooms = [newRoom('우리 팀 단톡방')];
    state.activeRoomId = state.rooms[0].id;
    saveAgents(); saveSettings(); saveRooms(); saveActive();
    document.documentElement.dataset.theme = 'dark';
  }

  AIC.store = {
    K, state, DEFAULT_AGENTS, DEFAULT_SETTINGS,
    load, saveAgents, saveSettings, saveRooms, saveActive,
    activeRoom, findRoom, getAgent, leadAgent, teamAgents, activeTeam, apiTeam, externalAgents,
    addMessage, updateRoom, newRoom, resetAll, normalizeAgent
  };
})();
