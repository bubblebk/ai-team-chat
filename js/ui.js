/* ui.js — 화면 렌더링·이벤트 */
(function () {
  'use strict';
  const AIC = (window.AIC = window.AIC || {});
  const U = AIC.util;
  const store = AIC.store;
  const orch = AIC.orchestrator;
  const md = AIC.markdown;

  const $ = U.$;
  const el = U.el;

  let typingEl = null;
  let lastDayKey = null;
  let pendingRoomAction = null; // {mode:'new'|'rename', roomId}
  let editingAgentId = null;
  let selectedMentionIndex = 0;
  let mentionCandidates = [];
  let userScrolled = false;

  const EMOJIS = ['👑','🧱','💼','🛒','✈️','📈','🤖','🧠','📝','🎨','🎵','🏠','💰','⚖️','🩺','🔬','🌱','🚗','🍳','📷','🗂️','🧾','💻','🎮','🛠️','📊','🧪','🍀','🔥','⭐'];
  const COLORS = ['#f5b942','#a855f7','#3b82f6','#f59e0b','#10b981','#ef4444','#ec4899','#06b6d4','#84cc16','#7c5cff','#64748b','#e11d48'];

  const TAG_LABEL = { plan: '작업 배분', review: '검수', final: '최종 결론', revision: '보완', external: '외부 AI 호출' };
  const TAG_CLASS = { plan: 'plan', review: 'review', final: 'final', revision: 'revision', external: 'ext' };

  /* ---------------------------------------------------------
     공통
     --------------------------------------------------------- */

  function avatar(agent, size) {
    const a = agent || { emoji: '🤖', color: '#64748b', name: 'AI' };
    const node = el('div', {
      class: 'avatar ' + (size || 's36') + (a.isLead ? ' lead-ring' : ''),
      title: a.name
    }, a.emoji || '🤖');
    node.style.background = 'linear-gradient(145deg, ' + (a.color || '#7c5cff') + '33, ' + (a.color || '#7c5cff') + '14)';
    node.style.boxShadow = (a.isLead ? '0 0 0 2px rgba(251,191,36,.55), ' : '') +
      'inset 0 0 0 1px ' + (a.color || '#7c5cff') + '55';
    return node;
  }

  function agentOrGhost(id) {
    return store.getAgent(id) || { id, name: '삭제된 AI', emoji: '🤖', color: '#64748b', role: '' };
  }

  function agentForMessage(msg) {
    const live = store.getAgent(msg.agentId);
    if (live) return live;
    return {
      id: msg.agentId,
      name: msg.authorName || '삭제된 AI',
      emoji: msg.authorEmoji || '🤖',
      color: msg.authorColor || '#64748b',
      role: msg.role || ''
    };
  }

  function nearBottom() {
    const box = $('#messages');
    return box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  }

  function scrollToBottom(force) {
    const box = $('#messages');
    if (force || !userScrolled) box.scrollTop = box.scrollHeight;
  }

  /* ---------------------------------------------------------
     사이드바
     --------------------------------------------------------- */

  function renderRooms() {
    const list = $('#roomList');
    list.textContent = '';
    store.state.rooms.forEach((room) => {
      const active = room.id === store.state.activeRoomId;
      const item = el('li', {
        class: 'room-item' + (active ? ' active' : ''),
        role: 'button', tabindex: '0',
        onclick: () => selectRoom(room.id)
      }, [
        el('span', { class: 'r-hash', text: '#' }),
        el('span', { class: 'r-name', text: room.title }),
        el('span', { class: 'r-badge', text: room.messages.filter((m) => m.authorType === 'user').length + '' })
      ]);
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectRoom(room.id); });
      list.appendChild(item);
    });
  }

  function renderAgents() {
    const list = $('#agentList');
    list.textContent = '';
    const sorted = store.state.agents.slice().sort((a, b) => (b.isLead ? 1 : 0) - (a.isLead ? 1 : 0));
    sorted.forEach((agent) => {
      const item = el('li', {
        class: 'agent-item' + (agent.active ? '' : ' off'),
        role: 'button', tabindex: '0',
        title: agent.name + ' 편집',
        onclick: () => openAgentModal(agent.id)
      }, [
        avatar(agent, 's30'),
        el('div', { class: 'a-main' }, [
          el('div', { class: 'a-name' }, [
            agent.name,
            agent.isLead ? el('span', { class: 'crown', text: '👑' }) : null,
            agent.type === 'external' ? el('span', { class: 'a-type', text: '외부' }) : null
          ]),
          el('div', { class: 'a-role', text: agent.role || '역할 없음' })
        ]),
        el('span', { class: 'a-dot' })
      ]);
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter') openAgentModal(agent.id); });
      list.appendChild(item);
    });
    $('#agentCount').textContent = store.state.agents.length + '';
  }

  function renderHeader() {
    const room = store.activeRoom();
    $('#roomTitle').textContent = room.title;
    const active = store.activeTeam();
    const extCount = active.filter((a) => a.type === 'external').length;
    $('#roomMeta').textContent = 'AI ' + active.length + '명' + (extCount ? ' (외부 ' + extCount + ')' : '') +
      ' · 메시지 ' + room.messages.length + '개';

    const stack = $('#avatarStack');
    stack.textContent = '';
    active.slice(0, 5).forEach((a) => stack.appendChild(avatar(a, 's24')));
    if (active.length > 5) {
      stack.appendChild(el('div', { class: 'avatar s24', text: '+' + (active.length - 5) }));
    }

    const demo = store.state.settings.demoMode;
    const dot = $('#modeDot');
    dot.classList.toggle('live', !demo);
    dot.title = demo ? '데모 모드' : 'API 연결 모드';
    $('#keyStatus').textContent = demo
      ? '데모 모드로 실행 중'
      : (store.state.settings.keys[store.state.settings.shared.provider]
        ? 'API 연결됨 · ' + store.state.settings.shared.model
        : 'API 키 없음 (설정에서 입력)');
  }

  function renderChips() {
    const host = $('#quickChips');
    host.textContent = '';
    store.state.agents.forEach((a) => {
      const chip = el('button', {
        type: 'button',
        class: 'chip-agent' + (a.active ? '' : ' off'),
        title: '@' + a.name + ' 직접 호출',
        onclick: () => insertMention(a.name)
      }, [
        el('span', { class: 'c-emoji', text: a.emoji }),
        a.name
      ]);
      host.appendChild(chip);
    });
  }

  /* ---------------------------------------------------------
     메시지
     --------------------------------------------------------- */

  function messageNode(msg) {
    if (msg.authorType === 'system') {
      return el('div', { class: 'msg system' }, [
        el('div', { class: 'msg-body' }, [
          el('div', { class: 'sys-pill' + (msg.kind === 'error' ? ' err' : ''), text: msg.text })
        ])
      ]);
    }

    const isUser = msg.authorType === 'user';
    const agent = isUser ? null : agentForMessage(msg);
    const body = el('div', { class: 'msg-body' });

    if (!isUser) {
      const meta = el('div', { class: 'msg-meta' }, [
        el('span', { class: 'who', text: agent.name })
      ]);
      if (agent.role) meta.appendChild(el('span', { class: 'role-badge', text: agent.role }));
      if (msg.tag && TAG_LABEL[msg.tag]) {
        meta.appendChild(el('span', { class: 'tag ' + TAG_CLASS[msg.tag], text: TAG_LABEL[msg.tag] }));
      }
      if (msg.demo) meta.appendChild(el('span', { class: 'tag demo', text: 'DEMO' }));
      if (msg.manual) meta.appendChild(el('span', { class: 'tag ext', text: '외부' }));
      body.appendChild(meta);
    }

    const bubbleClass = msg.tag === 'revision' ? 'final' : (msg.tag ? TAG_CLASS[msg.tag] : '');
    const bubble = el('div', { class: 'bubble' + (bubbleClass ? ' ' + bubbleClass : '') });
    if (isUser) {
      bubble.appendChild(el('div', { class: 'md plain', text: msg.text }));
    } else {
      const wrap = el('div', { class: 'md' });
      wrap.innerHTML = md.render(msg.text);
      bubble.appendChild(wrap);
    }
    body.appendChild(bubble);
    if (msg.copyText) {
      body.appendChild(el('button', {
        type: 'button',
        class: 'msg-copy-btn',
        text: '📋 지시문 복사',
        onclick: () => U.copyText(msg.copyText)
          .then(() => U.toast('복사했어요. 외부 AI에 붙여넣어 주세요.', 'ok'))
          .catch(() => U.toast('복사하지 못했어요. 지시문을 길게 눌러 선택해 주세요.'))
      }));
    }
    body.appendChild(el('div', { class: 'msg-stamp' }, [
      el('span', { text: U.timeLabel(msg.ts) }),
      isUser ? el('span', { text: '· 나' }) : null
    ]));

    const row = el('div', { class: 'msg' + (isUser ? ' me' : '') });
    if (!isUser) row.appendChild(avatar(agent, 's36'));
    row.appendChild(body);
    return row;
  }

  function dayDivider(ts) {
    return el('div', { class: 'day-divider' }, [el('span', { text: U.dayLabel(ts) })]);
  }

  function introNode() {
    const samples = [
      '부여 2박 3일 여행 일정 짜줘',
      'PETG 필라멘트 4롤 최저가 비교해줘',
      '다음 주 보고서 초안 잡아줘',
      '삼성전자 지금 사도 될까?'
    ];
    const node = el('div', { class: 'intro' }, [
      el('div', { class: 'intro-crown', text: '👑' }),
      el('h2', { text: '무엇이든 맡겨 보세요' }),
      el('p', { text: '대표 AI가 요청을 읽고, 주특기가 맞는 팀원에게 순서대로 일을 나눕니다. 결과는 대표 AI가 한 번 더 검토하고 결론을 정리해요.' }),
      el('div', { class: 'flow' }, [
        el('b', { text: '👑 작업 배분' }),
        el('i', { text: '→' }),
        el('b', { text: '담당 AI 실행' }),
        el('i', { text: '→' }),
        el('b', { text: '👑 검토·결론' })
      ]),
      el('div', { class: 'samples' }, samples.map((s) =>
        el('button', {
          type: 'button', class: 'sample-chip', text: s,
          onclick: () => { $('#input').value = s; autoGrow(); $('#input').focus(); }
        })
      ))
    ]);
    return node;
  }

  function renderMessages() {
    const box = $('#messages');
    const room = store.activeRoom();
    box.textContent = '';
    typingEl = null;
    lastDayKey = null;

    const flow = el('div', { class: 'msg-flow' });
    const hasUser = room.messages.some((m) => m.authorType === 'user');
    if (!hasUser) flow.appendChild(introNode());

    room.messages.forEach((msg) => {
      const key = U.dayKey(msg.ts);
      if (key !== lastDayKey) {
        flow.appendChild(dayDivider(msg.ts));
        lastDayKey = key;
      }
      flow.appendChild(messageNode(msg));
    });

    box.appendChild(flow);
    scrollToBottom(true);
    $('#messages').scrollTop = $('#messages').scrollHeight;
  }

  function appendMessage(msg, opts) {
    const stick = nearBottom();
    const box = $('#messages');
    let flow = box.querySelector('.msg-flow');
    if (!flow) { renderMessages(); flow = box.querySelector('.msg-flow'); }
    const intro = flow.querySelector('.intro');
    if (intro && msg.authorType === 'user') intro.remove();

    const key = U.dayKey(msg.ts);
    if (key !== lastDayKey) {
      flow.appendChild(dayDivider(msg.ts));
      lastDayKey = key;
    }
    const node = messageNode(msg);
    if (typingEl && typingEl.parentNode === flow) flow.insertBefore(node, typingEl);
    else flow.appendChild(node);

    scrollToBottom(stick);
  }

  function setTyping(agentId) {
    const box = $('#messages');
    let flow = box.querySelector('.msg-flow');
    if (!flow) return;
    if (typingEl) { typingEl.remove(); typingEl = null; }
    if (!agentId) return;
    const agent = agentOrGhost(agentId);
    typingEl = el('div', { class: 'msg' }, [
      avatar(agent, 's36'),
      el('div', { class: 'msg-body' }, [
        el('div', { class: 'msg-meta' }, [el('span', { class: 'who', text: agent.name })]),
        el('div', { class: 'bubble' }, [
          el('div', { class: 'typing' }, [el('span'), el('span'), el('span')])
        ])
      ])
    ]);
    flow.appendChild(typingEl);
    scrollToBottom(nearBottom());
  }

  function setStatus(text) {
    const bar = $('#statusBar');
    const cancel = $('#cancelBtn');
    if (!text) { bar.hidden = true; if (cancel) cancel.hidden = true; return; }
    bar.hidden = false;
    $('#statusText').textContent = text;
    if (cancel) cancel.hidden = false;
  }

  /* ---------------------------------------------------------
     대화 흐름
     --------------------------------------------------------- */

  function formatPlan(plan, lead) {
    const lines = [];
    if (plan.direct) {
      lines.push('**직접 호출** — ' + plan.plan);
      lines.push('');
      lines.push('요청하신 팀원에게 바로 일을 넘겼습니다. 결과가 모두 올라오면 제가 검토하고 결론을 정리할게요.');
      return lines.join('\n');
    }
    lines.push('**작업 배분** — ' + (plan.plan || '요청을 분석해 담당자를 정했습니다.'));
    lines.push('');
    plan.assignments.forEach((asg, i) => {
      const a = store.getAgent(asg.agentId);
      if (!a) return;
      lines.push((i + 1) + '. ' + a.emoji + ' **' + a.name + '** — ' + asg.task +
        (asg.reason ? ' _(' + asg.reason + ')_' : ''));
    });
    lines.push('');
    lines.push('순서대로 진행하고, 결과가 올라오면 제가 확인하겠습니다.');
    return lines.join('\n');
  }

  function buildCtx(room) {
    return {
      room,
      text: '',
      mentioned: [],
      status: (t) => setStatus(t),
      typing: (id) => setTyping(id),
      message: (m) => {
        const msg = store.addMessage(room, m);
        appendMessage(msg);
        if (msg.authorType === 'user' || msg.tag === 'final') renderSideStats();
      },
      plan: (plan, lead) => {
        const msg = store.addMessage(room, {
          authorType: 'agent', agentId: lead.id, tag: 'plan', text: formatPlan(plan, lead)
        });
        appendMessage(msg);
        renderHeader();
      },
      review: (review, lead) => {
        if (review.review) {
          const m1 = store.addMessage(room, {
            authorType: 'agent', agentId: lead.id, tag: 'review',
            text: '**검수 결과**\n\n' + review.review
          });
          appendMessage(m1);
        }
        if (review.final) {
          const m2 = store.addMessage(room, {
            authorType: 'agent', agentId: lead.id, tag: 'final', text: review.final
          });
          appendMessage(m2);
        }
        renderHeader();
      },
      done: () => {
        setStatus(null);
        setTyping(null);
        $('#sendBtn').disabled = false;
        renderHeader();
      }
    };
  }

  function renderSideStats() {
    renderRooms();
    renderHeader();
  }

  function parseMentions(text) {
    const found = [];
    store.state.agents.forEach((a) => {
      if (text.indexOf('@' + a.name) !== -1) found.push(a);
    });
    // 이름이 겹칠 때(예: '쇼핑'과 '쇼핑 도우미') 긴 이름 우선
    found.sort((a, b) => b.name.length - a.name.length);
    const unique = [];
    found.forEach((a) => {
      if (!unique.some((u) => u.id === a.id)) unique.push(a);
    });
    return unique;
  }

  function send() {
    const input = $('#input');
    const text = input.value.trim();
    if (!text) return;
    if (orch.isBusy()) {
      U.toast('아직 앞선 작업이 진행 중이에요. 끝나면 보내 주세요.');
      return;
    }
    const room = store.activeRoom();
    const mentioned = parseMentions(text);
    const lead = store.leadAgent();
    const externalTargets = mentioned.filter((a) => a.type === 'external');
    const apiMentioned = mentioned.filter((a) => a.type !== 'external');

    const msg = store.addMessage(room, { authorType: 'user', text });
    appendMessage(msg);
    input.value = '';
    autoGrow();
    hideMentionPopup();
    renderSideStats();

    // 외부 AI 호출 카드 (자동 호출 대신 복사·붙여넣기)
    const prompts = [];
    externalTargets.forEach((a) => {
      const prompt = buildExternalPrompt(a, room, text);
      prompts.push(prompt);
      const ctxCount = room.messages.filter((m) => m.authorType !== 'system').length;
      const card = store.addMessage(room, {
        authorType: 'agent',
        agentId: lead.id,
        tag: 'external',
        text: '**외부 AI 호출 — ' + a.emoji + ' ' + a.name + '**\n\n' +
          '이 AI는 링크·복붙으로 참여해요. 아래 **📋 지시문 복사**를 눌러 ' + a.name + '에 붙여넣고, ' +
          '받은 답변을 **⬆️ 외부 AI 답 올리기**로 이 방에 올려 주세요.\n\n' +
          '- 대상: ' + a.emoji + ' **' + a.name + '**' + (a.role ? ' — ' + a.role : '') + '\n' +
          '- 담긴 내용: 최근 대화 ' + Math.min(12, ctxCount) + '개 + 역할·지시문',
        copyText: prompt
      });
      appendMessage(card);
    });
    if (prompts.length) {
      U.copyText(prompts[0]).then(() => {
        U.toast(externalTargets[0].name + '에 붙여넣을 내용을 복사했어요.', 'ok', 3000);
      }).catch(() => {});
    }

    const apiTeam = store.apiTeam();
    const needRun = apiMentioned.length > 0 || (!externalTargets.length && apiTeam.length > 0);
    if (!needRun) {
      if (!externalTargets.length) {
        const notice = store.addMessage(room, {
          authorType: 'system',
          kind: 'error',
          text: '활성화된 팀원이 없어요. 사이드바에서 에이전트를 켜거나 설정에서 키를 확인해 주세요.'
        });
        appendMessage(notice);
      }
      renderHeader();
      input.focus();
      return;
    }

    $('#sendBtn').disabled = true;
    const ctx = buildCtx(room);
    ctx.text = text;
    ctx.mentioned = apiMentioned;
    orch.run(ctx).then(() => {
      input.focus();
    });
  }

  /* ---------------------------------------------------------
     입력창
     --------------------------------------------------------- */

  function autoGrow() {
    const ta = $('#input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 168) + 'px';
  }

  function insertMention(name) {
    const ta = $('#input');
    const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(start);
    const m = before.match(/@([^\s@]*)$/);
    const insert = '@' + name + ' ';
    if (m) {
      ta.value = before.slice(0, m.index) + insert + after;
    } else {
      const pad = before && !/\s$/.test(before) ? ' ' : '';
      ta.value = before + pad + insert + after;
    }
    ta.focus();
    const pos = ta.value.length - after.length;
    ta.setSelectionRange(pos, pos);
    autoGrow();
    hideMentionPopup();
  }

  function showMentionPopup(query) {
    const pop = $('#mentionPop');
    const q = (query || '').toLowerCase();
    mentionCandidates = store.state.agents.filter((a) =>
      !q || a.name.toLowerCase().indexOf(q) !== -1 || (a.role || '').toLowerCase().indexOf(q) !== -1
    ).slice(0, 8);

    if (!mentionCandidates.length) { hideMentionPopup(); return; }
    selectedMentionIndex = 0;
    pop.textContent = '';
    mentionCandidates.forEach((a, i) => {
      const item = el('button', {
        type: 'button', class: 'mention-item' + (i === 0 ? ' sel' : ''),
        onclick: (e) => { e.preventDefault(); insertMention(a.name); }
      }, [
        avatar(a, 's24'),
        el('span', { style: 'min-width:0;display:flex;flex-direction:column;align-items:flex-start' }, [
          el('span', { class: 'm-name', text: a.name + (a.isLead ? ' 👑' : '') }),
          el('span', { class: 'm-role', text: a.role || '' })
        ])
      ]);
      pop.appendChild(item);
    });
    pop.hidden = false;

    const rect = $('#composer').getBoundingClientRect();
    pop.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - 270)) + 'px';
    pop.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    pop.style.top = 'auto';
  }

  function hideMentionPopup() {
    $('#mentionPop').hidden = true;
    mentionCandidates = [];
  }

  function moveMention(dir) {
    if (!mentionCandidates.length) return;
    selectedMentionIndex = (selectedMentionIndex + dir + mentionCandidates.length) % mentionCandidates.length;
    U.$$('.mention-item', $('#mentionPop')).forEach((node, i) => {
      node.classList.toggle('sel', i === selectedMentionIndex);
      if (i === selectedMentionIndex) node.scrollIntoView({ block: 'nearest' });
    });
  }

  /* ---------------------------------------------------------
     모달
     --------------------------------------------------------- */

  function openModal(id) {
    const layer = document.getElementById(id);
    if (!layer) return;
    layer.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    const layer = document.getElementById(id);
    if (!layer) return;
    layer.hidden = true;
    if (!U.$$('.modal-layer:not([hidden])').length) document.body.style.overflow = '';
  }

  function confirmDialog(opts) {
    return new Promise((resolve) => {
      $('#confirmTitle').textContent = opts.title || '확인';
      $('#confirmText').textContent = opts.text || '';
      const yes = $('#confirmYes');
      yes.textContent = opts.yes || '확인';
      yes.className = 'btn ' + (opts.danger === false ? 'primary' : 'danger');
      openModal('confirmModal');

      const cleanup = (value) => {
        yes.removeEventListener('click', onYes);
        $('#confirmNo').removeEventListener('click', onNo);
        closeModal('confirmModal');
        resolve(value);
      };
      const onYes = () => cleanup(true);
      const onNo = () => cleanup(false);
      yes.addEventListener('click', onYes);
      $('#confirmNo').addEventListener('click', onNo);
    });
  }

  /* ----- 에이전트 모달 ----- */

  function fillEmojiPresets() {
    const host = $('#emojiPresets');
    host.textContent = '';
    EMOJIS.slice(0, 14).forEach((em) => {
      host.appendChild(el('button', {
        type: 'button', text: em, title: em,
        onclick: () => { $('#agentEmoji').value = em; }
      }));
    });
    const colors = $('#colorPresets');
    colors.textContent = '';
    COLORS.forEach((c) => {
      const b = el('button', { type: 'button', title: c });
      b.style.background = c;
      b.addEventListener('click', () => { $('#agentColor').value = c; });
      colors.appendChild(b);
    });
  }

  function setModelMode(mode) {
    U.$$('input[name="modelMode"]').forEach((r) => { r.disabled = false; r.checked = r.value === mode; });
    $('#customModel').hidden = mode !== 'custom';
  }

  function setAgentType(type) {
    U.$$('input[name="agentType"]').forEach((r) => { r.checked = r.value === type; });
    $('#apiModelBox').hidden = type === 'external';
    $('#externalBox').hidden = type !== 'external';
    $('#agentTypeHint').textContent = type === 'external'
      ? 'API 없이 [대화 복사]·[외부 AI 답 올리기]로 참여합니다.'
      : 'API 키로 이 방에서 자동으로 답합니다.';
  }

  function openAgentModal(id) {
    const agent = id ? store.getAgent(id) : null;
    editingAgentId = agent ? agent.id : null;
    fillEmojiPresets();

    $('#agentModalTitle').textContent = agent ? (agent.isLead ? '대표 AI 편집' : '에이전트 편집') : '새 에이전트';
    $('#agentEmoji').value = agent ? agent.emoji : '🤖';
    $('#agentColor').value = agent ? agent.color : '#7c5cff';
    $('#agentName').value = agent ? agent.name : '';
    $('#agentRole').value = agent ? agent.role : '';
    $('#agentInstructions').value = agent ? agent.instructions : '';
    $('#agentActive').checked = agent ? agent.active : true;
    $('#agentActive').disabled = !!(agent && agent.isLead);
    $('#activeRow').style.opacity = agent && agent.isLead ? '.6' : '';
    setAgentType(agent && agent.type === 'external' ? 'external' : 'api');
    $('#agentLink').value = agent ? (agent.link || '') : '';
    U.$$('input[name="agentType"]').forEach((r) => {
      r.disabled = !!(agent && agent.isLead) && r.value === 'external';
    });

    const model = (agent && agent.model) || { mode: 'shared', provider: 'gemini', model: '', apiKey: '' };
    setModelMode(model.mode === 'custom' ? 'custom' : 'shared');
    $('#agentProvider').value = model.provider || 'gemini';
    $('#agentModel').value = model.model || '';
    $('#agentApiKey').value = model.apiKey || '';

    $('#deleteAgentBtn').hidden = !agent || agent.isLead;
    $('#agentWarning').hidden = true;
    $('#agentApiKey').type = 'password';

    closeSidebar();
    openModal('agentModal');
    setTimeout(() => $('#agentName').focus(), 60);
  }

  function saveAgent() {
    const name = $('#agentName').value.trim();
    if (!name) { U.toast('이름을 입력해 주세요.'); $('#agentName').focus(); return; }
    const mode = (U.$('input[name="modelMode"]:checked') || {}).value || 'shared';
    const type = (U.$('input[name="agentType"]:checked') || {}).value || 'api';
    const existing = editingAgentId ? store.getAgent(editingAgentId) : null;
    const agent = store.normalizeAgent(Object.assign({}, existing || {}, {
      id: existing ? existing.id : U.uid('a'),
      name,
      emoji: $('#agentEmoji').value.trim() || '🤖',
      color: $('#agentColor').value || '#7c5cff',
      role: $('#agentRole').value.trim(),
      instructions: $('#agentInstructions').value.trim(),
      active: existing && existing.isLead ? true : $('#agentActive').checked,
      isLead: !!(existing && existing.isLead),
      type: existing && existing.isLead ? 'api' : type,
      link: $('#agentLink').value.trim(),
      model: {
        mode,
        provider: $('#agentProvider').value,
        model: $('#agentModel').value.trim(),
        apiKey: $('#agentApiKey').value.trim()
      }
    }));

    if (existing) {
      const idx = store.state.agents.findIndex((a) => a.id === existing.id);
      store.state.agents[idx] = agent;
    } else {
      store.state.agents.push(agent);
    }
    store.saveAgents();
    closeModal('agentModal');
    renderAll();
    U.toast(existing ? '에이전트를 수정했어요.' : '에이전트를 추가했어요.', 'ok');
  }

  async function deleteAgent() {
    const agent = store.getAgent(editingAgentId);
    if (!agent) return;
    if (agent.isLead) { U.toast('대표 AI는 삭제할 수 없어요.'); return; }
    const ok = await confirmDialog({
      title: '에이전트 삭제',
      text: '"' + agent.name + '"을(를) 팀에서 삭제할까요? 지난 대화 기록은 남습니다.',
      yes: '삭제'
    });
    if (!ok) return;
    store.state.agents = store.state.agents.filter((a) => a.id !== agent.id);
    store.saveAgents();
    closeModal('agentModal');
    renderAll();
    U.toast('삭제했어요.', 'ok');
  }

  /* ----- 설정 모달 ----- */

  function openSettings() {
    const s = store.state.settings;
    $('#demoToggle').checked = !!s.demoMode;
    $('#sharedProvider').value = s.shared.provider || 'gemini';
    $('#sharedModel').value = s.shared.model || '';
    $('#keyGemini').value = s.keys.gemini || '';
    $('#keyOpenai').value = s.keys.openai || '';
    $('#keyAnthropic').value = s.keys.anthropic || '';
    $('#enterToggle').checked = s.enterToSend !== false;
    $('#syncUrl').value = (s.sync && s.sync.url) || '';
    $('#syncRoomKey').value = (s.sync && s.sync.roomKey) || '';
    $('#syncTestResult').textContent = '';
    $('#syncTestResult').className = 'key-test-result';
    $('#keyTestResult').textContent = '';
    $('#keyTestResult').className = 'key-test-result';
    const total = store.state.rooms.reduce((n, r) => n + r.messages.length, 0);
    $('#storageInfo').textContent = '저장된 방 ' + store.state.rooms.length + '개 · 메시지 ' + total + '개';
    closeSidebar();
    openModal('settingsModal');
  }

  function readSettingsForm() {
    const s = store.state.settings;
    return Object.assign({}, s, {
      demoMode: $('#demoToggle').checked,
      enterToSend: $('#enterToggle').checked,
      shared: { provider: $('#sharedProvider').value, model: $('#sharedModel').value.trim() },
      keys: {
        gemini: $('#keyGemini').value.trim(),
        openai: $('#keyOpenai').value.trim(),
        anthropic: $('#keyAnthropic').value.trim()
      },
      sync: { url: $('#syncUrl').value.trim(), roomKey: $('#syncRoomKey').value.trim() }
    });
  }

  function saveSettings() {
    const next = readSettingsForm();
    if (!next.demoMode && !next.keys[next.shared.provider]) {
      U.toast((AIC.llm.LABEL[next.shared.provider] || next.shared.provider) +
        ' 키가 비어 있어요. 키를 넣거나 데모 모드를 켜 주세요.', 'err', 3400);
      return;
    }
    store.state.settings = next;
    store.saveSettings();
    applyTheme();
    closeModal('settingsModal');
    renderAll();
    U.toast(next.demoMode ? '데모 모드로 저장했어요.' : 'API 설정을 저장했어요.', 'ok');
  }

  async function resetData() {
    const ok = await confirmDialog({
      title: '모든 데이터 초기화',
      text: '모든 채팅방, 메시지, 에이전트 설정, API 키가 이 브라우저에서 삭제됩니다. 되돌릴 수 없어요.',
      yes: '초기화'
    });
    if (!ok) return;
    store.resetAll();
    closeModal('settingsModal');
    renderAll();
    U.toast('초기화했어요. 기본 팀으로 시작합니다.', 'ok');
  }

  async function testKey() {
    const btn = $('#testKeyBtn');
    const out = $('#keyTestResult');
    const settings = readSettingsForm();
    if (settings.demoMode) {
      out.textContent = '데모 모드에서도 테스트할 수 있어요(현재 설정된 키 사용).';
    }
    btn.disabled = true;
    out.className = 'key-test-result';
    out.textContent = '연결 확인 중…';
    try {
      const res = await AIC.llm.testConnection(settings);
      out.className = 'key-test-result ok';
      out.textContent = '연결 성공 · ' + res.provider + ' / ' + res.model + ' → "' + res.text.slice(0, 20) + '"';
    } catch (e) {
      out.className = 'key-test-result err';
      out.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  /* ----- 방 모달 ----- */

  function openRoomModal(mode, roomId) {
    pendingRoomAction = { mode, roomId };
    const room = roomId ? store.findRoom(roomId) : null;
    $('#roomModalTitle').textContent = mode === 'rename' ? '방 이름 변경' : '새 채팅방';
    $('#roomNameInput').value = room ? room.title : '';
    $('#saveRoomBtn').textContent = mode === 'rename' ? '변경' : '만들기';
    openModal('roomModal');
    setTimeout(() => { $('#roomNameInput').focus(); $('#roomNameInput').select(); }, 60);
  }

  function saveRoom() {
    const name = $('#roomNameInput').value.trim() || '새 단톡방';
    if (pendingRoomAction && pendingRoomAction.mode === 'rename') {
      store.updateRoom(pendingRoomAction.roomId, { title: name });
    } else {
      const room = store.newRoom(name);
      store.state.rooms.push(room);
      store.state.activeRoomId = room.id;
      store.saveRooms();
      store.saveActive();
      userScrolled = false;
    }
    closeModal('roomModal');
    renderAll();
  }

  function selectRoom(id) {
    if (orch.isBusy()) {
      U.toast('작업 중에는 방을 바꿀 수 없어요. 끝나면 이동할게요.');
      return;
    }
    store.state.activeRoomId = id;
    store.saveActive();
    userScrolled = false;
    renderAll();
    closeSidebar();
  }

  function deleteRoom(id) {
    const room = store.findRoom(id);
    if (!room) return;
    confirmDialog({
      title: '방 삭제',
      text: '"' + room.title + '" 방과 대화 ' + room.messages.length + '개를 삭제할까요? 되돌릴 수 없어요.',
      yes: '삭제'
    }).then((ok) => {
      if (!ok) return;
      store.state.rooms = store.state.rooms.filter((r) => r.id !== id);
      if (!store.state.rooms.length) store.state.rooms.push(store.newRoom('우리 팀 단톡방'));
      if (!store.findRoom(store.state.activeRoomId)) {
        store.state.activeRoomId = store.state.rooms[0].id;
      }
      store.saveRooms();
      store.saveActive();
      renderAll();
      U.toast('방을 삭제했어요.', 'ok');
    });
  }

  function clearRoom(id) {
    const room = store.findRoom(id);
    if (!room) return;
    confirmDialog({
      title: '대화 비우기',
      text: '"' + room.title + '"의 메시지 ' + room.messages.length + '개를 모두 지웁니다. 방은 그대로 남아요.',
      yes: '비우기'
    }).then((ok) => {
      if (!ok) return;
      room.messages = [];
      room.updatedAt = Date.now();
      store.saveRooms();
      renderAll();
      U.toast('대화를 비웠어요.', 'ok');
    });
  }

  /* ----- 내보내기 ----- */

  function exportRoom(room) {
    const lines = [];
    lines.push('# ' + room.title);
    lines.push('');
    lines.push('> AI 팀 단톡방 · ' + U.fullStamp(Date.now()) + ' 내보냄');
    lines.push('');
    lines.push('## 참여 AI');
    store.state.agents.forEach((a) => {
      lines.push('- ' + a.emoji + ' **' + a.name + '**' + (a.isLead ? ' (대표)' : '') + ' — ' + (a.role || ''));
    });
    lines.push('');
    lines.push('---');
    lines.push('');
    let day = null;
    room.messages.forEach((m) => {
      const dk = U.dayKey(m.ts);
      if (dk !== day) { day = dk; lines.push('## ' + U.dayLabel(m.ts)); lines.push(''); }
      if (m.authorType === 'system') {
        lines.push('> ' + m.text);
        lines.push('');
        return;
      }
      if (m.authorType === 'user') {
        lines.push('**나** · ' + U.timeLabel(m.ts));
        lines.push('');
        lines.push(m.text);
        lines.push('');
        return;
      }
      const a = agentOrGhost(m.agentId);
      const tag = m.tag && TAG_LABEL[m.tag] ? ' [' + TAG_LABEL[m.tag] + ']' : '';
      lines.push('### ' + a.emoji + ' ' + a.name + tag + ' · ' + U.timeLabel(m.ts));
      lines.push('');
      lines.push(m.text);
      lines.push('');
    });
    const safe = room.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'chat';
    U.download(safe + '.md', lines.join('\n'));
    U.toast('Markdown 파일로 내보냈어요.', 'ok');
  }

  /* ---------------------------------------------------------
     외부 AI 브리지 (링크·복붙 참여)
     --------------------------------------------------------- */

  function buildExternalPrompt(agent, room, extra) {
    const recent = room.messages.filter((m) => m.authorType !== 'system').slice(-12);
    const convo = recent.map((m) => {
      if (m.authorType === 'user') return '나: ' + m.text;
      const a = agentForMessage(m);
      return a.name + ': ' + m.text;
    }).join('\n\n');
    const lastUser = room.messages.slice().reverse().find((m) => m.authorType === 'user');
    const request = extra || (lastUser ? lastUser.text : '이 대화에 이어서 답해 주세요.');
    return '[AI 팀 단톡방]\n방: ' + room.title + '\n\n' +
      '너는 이 팀의 ' + agent.name + ' 역할이야.\n' +
      '역할: ' + (agent.role || '') + '\n' +
      (agent.instructions ? '지시사항: ' + agent.instructions + '\n' : '') +
      '\n--- 최근 대화 ---\n' + (convo || '(아직 없음)') +
      '\n\n--- 요청 ---\n' + request +
      '\n\n답변은 결론부터, Markdown으로 간결하게. 확인하지 못한 값은 추정이라고 밝혀 줘.';
  }

  function renderBridge() {
    const host = $('#bridgeAgents');
    if (!host) return;
    host.textContent = '';
    const ext = store.externalAgents().filter((a) => a.active);
    if (!ext.length) {
      host.appendChild(el('button', {
        type: 'button', class: 'bridge-chip',
        onclick: () => { openAgentModal(null); setAgentType('external'); }
      }, '＋ 외부 AI 추가'));
      return;
    }
    ext.slice(0, 3).forEach((a) => {
      host.appendChild(el('button', {
        type: 'button', class: 'bridge-chip',
        title: a.name + ' 호출 카드 만들기',
        onclick: () => openBridge(a.id)
      }, [
        el('span', { text: a.emoji }),
        a.name,
        el('span', { class: 'ext-dot' })
      ]));
    });
    if (ext.length > 3) {
      host.appendChild(el('span', { class: 'bridge-chip', text: '+' + (ext.length - 3) }));
    }
  }

  function bridgeTargets() {
    return store.state.agents
      .filter((a) => !a.isLead)
      .slice()
      .sort((a, b) => (a.type === 'external' ? 0 : 1) - (b.type === 'external' ? 0 : 1));
  }

  function openBridge(agentId) {
    const sel = $('#bridgeTarget');
    const targets = bridgeTargets();
    if (!targets.length) {
      U.toast('먼저 에이전트를 추가해 주세요.');
      openAgentModal(null);
      return;
    }
    sel.textContent = '';
    targets.forEach((a) => {
      sel.appendChild(el('option', {
        value: a.id,
        text: a.emoji + ' ' + a.name + (a.type === 'external' ? ' (외부)' : '')
      }));
    });
    const fallback = targets.find((a) => a.type === 'external') || targets[0];
    sel.value = agentId || fallback.id;
    $('#bridgeAnswer').value = '';
    $('#bridgeCopyHint').textContent = '';
    updateBridgePrompt();
    openModal('bridgeModal');
  }

  function updateBridgePrompt() {
    const agent = store.getAgent($('#bridgeTarget').value);
    if (!agent) return;
    $('#bridgePrompt').value = buildExternalPrompt(agent, store.activeRoom());
    const openBtn = $('#bridgeOpenBtn');
    if (agent.link) {
      openBtn.hidden = false;
      openBtn.dataset.link = agent.link;
    } else {
      openBtn.hidden = true;
      openBtn.dataset.link = '';
    }
  }

  function copyBridgePrompt() {
    const text = $('#bridgePrompt').value;
    if (!text) return;
    U.copyText(text).then(() => {
      $('#bridgeCopyHint').textContent = '복사했어요';
      U.toast('복사했어요. 외부 AI에 붙여넣어 주세요.', 'ok');
    }).catch(() => {
      $('#bridgeCopyHint').textContent = '복사 실패 — 직접 선택해 복사해 주세요';
    });
  }

  function copyThread() {
    const active = store.externalAgents().filter((a) => a.active);
    const agent = active[0] || store.externalAgents()[0];
    if (!agent) {
      U.toast('외부 AI를 먼저 추가해 주세요.');
      openAgentModal(null);
      setAgentType('external');
      return;
    }
    const prompt = buildExternalPrompt(agent, store.activeRoom());
    U.copyText(prompt).then(() => {
      U.toast(agent.name + '에 붙여넣을 대화·지시를 복사했어요.', 'ok', 3000);
    }).catch(() => {
      openBridge(agent.id);
    });
  }

  function postExternalAnswer() {
    const agent = store.getAgent($('#bridgeTarget').value);
    const text = $('#bridgeAnswer').value.trim();
    if (!agent) return;
    if (!text) {
      U.toast('답변을 붙여넣어 주세요.');
      $('#bridgeAnswer').focus();
      return;
    }
    const room = store.activeRoom();
    const msg = store.addMessage(room, {
      authorType: 'agent',
      agentId: agent.id,
      text,
      manual: true
    });
    appendMessage(msg);
    closeModal('bridgeModal');
    renderSideStats();
    U.toast(agent.name + '의 답변을 방에 올렸어요.', 'ok');
  }

  /* ----- 동기화 테스트 ----- */

  async function testSync() {
    const out = $('#syncTestResult');
    const btn = $('#syncTestBtn');
    out.className = 'key-test-result';
    out.textContent = '확인 중…';
    btn.disabled = true;
    try {
      const res = await AIC.sync.test({ url: $('#syncUrl').value, roomKey: $('#syncRoomKey').value });
      out.className = 'key-test-result ok';
      out.textContent = '연결 성공 · 서버 메시지 ' + res.count + '개';
    } catch (e) {
      out.className = 'key-test-result err';
      out.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function syncNow() {
    const out = $('#syncTestResult');
    const btn = $('#syncNowBtn');
    out.className = 'key-test-result';
    out.textContent = '동기화 중…';
    btn.disabled = true;
    try {
      const res = await AIC.sync.syncNow(store.activeRoom(), {
        url: $('#syncUrl').value,
        roomKey: $('#syncRoomKey').value
      });
      out.className = 'key-test-result ok';
      out.textContent = '완료 · 받음 ' + res.added + ' / 올림 ' + res.pushed;
      renderAll();
    } catch (e) {
      out.className = 'key-test-result err';
      out.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------------------------------------------------
     테마·사이드바
     --------------------------------------------------------- */

  function applyTheme() {
    const theme = store.state.settings.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#eef2f9' : '#080b12');
    $('#themeBtn').textContent = theme === 'light' ? '☾' : '☀';
  }

  function toggleTheme() {
    store.state.settings.theme = store.state.settings.theme === 'light' ? 'dark' : 'light';
    store.saveSettings();
    applyTheme();
  }

  function openSidebar() { document.body.classList.add('sidebar-open'); }
  function closeSidebar() { document.body.classList.remove('sidebar-open'); }

  /* ---------------------------------------------------------
     렌더
     --------------------------------------------------------- */

  function renderAll() {
    renderRooms();
    renderAgents();
    renderHeader();
    renderChips();
    renderBridge();
    renderMessages();
    applyTheme();
  }

  /* ---------------------------------------------------------
     이벤트
     --------------------------------------------------------- */

  function bind() {
    // 사이드바
    $('#menuBtn').addEventListener('click', openSidebar);
    $('#sidebarClose').addEventListener('click', closeSidebar);
    $('#scrim').addEventListener('click', closeSidebar);
    $('#newRoomBtn').addEventListener('click', () => openRoomModal('new'));
    $('#addAgentBtn').addEventListener('click', () => openAgentModal(null));
    $('#openSettingsBtn').addEventListener('click', openSettings);

    // 헤더
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#exportBtn').addEventListener('click', () => exportRoom(store.activeRoom()));
    $('#roomMenuBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('#roomMenu');
      if (!menu.hidden) { menu.hidden = true; return; }
      const r = e.currentTarget.getBoundingClientRect();
      menu.hidden = false;
      menu.style.top = (r.bottom + 6) + 'px';
      menu.style.left = Math.max(8, r.right - 200) + 'px';
    });
    $('#roomMenu').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-menu]');
      if (!btn) return;
      $('#roomMenu').hidden = true;
      const room = store.activeRoom();
      const action = btn.dataset.menu;
      if (action === 'rename') openRoomModal('rename', room.id);
      else if (action === 'export') exportRoom(room);
      else if (action === 'clear') clearRoom(room.id);
      else if (action === 'delete') deleteRoom(room.id);
    });
    document.addEventListener('click', () => { $('#roomMenu').hidden = true; hideMentionPopup(); });

    // 모달 닫기
    U.$$('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    U.$$('.modal-layer').forEach((layer) => {
      layer.addEventListener('mousedown', (e) => {
        if (e.target === layer && layer.id !== 'confirmModal') closeModal(layer.id);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        U.$$('.modal-layer:not([hidden])').forEach((l) => closeModal(l.id));
        $('#roomMenu').hidden = true;
        hideMentionPopup();
        closeSidebar();
      }
    });

    // 에이전트 모달
    $('#saveAgentBtn').addEventListener('click', saveAgent);
    $('#deleteAgentBtn').addEventListener('click', deleteAgent);
    U.$$('input[name="modelMode"]').forEach((r) => {
      r.addEventListener('change', () => setModelMode(r.value));
    });
    $('#agentProvider').addEventListener('change', () => {
      const p = $('#agentProvider').value;
      const map = { gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini', anthropic: 'claude-3-5-haiku-latest' };
      if (!$('#agentModel').value) $('#agentModel').value = map[p] || '';
    });
    ['agentName', 'agentEmoji', 'agentRole'].forEach((id) => {
      document.getElementById(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveAgent(); }
      });
    });

    // 외부 AI 브리지
    $('#copyThreadBtn').addEventListener('click', copyThread);
    $('#postExternalBtn').addEventListener('click', () => openBridge(null));
    $('#bridgeTarget').addEventListener('change', updateBridgePrompt);
    $('#bridgeCopyBtn').addEventListener('click', copyBridgePrompt);
    $('#postAnswerBtn').addEventListener('click', postExternalAnswer);
    $('#bridgeOpenBtn').addEventListener('click', (e) => {
      const link = e.currentTarget.dataset.link;
      if (link) window.open(link, '_blank', 'noopener');
    });
    U.$$('input[name="agentType"]').forEach((r) => {
      r.addEventListener('change', () => setAgentType(r.value));
    });

    // 설정 모달
    $('#syncTestBtn').addEventListener('click', testSync);
    $('#syncNowBtn').addEventListener('click', syncNow);
    $('#saveSettingsBtn').addEventListener('click', saveSettings);
    $('#resetDataBtn').addEventListener('click', resetData);
    $('#testKeyBtn').addEventListener('click', testKey);
    $('#sharedProvider').addEventListener('change', () => {
      const p = $('#sharedProvider').value;
      const map = { gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini', anthropic: 'claude-3-5-haiku-latest' };
      if (!$('#sharedModel').value) $('#sharedModel').value = map[p] || '';
    });

    // 방 모달
    $('#saveRoomBtn').addEventListener('click', saveRoom);
    $('#roomNameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveRoom(); }
    });

    // 입력창
    const form = $('#composer');
    form.addEventListener('submit', (e) => { e.preventDefault(); send(); });

    const ta = $('#input');
    ta.addEventListener('input', () => {
      autoGrow();
      const before = ta.value.slice(0, ta.selectionStart);
      const m = before.match(/@([^\s@]*)$/);
      if (m) showMentionPopup(m[1]); else hideMentionPopup();
    });
    ta.addEventListener('keydown', (e) => {
      if (!$('#mentionPop').hidden && mentionCandidates.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveMention(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveMention(-1); return; }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          insertMention(mentionCandidates[selectedMentionIndex].name);
          return;
        }
        if (e.key === 'Escape') { hideMentionPopup(); return; }
      }
      const enterSends = store.state.settings.enterToSend !== false;
      if (e.key === 'Enter' && !e.shiftKey && (enterSends || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send();
      }
    });
    ta.addEventListener('blur', () => setTimeout(hideMentionPopup, 140));

    $('#mentionBtn').addEventListener('click', () => {
      const ta2 = $('#input');
      const pos = ta2.selectionStart == null ? ta2.value.length : ta2.selectionStart;
      ta2.value = ta2.value.slice(0, pos) + '@' + ta2.value.slice(pos);
      ta2.focus();
      ta2.setSelectionRange(pos + 1, pos + 1);
      showMentionPopup('');
    });

    $('#cancelBtn').addEventListener('click', () => {
      orch.cancel();
      U.toast('중단 요청을 보냈어요.');
    });

    // 스크롤 상태
    $('#messages').addEventListener('scroll', () => {
      userScrolled = !nearBottom();
    });

    // 데스크톱 키보드 단축키
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/' && document.activeElement !== ta) {
        e.preventDefault();
        ta.focus();
      }
    });

    window.addEventListener('resize', () => {
      if (!$('#mentionPop').hidden) hideMentionPopup();
    });
  }

  AIC.ui = {
    init() {
      fillEmojiPresets();
      bind();
      renderAll();
      autoGrow();
    },
    renderAll,
    openAgentModal,
    openSettings,
    toast: U.toast
  };
})();
