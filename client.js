// client.js — UI + host/guest glue.
// Host: runs Game logic, broadcasts state via Net.
// Guest: sends actions via Net, renders the state host sends back.
(() => {
  const $ = (id) => document.getElementById(id);
  let game = null;          // host's authoritative Game state
  let viewState = null;     // last rendered public-view state (both sides)
  let myIdx = -1;           // 0 = host, 1 = guest
  let myName = 'P';
  let isHost = false;
  let roomCode = '';
  let deckPick = new Set();
  let activeFilter = 'all';
  let lastBroadcast = '';   // de-dup state hashes

  // ============ Networking ============
  function setStatus(text, cls = '') {
    const el = $('connState'); el.textContent = text; el.className = 'conn ' + cls;
  }

  function makeCode() {
    // 4 alphanumeric uppercase — short room code
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random()*chars.length)];
    return s;
  }

  function hostStart() {
    isHost = true; myIdx = 0;
    roomCode = makeCode();
    game = Game.createRoom(roomCode);
    Game.addPlayer(game, myName);
    setStatus(`連線中... 房號 ${roomCode}`);
    Net.connect(roomCode, 'host', null, {
      onConnect: () => {
        setStatus(`已連線 · 房號 ${roomCode}（等待對手加入）`, 'ok');
        broadcast();
        // Tell anyone subscribing that host exists
        Net.send({ type: 'host_announce', hostName: myName });
      },
      onMessage: hostOnMsg,
      onError: (e) => setStatus('錯誤：' + e, 'err'),
      onClose: () => setStatus('連線中斷', 'err')
    });
  }

  function guestStart(code) {
    isHost = false; myIdx = 1;
    roomCode = code.toUpperCase();
    setStatus(`連線中... 房號 ${roomCode}`);
    Net.connect(roomCode, 'guest', null, {
      onConnect: () => {
        setStatus(`已連線 · 房號 ${roomCode}（送出加入請求…）`, 'ok');
        // Repeatedly send guest_hello until we get a state back (host may not be ready yet)
        let tries = 0;
        const id = setInterval(() => {
          if (viewState) { clearInterval(id); return; }
          if (++tries > 8) { clearInterval(id); setStatus('找不到房間 / 主機', 'err'); return; }
          Net.send({ type: 'guest_hello', name: myName });
        }, 1500);
        Net.send({ type: 'guest_hello', name: myName });
      },
      onMessage: guestOnMsg,
      onError: (e) => setStatus('錯誤：' + e, 'err'),
      onClose: () => setStatus('連線中斷', 'err')
    });
  }

  // ----- Host receives -----
  function hostOnMsg(msg) {
    if (msg.type === 'guest_hello') {
      // Only add if no second player yet
      if (game.players.length < 2) {
        Game.addPlayer(game, msg.name || '對手');
        Game.log(game, `${msg.name || '對手'} 已連線。`);
      }
      broadcast();
      return;
    }
    if (msg.type === 'action') {
      const a = msg.action;
      if (a.kind === 'submit_deck') Game.submitDeck(game, 1, a.deck);
      else if (a.kind === 'play_card')  Game.playCard(game, 1, a.cardId, a.choice || {});
      else if (a.kind === 'react')      Game.reactStone(game, 1, a.cardId);
      else if (a.kind === 'pass_react') Game.passReaction(game, 1);
      else if (a.kind === 'end_turn')   Game.endTurn(game, 1);
      else if (a.kind === 'rematch')    Game.rematch(game);
      broadcast();
      return;
    }
    if (msg.type === 'chat') {
      // Relay back as-is for both sides to display
      const fromName = (game.players[1] && game.players[1].name) || '對手';
      $logChat(fromName, msg.text);
      return;
    }
  }

  // ----- Guest receives -----
  function guestOnMsg(msg) {
    if (msg.type === 'state') {
      viewState = msg.state;
      render();
      return;
    }
    if (msg.type === 'host_announce') {
      // Host is alive — re-send hello immediately if we haven't got state yet
      if (!viewState) Net.send({ type: 'guest_hello', name: myName });
      return;
    }
    if (msg.type === 'chat') {
      $logChat(msg.fromName || '對手', msg.text);
    }
  }

  // ----- Host broadcasts state -----
  function broadcast() {
    // host's own view
    viewState = Game.publicView(game, 0);
    render();
    // guest's view
    const guestView = Game.publicView(game, 1);
    const payload = JSON.stringify(guestView);
    if (payload !== lastBroadcast) {
      Net.send({ type: 'state', state: guestView });
      lastBroadcast = payload;
    }
  }

  // ----- Send action (guest) or apply locally (host) -----
  function action(kind, extra = {}) {
    if (isHost) {
      // apply locally as player 0
      if (kind === 'submit_deck') Game.submitDeck(game, 0, extra.deck);
      else if (kind === 'play_card')  Game.playCard(game, 0, extra.cardId, extra.choice || {});
      else if (kind === 'react')      Game.reactStone(game, 0, extra.cardId);
      else if (kind === 'pass_react') Game.passReaction(game, 0);
      else if (kind === 'end_turn')   Game.endTurn(game, 0);
      else if (kind === 'rematch')    Game.rematch(game);
      broadcast();
    } else {
      Net.send({ type: 'action', action: { kind, ...extra } });
    }
  }

  function $logChat(from, text) {
    const d = document.createElement('div'); d.textContent = `💬 ${from}: ${text}`;
    $('logList').appendChild(d); $('logList').scrollTop = $('logList').scrollHeight;
  }

  // ============ Lobby UI ============
  $('btnCreate').onclick = () => {
    myName = $('lobbyName').value.trim() || 'P1';
    hostStart();
  };
  $('btnJoin').onclick = () => {
    myName = $('lobbyName').value.trim() || 'P2';
    const code = ($('lobbyRoom').value || '').trim();
    if (!code) return alert('請輸入房間代碼');
    guestStart(code);
  };

  // ============ Deck pool ============
  function renderPool() {
    const pool = $('cardPool'); pool.innerHTML = '';
    for (const pack of window.RAW_CARD_DATA) {
      if (pack.id === 'common') continue;
      const sec = document.createElement('div'); sec.className = 'pack-section';
      const h = document.createElement('h3'); h.textContent = pack.name + (pack.namecn ? '  ' + pack.namecn : '');
      sec.appendChild(h);
      const grid = document.createElement('div'); grid.className = 'card-grid';
      for (const c of pack.list) {
        if (activeFilter !== 'all' && !c.types.includes(activeFilter)) continue;
        grid.appendChild(renderCardEl(c, { selected: deckPick.has(c.id), onClick: () => toggleDeckPick(c.id) }));
      }
      sec.appendChild(grid); pool.appendChild(sec);
    }
    $('selCount').textContent = deckPick.size;
    const sel = $('selectedList'); sel.innerHTML = '';
    for (const id of deckPick) {
      const c = window.CARD_BY_ID[id];
      const d = document.createElement('div'); d.className = 'chip-sel';
      d.innerHTML = `<button data-id="${id}" class="rm" style="margin-right:4px">×</button>${c.namecn} <small style="color:#888">(${c.cost})</small>`;
      d.querySelector('.rm').onclick = () => toggleDeckPick(id);
      sel.appendChild(d);
    }
    $('btnSubmitDeck').disabled = deckPick.size !== 7;
  }
  function toggleDeckPick(id) {
    if (deckPick.has(id)) deckPick.delete(id);
    else { if (deckPick.size >= 7) return alert('最多 7 張'); deckPick.add(id); }
    renderPool();
  }
  $('btnSubmitDeck').onclick = () => action('submit_deck', { deck: [...deckPick] });
  $('btnRandomDeck').onclick = () => {
    deckPick = new Set();
    const pool = [...window.ALL_CARDS];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [pool[i],pool[j]] = [pool[j],pool[i]]; }
    pool.slice(0, 7).forEach(c => deckPick.add(c.id));
    renderPool();
  };
  document.querySelectorAll('.ftype').forEach(b => b.onclick = () => {
    activeFilter = b.dataset.type;
    document.querySelectorAll('.ftype').forEach(x => x.classList.toggle('active', x === b));
    renderPool();
  });

  // ============ Card rendering ============
  function typeColor(types) { for (const t of ['attack','magic','aid','stone','special','breath']) if (types.includes(t)) return t; return 'attack'; }
  function renderCardEl(c, opt = {}) {
    const el = document.createElement('div'); el.className = 'gcard';
    if (opt.selected) el.classList.add('sel');
    if (opt.disabled) el.classList.add('disabled');
    const t = typeColor(c.types);
    el.innerHTML = `
      ${c.restrict === 'L' ? '<span class="restrict">L</span>' : ''}
      <div class="top"><span class="name">${c.namecn || c.name}</span><span class="cost">${c.cost}</span></div>
      <div class="typeline t-${t}">${c.descsp || typeLabel(t)}</div>
      <div class="desc">${(c.desc || '').replace(/\n/g, '<br>')}</div>
    `;
    if (opt.onClick) el.onclick = opt.onClick;
    el.onmouseenter = (e) => showTip(e, c);
    el.onmouseleave = () => $('cardTooltip').classList.add('hidden');
    return el;
  }
  function typeLabel(t) { return { attack:'物理攻擊', magic:'魔法攻擊', aid:'輔助', stone:'反應', special:'特殊', breath:'氣息' }[t] || ''; }
  function showTip(e, c) {
    const t = $('cardTooltip');
    t.innerHTML = `<b>${c.namecn}</b> <small>(${c.cost})</small><br><i>${c.descsp || ''}</i><br>${c.desc || ''}`;
    t.classList.remove('hidden');
    const r = e.target.getBoundingClientRect();
    t.style.left = (r.right + 8) + 'px'; t.style.top = r.top + 'px';
  }

  // ============ Render ============
  function render() {
    if (!viewState) return;
    if (viewState.phase === 'lobby') { showScreen('lobby'); return; }
    if (viewState.phase === 'deck-select') {
      showScreen('deckSelect');
      const me  = viewState.players[myIdx];
      const opp = viewState.players[1 - myIdx];
      $('opponentReady').textContent = opp ? (opp.ready ? '對手已選好牌！' : '等待對手選牌…') : '等待對手加入… 房間代碼：' + viewState.roomId;
      renderPool();
      return;
    }
    if (viewState.phase === 'playing' || viewState.phase === 'game-over') {
      showScreen('game');
      renderGame();
      if (viewState.phase === 'game-over') {
        $('gameOver').classList.remove('hidden');
        $('goText').textContent = viewState.winner === myIdx ? '🎉 你獲勝！' : (viewState.winner === null ? '平局' : '你輸了…');
      } else $('gameOver').classList.add('hidden');
    }
  }
  function showScreen(id) { ['lobby','deckSelect','game'].forEach(s => $(s).classList.toggle('hidden', s !== id)); }

  function renderGame() {
    const me  = viewState.players[myIdx]; const opp = viewState.players[1 - myIdx];
    $('meName').textContent  = me.name;
    $('oppName').textContent = opp.name;
    $('meHp').textContent   = me.hp;  $('meVolt').textContent  = me.voltage;
    $('meAtk').textContent  = me.atk; $('meDef').textContent   = me.def;
    $('oppHp').textContent  = opp.hp; $('oppVolt').textContent = opp.voltage;
    $('oppAtk').textContent = opp.atk;$('oppDef').textContent  = opp.def;
    $('meFirst').style.display  = viewState.firstPlayer === myIdx ? '' : 'none';
    $('oppFirst').style.display = viewState.firstPlayer !== myIdx ? '' : 'none';
    $('dayNight').textContent = viewState.isNight ? '🌙 月' : '☀ 日';
    $('turnInfo').textContent = `回合 ${viewState.turnNumber}　${viewState.currentTurn === myIdx ? '★ 你的回合' : '對手回合'}`;

    $('meStatus').innerHTML  = (me.poison ? '<span class="tag">中毒</span>' : '') + (me.cannotHeal ? '<span class="tag">刻印</span>' : '');
    $('oppStatus').innerHTML = (opp.poison ? '<span class="tag">中毒</span>' : '') + (opp.cannotHeal ? '<span class="tag">刻印</span>' : '');

    const meHand = $('meHand'); meHand.innerHTML = '';
    const myTurn = viewState.currentTurn === myIdx && viewState.phase === 'playing' && !viewState.pending;
    (me.hand || []).forEach(cid => {
      const c = window.CARD_BY_ID[cid];
      const disabled = !myTurn || me.voltage < (typeof c.cost === 'number' ? c.cost : 0) || c.types.includes('stone');
      meHand.appendChild(renderCardEl(c, { disabled, onClick: () => tryPlayCard(cid) }));
    });
    const oppHand = $('oppHand'); oppHand.innerHTML = '';
    for (let i = 0; i < opp.handCount; i++) {
      const d = document.createElement('div'); d.className = 'back'; d.textContent = '🂠';
      oppHand.appendChild(d);
    }
    $('meUsed').innerHTML  = (me.used||[]).map(id => `<span class="chip">${window.CARD_BY_ID[id].namecn}</span>`).join('') + (me.discard||[]).map(id => `<span class="chip" style="opacity:.5">⌫${window.CARD_BY_ID[id].namecn}</span>`).join('');
    $('oppUsed').innerHTML = (opp.used||[]).map(id => `<span class="chip">${window.CARD_BY_ID[id].namecn}</span>`).join('') + (opp.discard||[]).map(id => `<span class="chip" style="opacity:.5">⌫${window.CARD_BY_ID[id].namecn}</span>`).join('');

    $('btnEndTurn').disabled = !myTurn;

    if (viewState.pending) {
      $('pendingPanel').classList.remove('hidden');
      const p = viewState.pending; const c = window.CARD_BY_ID[p.cardId];
      const ame = p.attackerIdx === myIdx ? '你' : '對手';
      $('pendingText').innerHTML = `<b>${ame}</b> 使用「${c.namecn}」 → 預計 ${p.baseDamage} 點${p.kind === 'magic' ? '魔法' : '物理'}傷害` + (p.reactable ? '' : '（無法反應）');
      const ra = $('reactArea'); ra.innerHTML = '';
      if (p.defenderIdx === myIdx && p.reactable) {
        const stones = (me.hand||[]).filter(id => window.CARD_BY_ID[id].types.includes('stone') && me.voltage >= (window.CARD_BY_ID[id].cost || 1));
        stones.forEach(id => {
          const cd = window.CARD_BY_ID[id];
          const b = document.createElement('button');
          b.textContent = `反應：${cd.namecn} (${cd.cost})`;
          b.onclick = () => action('react', { cardId: id });
          ra.appendChild(b);
        });
        const pass = document.createElement('button'); pass.textContent = '不反應 / 結算傷害'; pass.style.background = '#cc6464';
        pass.onclick = () => action('pass_react');
        ra.appendChild(pass);
      } else if (p.defenderIdx === myIdx && !p.reactable) {
        const b = document.createElement('button'); b.textContent = '結算傷害';
        b.onclick = () => action('pass_react'); ra.appendChild(b);
      } else {
        ra.innerHTML = '<small style="color:#aaa">等待對手反應…</small>';
      }
    } else $('pendingPanel').classList.add('hidden');

    const ll = $('logList'); ll.innerHTML = '';
    viewState.log.forEach(l => { const d = document.createElement('div'); d.textContent = l; ll.appendChild(d); });
    ll.scrollTop = ll.scrollHeight;
  }

  function tryPlayCard(cid) {
    const c = window.CARD_BY_ID[cid];
    if (cid === 'BC.2') {
      const x = parseInt(prompt('支付幾點COST加防禦？', '1') || '0');
      if (!x) return;
      action('play_card', { cardId: cid, choice: { x } }); return;
    }
    if (c.types.includes('special')) {
      const opts = {
        'No.51': [['heal','慈雨：獲5生命'],['atk','怒濤：攻+1'],['def','清澄：防+1'],['voltage','渦動：回合末魔力+1']],
        'No.70': [['attack','物質：物理攻擊'],['magic','法術：魔法攻擊(1)']],
        'No.71': [['atk','狂奔之杯：攻+1'],['voltage','覺醒之蜜：魔力+1']],
        'No.91': [['attack','赤之物理攻擊'],['magic','青之魔法(2)'],['heal','綠之獲2生命']],
        'No.92': [['attack','萬節劍：攻擊力x3物理'],['magic','滅絕論：魔法(9)']],
      }[cid];
      if (opts) { askChoice(c.namecn, opts, (val) => action('play_card', { cardId: cid, choice: { choice: val } })); return; }
    }
    action('play_card', { cardId: cid, choice: {} });
  }
  function askChoice(title, opts, cb) {
    const m = $('choiceModal'); m.classList.remove('hidden');
    $('choiceTitle').textContent = title;
    const co = $('choiceOptions'); co.innerHTML = '';
    opts.forEach(([val, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => { m.classList.add('hidden'); cb(val); };
      co.appendChild(b);
    });
  }

  $('btnEndTurn').onclick = () => action('end_turn');
  $('btnRematch').onclick = () => action('rematch');
  $('btnChat').onclick = () => {
    const t = $('chatInput').value.trim();
    if (!t) return;
    Net.send({ type: 'chat', text: t, fromName: myName });
    $logChat(myName + '（我）', t);
    $('chatInput').value = '';
  };
  $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnChat').click(); });

  renderPool();
})();
