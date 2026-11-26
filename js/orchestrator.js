/* orchestrator.js — 대표 AI 배분 → 담당 실행 → 대표 AI 검토 (실제 API / 데모) */
(function () {
  'use strict';
  const AIC = (window.AIC = window.AIC || {});
  const U = AIC.util;
  const store = AIC.store;
  const llm = AIC.llm;

  let runState = null; // { cancelled, controller }

  function isBusy() { return !!runState; }

  function cancel() {
    if (!runState) return;
    runState.cancelled = true;
    if (runState.controller) {
      try { runState.controller.abort(); } catch (e) { /* noop */ }
    }
  }

  function checkCancel() {
    if (runState && runState.cancelled) {
      const err = new Error('__cancelled__');
      err.cancelled = true;
      throw err;
    }
  }

  function short(text, n) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > (n || 70) ? s.slice(0, n || 70) + '…' : s;
  }

  /* ---------------------------------------------------------
     프롬프트
     --------------------------------------------------------- */

  function teamRoster(team) {
    return team.map((a) => '- ' + a.name + ' (id: ' + a.id + ') : ' + (a.role || '역할 미지정')).join('\n');
  }

  function historyText(room, limit) {
    const msgs = room.messages.filter((m) => m.authorType === 'user' || m.authorType === 'agent').slice(-(limit || 10));
    return msgs.map((m) => {
      if (m.authorType === 'user') return '[사용자] ' + short(m.text, 600);
      const agent = store.getAgent(m.agentId);
      return '[' + (agent ? agent.name : 'AI') + '] ' + short(m.text, 900);
    }).join('\n');
  }

  function plannerSystem(lead, team) {
    return (lead.instructions || '') + '\n\n' +
      '아래는 네가 이끄는 팀원 목록이다.\n' + teamRoster(team) + '\n\n' +
      '사용자의 요청을 분석해 가장 적절한 팀원을 1~3명 고르고, 반드시 실행 순서대로 배치해라.\n' +
      '규칙:\n' +
      '1) 서로 다른 주특기가 실제로 필요한 경우에만 여러 명을 부른다. 애매하면 1명.\n' +
      '2) 앞선 팀원의 결과를 뒤 팀원이 이어받아야 하면 순서를 그렇게 정한다(예: 쇼핑 → 여행).\n' +
      '3) 각 팀원에게는 그 사람이 바로 일할 수 있는 구체적 지시를 쓴다(무엇을, 어떤 기준으로, 어디까지).\n' +
      '4) 팀원 목록에 없는 id는 절대 쓰지 않는다.\n' +
      '5) 인사말 없이 아래 JSON만 출력한다.\n' +
      '{"plan":"한 줄 배분 요약","assignments":[{"agentId":"팀원 id","task":"구체적 지시","reason":"왜 이 사람인지"}]}';
  }

  function workerSystem(agent) {
    return (agent.instructions || '') + '\n\n' +
      '너는 "AI 팀" 단톡방의 ' + agent.name + ' 담당자다. 주특기: ' + (agent.role || '') + '\n' +
      '팀장이 준 지시를 사용자 원래 요청과 함께 수행해, 단톡방에 올릴 결과 메시지를 작성한다.\n' +
      '작성 규칙:\n' +
      '- 인사말·자기소개 없이 바로 결과부터. "네", "알겠습니다" 같은 말 금지.\n' +
      '- Markdown 사용 가능(소제목, 표, 목록, 코드블록). 모바일에서도 읽히게 700~1200자.\n' +
      '- 숫자·기준·조건을 구체적으로 쓰고, 확인하지 못한 값은 "확인 필요" 또는 "가정"으로 표시한다.\n' +
      '- 앞선 팀원의 결과가 있으면 중복하지 말고 이어받아 보완한다.\n' +
      '- 마지막에 다음 단계 또는 확인이 필요한 질문 1~2개를 남긴다.';
  }

  function reviewerSystem(lead) {
    return (lead.instructions || '') + '\n\n' +
      '너는 대표 AI다. 팀원들이 올린 결과를 사용자 요청과 비교해 냉정하게 검토한다.\n' +
      '- 요청의 핵심이 빠졌거나, 근거 없는 단정, 서로 충돌하는 내용, 실행 불가능한 계획이 있으면 "revise"와 함께 보완 지시를 1건 낸다.\n' +
      '- 충분하면 "approve". 이미 한 번 보완했다면 반드시 "approve"로 끝낸다.\n' +
      '- review에는 검수 의견 3~5줄(체크한 것/아쉬운 것/주의점), final에는 사용자가 바로 보는 최종 결론(핵심 3~5개 불릿 + 다음 행동 1개)을 쓴다.\n' +
      '인사말 없이 아래 JSON만 출력한다.\n' +
      '{"verdict":"approve|revise","review":"검수 의견","revision":{"agentId":"팀원 id","task":"보완 지시"},"final":"최종 결론"}';
  }

  /* ---------------------------------------------------------
     실제 API 실행
     --------------------------------------------------------- */

  async function callLead(lead, settings, system, messages, opts) {
    const m = llm.resolve(lead, settings);
    if (!m.apiKey) {
      const err = new Error('API 키가 없어요. 설정에서 ' + m.label + ' 키를 넣거나 데모 모드를 켜 주세요.');
      err.noKey = true;
      err.provider = m.provider;
      throw err;
    }
    checkCancel();
    const text = await llm.chat({
      provider: m.provider,
      model: m.model,
      apiKey: m.apiKey,
      system,
      messages,
      json: !!(opts && opts.json),
      temperature: opts && opts.temperature != null ? opts.temperature : 0.5,
      maxTokens: (opts && opts.maxTokens) || 2048,
      timeout: 90000
    });
    checkCancel();
    return text;
  }

  async function runReal(ctx, settings) {
    const room = ctx.room;
    const text = ctx.text;
    const team = store.apiTeam();
    const lead = store.leadAgent();
    if (!team.length) throw new Error('활성화된 팀원이 없어요. 사이드바에서 에이전트를 켜 주세요.');

    let plan = null;
    if (ctx.mentioned && ctx.mentioned.length) {
      const mentioned = ctx.mentioned.filter((a) => !a.isLead && a.type !== 'external');
      if (mentioned.length) {
        plan = {
          plan: mentioned.map((a) => a.emoji + ' ' + a.name).join(' → ') + ' 직접 호출',
          assignments: mentioned.map((a) => ({
            agentId: a.id,
            task: text,
            reason: '@' + a.name + ' 직접 지목'
          })),
          direct: true
        };
      } else {
        // 대표 AI만 지목됨 → 대표가 직접 답변
        ctx.status('👑 대표 AI가 답변을 작성 중...');
        ctx.typing(lead.id);
        const reply = await callLead(lead, settings, (lead.instructions || '') + '\n\n단톡방에 올릴 답변을 Markdown으로 작성한다. 인사말 없이 바로.',
          [{ role: 'user', content: '대화 맥락:\n' + historyText(room, 8) + '\n\n사용자: ' + text }],
          { temperature: 0.6 });
        ctx.typing(null);
        ctx.message({ authorType: 'agent', agentId: lead.id, text: reply, tag: 'final' });
        return;
      }
    }

    if (!plan) {
      ctx.status('👑 대표 AI가 작업 배분 중...');
      ctx.typing(lead.id);
      const raw = await callLead(lead, settings, plannerSystem(lead, team), [{
        role: 'user',
        content: '최근 대화:\n' + (historyText(room, 8) || '(없음)') + '\n\n사용자 요청:\n' + text
      }], { json: true, temperature: 0.35, maxTokens: 1200 });
      ctx.typing(null);
      plan = normalizePlan(llm.parseJSON(raw), team, text);
      if (!plan) {
        plan = {
          plan: '요청 성격이 한 곳에 맞지 않아 업무지원이 1차 정리합니다.',
          assignments: [{ agentId: (team.find((a) => a.id === 'a-work') || team[0]).id, task: text, reason: '기본 배정' }]
        };
      }
    }

    ctx.plan(plan, lead);

    const results = [];
    for (let i = 0; i < plan.assignments.length; i++) {
      checkCancel();
      const asg = plan.assignments[i];
      const agent = store.getAgent(asg.agentId);
      if (!agent || agent.isLead) continue;
      ctx.status(agent.emoji + ' ' + agent.name + '이(가) 작업 중...');
      ctx.typing(agent.id);
      const prior = results.length
        ? results.map((r) => '[' + r.agentName + ']\n' + r.text).join('\n\n')
        : '';
      const userPayload =
        '[사용자 원래 요청]\n' + text + '\n\n' +
        '[대표 AI 지시]\n' + asg.task + '\n' +
        (prior ? '\n[앞선 팀원 결과]\n' + prior + '\n' : '') +
        '\n이제 단톡방에 올릴 결과를 작성해라.';
      const out = await callLead(agent, settings, workerSystem(agent),
        [{ role: 'user', content: userPayload }], { temperature: 0.7, maxTokens: 2400 });
      ctx.typing(null);
      results.push({ agentId: agent.id, agentName: agent.name, text: out, emoji: agent.emoji });
      ctx.message({ authorType: 'agent', agentId: agent.id, text: out });
    }

    ctx.status('👑 대표 AI가 결과 검토 중...');
    ctx.typing(lead.id);
    let reviewRaw = await callLead(lead, settings, reviewerSystem(lead), [{
      role: 'user',
      content: '[사용자 요청]\n' + text + '\n\n[팀원 결과]\n' +
        results.map((r) => '[' + r.agentName + ' / id:' + r.agentId + ']\n' + r.text).join('\n\n')
    }], { json: true, temperature: 0.4, maxTokens: 1800 });
    ctx.typing(null);
    let review = llm.parseJSON(reviewRaw) || {};

    if (review.verdict === 'revise' && review.revision && review.revision.agentId) {
      const fixAgent = store.getAgent(review.revision.agentId);
      const target = results.find((r) => r.agentId === review.revision.agentId);
      if (fixAgent && target) {
        ctx.status('🔁 대표 AI가 ' + fixAgent.name + '에게 1회 보완을 요청했어요...');
        ctx.message({
          authorType: 'agent', agentId: lead.id, tag: 'review',
          text: '**보완 지시**\n' +
            (review.review ? review.review + '\n\n' : '') +
            '→ ' + fixAgent.emoji + ' **' + fixAgent.name + '**: ' + (review.revision.task || '앞선 결과를 보완해 주세요.')
        });
        ctx.typing(fixAgent.id);
        const fixed = await callLead(fixAgent, settings, workerSystem(fixAgent), [{
          role: 'user',
          content: '[사용자 요청]\n' + text + '\n\n[내 앞선 결과]\n' + target.text +
            '\n\n[대표 AI 보완 지시]\n' + (review.revision.task || '') + '\n\n보완한 내용만 간결하게 다시 올려라.'
        }], { temperature: 0.6, maxTokens: 2200 });
        ctx.typing(null);
        ctx.message({ authorType: 'agent', agentId: fixAgent.id, text: fixed, tag: 'revision' });
        results.push({ agentId: fixAgent.id, agentName: fixAgent.name + ' (보완)', text: fixed, emoji: fixAgent.emoji });

        ctx.status('👑 대표 AI가 최종 검토 중...');
        ctx.typing(lead.id);
        reviewRaw = await callLead(lead, settings, reviewerSystem(lead), [{
          role: 'user',
          content: '[사용자 요청]\n' + text + '\n\n[팀원 결과]\n' +
            results.map((r) => '[' + r.agentName + ']\n' + r.text).join('\n\n') +
            '\n\n이미 한 번 보완을 받았다. 반드시 approve로 최종 검수와 결론을 내라.'
        }], { json: true, temperature: 0.35, maxTokens: 1800 });
        ctx.typing(null);
        review = llm.parseJSON(reviewRaw) || review;
      }
    }

    if (!review.final && !review.review) {
      review = {
        review: '팀원 결과를 확인했습니다.',
        final: (results.map((r) => '- **' + r.agentName + '**: ' + short(r.text, 120)).join('\n'))
      };
    }
    ctx.review(review, lead, results);
  }

  /* ---------------------------------------------------------
     계획 정규화
     --------------------------------------------------------- */

  function normalizePlan(parsed, team, text) {
    if (!parsed || !Array.isArray(parsed.assignments)) return null;
    const seen = new Set();
    const assignments = [];
    parsed.assignments.forEach((a) => {
      const agent = team.find((t) => t.id === a.agentId) ||
        team.find((t) => t.name === a.agentId) ||
        team.find((t) => a.agentId && String(a.agentId).indexOf(t.name) !== -1);
      if (!agent || seen.has(agent.id)) return;
      seen.add(agent.id);
      assignments.push({
        agentId: agent.id,
        task: String(a.task || text).slice(0, 800),
        reason: String(a.reason || '').slice(0, 300)
      });
    });
    if (!assignments.length) return null;
    return { plan: String(parsed.plan || '').slice(0, 300), assignments: assignments.slice(0, 3) };
  }

  /* ---------------------------------------------------------
     데모 모드
     --------------------------------------------------------- */

  const KEYWORDS = {
    'a-3d': ['3d', '프린트', '프린터', '출력', 'stl', '모델링', '캐드', 'cad', '필라멘트', 'petg', 'pla', '노즐', '서포트', '도면', 'p2s', '뱀부', 'bambu', '경량화', '공차', '파라메트릭', '오픈scad'],
    'a-work': ['문서', '보고서', '요약', '일정', '기획', '메일', '이메일', '회의', '엑셀', 'ppt', '발표', '계획서', '공문', '자소서', '이력서', '할일', '할 일', '정리해', '자동화', '템플릿'],
    'a-shop': ['구매', '가격', '최저가', '할인', '쿠폰', '배송', '직구', '알리', '타오바오', '쇼핑', '비교', '견적', '중고', '주문', '사야', '살까', '가성비', '카드'],
    'a-travel': ['여행', '숙소', '호텔', '항공', '기차', '버스', '코스', '맛집', '관광', '부여', '공주', '제주', '부산', '당일치기', '2박', '3일', '숙박', '동선'],
    'a-stock': ['주식', '종목', 'etf', '배당', '코인', '비트코인', '시황', '투자', '포트폴리오', '삼성전자', '나스닥', '코스피', '환율', '금리', '리밸런싱']
  };

  const PRIORITY = { 'a-shop': 1, 'a-travel': 2, 'a-3d': 3, 'a-stock': 4, 'a-work': 5 };

  function scoreAgent(agent, text) {
    const lower = String(text).toLowerCase();
    let score = 0;
    const words = KEYWORDS[agent.id];
    if (words) {
      words.forEach((w) => {
        if (lower.indexOf(w) !== -1) score += w.length >= 3 ? 3 : 2;
      });
    }
    // 역할명 자체가 언급되면 가산
    if (agent.name && lower.indexOf(agent.name.toLowerCase()) !== -1) score += 5;
    if (agent.role) {
      agent.role.split(/[·,/]/).map((s) => s.trim()).filter((s) => s.length >= 2).forEach((w) => {
        if (lower.indexOf(w) !== -1) score += 1;
      });
    }
    return score;
  }

  function demoPlan(text, mentioned, team) {
    if (mentioned && mentioned.length) {
      const list = mentioned.filter((a) => !a.isLead);
      if (list.length) {
        return {
          plan: list.map((a) => a.emoji + ' ' + a.name).join(' → ') + ' 직접 호출',
          assignments: list.map((a) => ({ agentId: a.id, task: text, reason: '@' + a.name + ' 직접 지목' })),
          direct: true
        };
      }
    }
    const scored = team.map((a) => ({ agent: a, score: scoreAgent(a, text) })).sort((x, y) => y.score - x.score);
    // "최저가·구매·비교" 같은 구매 의도는 쇼핑에 가산
    if (/최저가|가격|얼마|구매|사야|살까|비교|견적|할인|쿠폰|직구/.test(text)) {
      const shop = scored.find((s) => s.agent.id === 'a-shop');
      if (shop) shop.score += 5;
      scored.sort((x, y) => y.score - x.score);
    }
    let picked = scored.filter((s) => s.score > 0);
    if (!picked.length) {
      const fallback = team.find((a) => a.id === 'a-work') || team[0];
      return {
        plan: '어느 주특기에도 딱 맞지 않아 업무지원이 1차로 정리합니다.',
        assignments: [{ agentId: fallback.id, task: text, reason: '기본 배정' }]
      };
    }
    const max = text.length > 55 && picked.length >= 3 ? 3 : 2;
    picked = picked.slice(0, max);
    picked.sort((x, y) => (PRIORITY[x.agent.id] || 9) - (PRIORITY[y.agent.id] || 9));
    return {
      plan: picked.map((p) => p.agent.name).join(' → ') + ' 순서로 배분',
      assignments: picked.map((p) => ({
        agentId: p.agent.id,
        task: demoTasks[p.agent.id] || ('"' + short(text, 40) + '" 요청을 맡은 주특기에 맞춰 정리해 주세요.'),
        reason: p.agent.role
      }))
    };
  }

  const demoTasks = {
    'a-3d': '요청에 맞는 형상·치수·공차를 잡고, Bambu Lab P2S 기준 출력 설정과 예상 소재량, 실패 위험을 붙여 주세요.',
    'a-work': '요청을 바로 쓸 수 있는 문서/일정 형태로 구조화하고 다음 할 일을 정리해 주세요.',
    'a-shop': '후보를 총비용(상품가+배송+관세) 기준으로 비교하고 구매 조건과 타이밍을 판단해 주세요.',
    'a-travel': '이동 시간을 줄이는 동선으로 일정을 짜고 숙소·예산을 함께 비교해 주세요.',
    'a-stock': '관련 섹터·종목을 리스크 중심으로 정리하고 점검 체크리스트를 만들어 주세요.'
  };

  function demoWork(agent, query, prior, revision) {
    const q = short(query, 80);
    const base = '\n\n> 데모 모드 결과입니다. 실제 수치·가격·일정은 확인 후 확정하세요.';

    if (agent.id === 'a-3d') {
      const isPetg = /petg|필라멘트|습도/i.test(query);
      return '### 🧱 설계 요약\n' +
        '**요청:** ' + q + '\n\n' +
        '| 항목 | 제안값 | 비고 |\n|---|---|---|\n' +
        '| 외곽 치수 | 80 × 60 × 35 mm | 가정, 도면 확인 필요 |\n' +
        '| 벽 두께 | 2.4 mm | 0.4 노즐 6라인 |\n' +
        '| 끼워맞춤 공차 | +0.25 mm | 축·홀 슬라이드 맞춤 |\n' +
        '| 최소 곡률 | R1.2 | 응력 집중부 필렛 |\n' +
        '| 무게(예상) | 38~44 g | 20% 채움 기준 |\n\n' +
        '### ⚙️ Bambu Lab P2S 출력 설정\n' +
        '| 설정 | 값 |\n|---|---|\n' +
        '| 레이어 | 0.20 mm (0.16 품질) |\n' +
        '| 외벽/상하 | 3 / 5 |\n' +
        '| 채움 | 20% 자이로이드 |\n' +
        '| 노즐/베드 | ' + (isPetg ? '245℃ / 80℃ (PETG)' : '220℃ / 60℃ (PLA)') + ' |\n' +
        '| 외벽 속도 | 90 mm/s |\n' +
        '| 서포트 | 유기적, 45° 초과 구간만 |\n\n' +
        '### ⏱ 예상\n- 출력 시간 **2시간 10분~2시간 40분**\n- 소재 **약 42 g** (1kg 스풀의 4%)\n\n' +
        '### ⚠️ 실패 위험 체크\n' +
        '- 하단 코너 워핑 → 브림 5 mm, 베드 청소 후 출력\n' +
        '- 브리지 구간 처짐 → 45° 초과 구간 서포트 또는 회전 배치\n' +
        '- PETG 스트링 → 리트랙션 0.8 mm, 온도 5℃ 낮추기\n\n' +
        '**확인이 필요한 것:** 실제 결합부 치수와 하중 방향을 알려주시면 공차·벽 두께를 다시 잡겠습니다.' + base;
    }

    if (agent.id === 'a-work') {
      return '### 💼 요청 정리\n**' + q + '**\n\n' +
        '### 문서 구조(안)\n' +
        '1. **목적** — 한 문장으로 정리\n' +
        '2. **현재 상태** — 있는 것 / 없는 것\n' +
        '3. **핵심 내용** — 3개 항목 이내\n' +
        '4. **일정·담당** — 표로 정리\n' +
        '5. **다음 할 일** — 오늘 안에 할 1개\n\n' +
        '### 일정·할 일\n' +
        '| 항목 | 기한 | 담당 | 비고 |\n|---|---|---|---|\n' +
        '| 자료 수집 | D-2 | 나 | 링크·캡처 정리 |\n' +
        '| 초안 작성 | D-1 | 나 | 1장 이내 |\n' +
        '| 검토·발송 | D-day | 나 | 상대 확인 |\n\n' +
        '### 다음 단계\n- 초안에 꼭 들어갈 **숫자 1개와 마감일 1개**를 먼저 정하면 작성 시간이 절반으로 줄어요.\n' +
        '- 문서 성격(보고/요청/공지)과 상대를 알려주시면 톤을 맞춰 초안까지 써 드릴게요.' + base;
    }

    if (agent.id === 'a-shop') {
      return '### 🛒 후보 비교\n**요청:** ' + q + '\n\n' +
        '| 후보 | 상품가 | 배송 | 총액 | 배송기간 | 비고 |\n|---|---|---|---|---|---|\n' +
        '| A. 국내 정품 | 42,000원 | 무료 | **42,000원** | 1~2일 | A/S 쉬움 |\n' +
        '| B. 해외 직구 | 31,500원 | 4,900원 | **36,400원** | 7~12일 | 관세 없음(150달러 이하) |\n' +
        '| C. 묶음 구매 | 88,000원/3개 | 무료 | 개당 **29,300원** | 2~3일 | 3개 이상 필요할 때 |\n\n' +
        '### 총비용 판단\n- 1~2개만 필요하면 **B가 약 5,600원 저렴**, 다만 7~12일 걸립니다.\n' +
        '- 3개 이상이면 **C가 개당 7,000원 이상 유리**합니다.\n' +
        '- 급하면 A. 차액 5,600원은 배송 속도 값이라고 보면 됩니다.\n\n' +
        '### 구매 전 체크\n- 판매자 평점 **4.8 이상**, 리뷰 **100개 이상**, 최근 3개월 리뷰 확인\n- 옵션명과 실물 사진의 규격 일치 여부\n- 직구는 환율·배송 지연 변수 → 여유 10일 두기\n\n' +
        '**확인 필요:** 수량과 도착 희망일을 알려주시면 위 표에서 하나로 확정해 드릴게요.' + base;
    }

    if (agent.id === 'a-travel') {
      return '### ✈️ 일정(안)\n**요청:** ' + q + '\n\n' +
        '**1일차 — 도착 · 중심지**\n' +
        '- 10:00 도착 → 숙소 짐 보관\n' +
        '- 11:00 대표 유적지 1곳 (2시간)\n' +
        '- 13:00 점심 (현지 식당)\n' +
        '- 15:00 박물관·전시 (실내, 비 오면 대안)\n' +
        '- 18:30 저녁 · 야경 산책\n\n' +
        '**2일차 — 외곽 · 자연**\n' +
        '- 09:00 조식 후 이동 (차량 25분)\n' +
        '- 10:00 외곽 코스 2곳\n' +
        '- 13:00 점심\n' +
        '- 15:00 카페·휴식\n' +
        '- 17:00 시장 구경 · 기념품\n\n' +
        '**3일차 — 정리 · 복귀**\n- 09:30 체크아웃 · 마지막 코스 1곳\n- 12:00 점심 → 14:00 출발\n\n' +
        '### 숙소 후보\n' +
        '| 숙소 | 위치 | 1박(예시) | 특징 |\n|---|---|---|---|\n' +
        '| A | 중심가 도보 5분 | 9~11만원 | 동선 최적, 주차 협소 |\n' +
        '| B | 외곽 조용한 곳 | 7~8만원 | 주차 편함, 차량 필수 |\n' +
        '| C | 역 인근 | 8~10만원 | 대중교통 편리 |\n\n' +
        '### 예산(2인 기준, 예시)\n' +
        '| 항목 | 금액 |\n|---|---|\n| 숙박 2박 | 16~22만원 |\n| 식비 | 12~16만원 |\n| 교통·주유 | 6~9만원 |\n| 입장료·기타 | 4~6만원 |\n| **합계** | **38~53만원** |\n\n' +
        '### 변수\n- 우천 시 1일차 오후를 실내 코스로 교체\n- 주말은 주차 대기 20~30분 → 09:30 이전 도착 권장\n\n' +
        '**확인 필요:** 출발일과 차량 여부를 알려주시면 숙소·동선을 확정해 드릴게요.' + base;
    }

    if (agent.id === 'a-stock') {
      return '### 📈 시황·섹터 정리\n**요청:** ' + q + '\n\n' +
        '### 종목 점검표\n' +
        '| 항목 | 내용 |\n|---|---|\n| 사업 구조 | 매출 비중·주력 제품 |\n| 실적 추이 | 최근 4분기 매출·영업이익률 |\n| 밸류에이션 | PER·PBR·동종 비교 |\n| 수급 | 외국인·기관 20일 순매수 |\n| 배당 | 배당수익률·배당성향 |\n\n' +
        '### 리스크 3가지\n' +
        '1. **실적 변동성** — 환율·원자재가에 따른 마진 압박\n' +
        '2. **집중 리스크** — 특정 섹터 비중이 40%를 넘으면 충격이 커짐\n' +
        '3. **타이밍 리스크** — 실적 발표 전후 변동성 확대\n\n' +
        '### 포트폴리오 점검(예시)\n' +
        '| 자산 | 현재 | 제안 |\n|---|---|---|\n| 국내 주식 | 55% | 45% |\n| 해외 주식 | 25% | 30% |\n| 현금·채권 | 15% | 20% |\n| 기타 | 5% | 5% |\n\n' +
        '### 다음 체크\n- 보유 종목별 **손절·익절 기준**을 미리 숫자로 정해 두기\n- 분기 실적 발표일 캘린더에 등록\n\n' +
        '> 이 내용은 정보 정리이며 투자 판단과 책임은 본인에게 있습니다. 실시간 시세는 확인하지 못했습니다.' + base;
    }

    // 사용자 추가 에이전트
    return '### ' + agent.emoji + ' ' + agent.name + ' 결과\n**요청:** ' + q + '\n\n' +
      '**주특기(' + (agent.role || '') + ') 기준으로 정리했습니다.**\n\n' +
      '1. **핵심 판단** — 요청의 목적과 제약을 먼저 정리\n' +
      '2. **실행안** — 바로 할 수 있는 순서 3단계\n' +
      '3. **확인 필요** — 결과를 확정하려면 필요한 정보 1~2개\n\n' +
      '**다음 단계:** 필요한 조건(기간·예산·규격 등)을 알려주시면 더 구체적으로 잡아 드릴게요.' + base;
  }

  function demoRevisionWork(agent, query) {
    if (agent.id === 'a-travel') {
      return '### ✈️ 보완 — 예산·날씨 반영\n' +
        '| 구분 | 내용 |\n|---|---|\n' +
        '| 예산 상한 | 2인 45만원 (숙박 20·식비 14·교통 7·기타 4) |\n' +
        '| 날씨 변수 | 비 확률 30% → 1일차 오후 실내 코스로 교체 |\n' +
        '| 예약 순서 | 숙소 → 기차/렌터카 → 입장권(현장 발권 가능) |\n' +
        '| 절약 포인트 | 숙소 2박 묶음 할인, 점심 위주 식사 |\n\n' +
        '앞선 일정에 위 예산표와 우천 대안을 그대로 붙여 쓰시면 됩니다.';
    }
    if (agent.id === 'a-shop') {
      return '### 🛒 보완 — 수량·도착일 기준 확정\n' +
        '- 2개 이하 + 1주일 내 필요 → **국내 A** (총 84,000원)\n' +
        '- 3개 이상 + 2주 여유 → **묶음 C** (개당 29,300원, 총 88,000원)\n' +
        '- 직구 B는 7~12일 소요라 일정이 급하면 제외\n\n' +
        '결제 전 쿠폰 적용 후 최종 결제 금액을 한 번 더 확인하세요.';
    }
    if (agent.id === 'a-3d') {
      return '### 🧱 보완 — 공차·서포트 재점검\n' +
        '- 결합부 공차 **+0.25 → +0.35 mm** (PETG 수축 반영)\n' +
        '- 오버행 50° 구간은 45° 회전 배치로 서포트 제거\n' +
        '- 첫 레이어 속도 30 mm/s, 브림 5 mm로 워핑 방지\n\n' +
        '수정된 설정으로 슬라이스하면 예상 시간은 약 10분 늘어납니다.';
    }
    return '### 🔁 보완 결과\n- 앞선 결과에서 빠진 **기준·수치·일정**을 보충했습니다.\n- 실행 순서를 3단계로 단순화했습니다.\n- 추가 확인이 필요한 항목 1개를 남겼습니다.';
  }

  function demoReview(plan, results, revised) {
    const agentNames = results.map((r) => r.agentName.replace(' (보완)', ''));
    const needRevise = !revised && results.length >= 2;
    const reviewLines = [
      '- ✅ 요청의 핵심 항목(' + short(plan.plan || '작업', 40) + ')은 모두 다뤄졌습니다.',
      '- ✅ 숫자·기준이 붙어 있어 바로 실행할 수 있습니다.',
      needRevise ? '- ⚠️ ' + agentNames[agentNames.length - 1] + ' 결과에 **예산·일정 조건**이 빠져 서로 맞춰보기 어렵습니다. 1회 보완을 지시합니다.'
        : '- ✅ 앞선 결과와 충돌하는 내용이 없습니다.',
      '- 🔎 확정 전 실제 가격·재고·날씨는 한 번 더 확인하세요.'
    ];
    const review = reviewLines.join('\n');

    const finals = [];
    const unique = [];
    results.forEach((r) => {
      const i = unique.findIndex((u) => u.agentId === r.agentId);
      if (i >= 0) unique[i] = r; else unique.push(r);
    });
    finals.push('### 👑 최종 결론');
    finals.push('**' + short(plan.plan || '요청 처리', 50) + '**');
    unique.slice(0, 4).forEach((r) => {
      finals.push('- **' + r.agentName.replace(' (보완)', '') + '**: ' + demoKeyLine(r.agentId, r.text));
    });
    finals.push('');
    finals.push('**다음 행동 1개:** ' + demoNextAction(results));
    finals.push('');
    finals.push('_데모 모드 요약입니다. 실제 API 키를 넣으면 같은 흐름으로 진짜 결과가 나옵니다._');
    return { verdict: needRevise ? 'revise' : 'approve', review, final: finals.join('\n') };
  }

  function demoKeyLine(agentId, text) {
    const lines = {
      'a-3d': 'P2S 0.2 mm·20% 자이로이드로 2시간 10분~2시간 40분, 약 42 g 예상',
      'a-work': '문서 구조 5단계와 일정표로 정리, 오늘 할 일 1개 확정',
      'a-shop': '2개 이하면 국내(차액 5,600원), 3개 이상이면 묶음 구매가 유리',
      'a-travel': '2박 3일 동선 + 숙소 3곳 + 2인 예산 38~53만원',
      'a-stock': '리스크 3가지와 자산 비중 조정안(주식 55→45%)'
    };
    return lines[agentId] || short(text.replace(/[#*>\n]/g, ' '), 60);
  }

  function demoNextAction(results) {
    const ids = results.map((r) => r.agentId);
    if (ids.indexOf('a-shop') !== -1) return '수량과 도착 희망일을 정해 쇼핑 후보를 하나로 확정하기';
    if (ids.indexOf('a-travel') !== -1) return '출발일·차량 여부를 정해 숙소 1곳 예약하기';
    if (ids.indexOf('a-3d') !== -1) return '결합부 실측 치수 2개를 재서 공차 확정하기';
    if (ids.indexOf('a-stock') !== -1) return '보유 종목 손절·익절 기준을 숫자로 적어 두기';
    return '결과에서 [확인 필요]로 표시된 값 1개를 먼저 확인하기';
  }

  async function runDemo(ctx) {
    const team = store.apiTeam();
    const lead = store.leadAgent();
    const plan = demoPlan(ctx.text, ctx.mentioned, team);

    await U.sleep(650);
    checkCancel();
    ctx.plan(plan, lead);

    const results = [];
    for (let i = 0; i < plan.assignments.length; i++) {
      checkCancel();
      const asg = plan.assignments[i];
      const agent = store.getAgent(asg.agentId);
      if (!agent) continue;
      ctx.status(agent.emoji + ' ' + agent.name + '이(가) 작업 중...');
      ctx.typing(agent.id);
      await U.sleep(1100 + Math.min(ctx.text.length * 12, 900));
      checkCancel();
      const out = demoWork(agent, ctx.text, results);
      ctx.typing(null);
      results.push({ agentId: agent.id, agentName: agent.name, text: out, emoji: agent.emoji });
      ctx.message({ authorType: 'agent', agentId: agent.id, text: out, demo: true });
    }

    ctx.status('👑 대표 AI가 결과 검토 중...');
    ctx.typing(lead.id);
    await U.sleep(1000);
    checkCancel();
    let review = demoReview(plan, results, false);

    if (review.verdict === 'revise') {
      const target = results[results.length - 1];
      const agent = store.getAgent(target.agentId);
      ctx.typing(null);
      ctx.message({
        authorType: 'agent', agentId: lead.id, tag: 'review', demo: true,
        text: '**보완 지시**\n' + review.review + '\n\n→ ' + agent.emoji + ' **' + agent.name +
          '**: 예산·일정 조건을 숫자로 넣어 앞선 결과와 맞춰 주세요.'
      });
      ctx.status('🔁 대표 AI가 ' + agent.name + '에게 1회 보완을 요청했어요...');
      ctx.typing(agent.id);
      await U.sleep(1200);
      checkCancel();
      const fixed = demoRevisionWork(agent, ctx.text);
      ctx.typing(null);
      ctx.message({ authorType: 'agent', agentId: agent.id, text: fixed, tag: 'revision', demo: true });
      results.push({ agentId: agent.id, agentName: agent.name + ' (보완)', text: fixed, emoji: agent.emoji });

      ctx.status('👑 대표 AI가 최종 검토 중...');
      ctx.typing(lead.id);
      await U.sleep(900);
      checkCancel();
      review = demoReview(plan, results, true);
    }

    ctx.typing(null);
    ctx.review(review, lead, results);
  }

  /* ---------------------------------------------------------
     진입점
     --------------------------------------------------------- */

  async function run(ctx) {
    if (runState) return;
    runState = { cancelled: false, controller: null };
    const settings = store.state.settings;
    try {
      if (settings.demoMode) {
        await runDemo(ctx);
      } else {
        await runReal(ctx, settings);
      }
    } catch (err) {
      if (err && err.cancelled) {
        ctx.message({ authorType: 'system', text: '작업을 중단했어요.', kind: 'notice' });
      } else if (err && err.noKey) {
        ctx.message({
          authorType: 'system',
          kind: 'error',
          text: err.message + ' 데모 모드로 바꾸면 지금 바로 흐름을 볼 수 있어요.'
        });
      } else {
        ctx.message({
          authorType: 'system',
          kind: 'error',
          text: '작업 중 오류가 났어요. ' + (err && err.message ? err.message : '') +
            ' 설정에서 키·모델명을 확인하거나 데모 모드로 다시 시도해 보세요.'
        });
      }
    } finally {
      ctx.typing(null);
      ctx.status(null);
      runState = null;
      ctx.done && ctx.done();
    }
  }

  AIC.orchestrator = { run, cancel, isBusy, demoPlan, demoWork };
})();
