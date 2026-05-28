// Blade Rondo — pure game logic (no DOM, no network).
// Both host and guest load this; only host runs it as authority.
window.Game = (() => {
  const CARDS = window.CARD_BY_ID;
  const COMMON_CARDS = window.COMMON_CARDS;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const now = () => new Date().toISOString().slice(11, 19);

  function createRoom(roomCode) {
    return {
      id: roomCode, phase: 'lobby', players: [],
      log: [], pending: null, currentTurn: 0,
      turnNumber: 0, firstPlayer: 0, isNight: false, winner: null
    };
  }

  function makePlayer(name) {
    return {
      name, deck: [], hand: [], discard: [], used: [],
      hp: 8, voltage: 2, atkBase: 2, defBase: 2,
      atkBuff: 0, defBuff: 0, nextDmgReduce: 0,
      magicDmgBonus: 0, _dmgReduceTurn: 0, _reviveTo2: false,
      ready: false, cannotHeal: false, poison: false,
      skipNextVoltage: false, extraVoltageThisTurn: 0
    };
  }

  function addPlayer(state, name) {
    state.players.push(makePlayer(name));
    log(state, `${name} 加入房間`);
    if (state.players.length === 2) state.phase = 'deck-select';
    return state.players.length - 1;
  }

  function log(state, text) {
    state.log.push(`[${now()}] ${text}`);
    if (state.log.length > 200) state.log.shift();
  }

  function publicView(state, viewerIdx) {
    return {
      phase: state.phase, roomId: state.id, isNight: state.isNight,
      turnNumber: state.turnNumber, currentTurn: state.currentTurn,
      firstPlayer: state.firstPlayer, winner: state.winner,
      pending: state.pending ? {
        attackerIdx: state.pending.attackerIdx,
        defenderIdx: state.pending.defenderIdx,
        cardId: state.pending.cardId,
        kind: state.pending.kind,
        baseDamage: state.pending.previewDamage,
        reactable: state.pending.reactable
      } : null,
      log: state.log.slice(-40),
      players: state.players.map((p, i) => ({
        idx: i, name: p.name, hp: p.hp, voltage: p.voltage,
        atk: clamp(p.atkBase + p.atkBuff, 0, 99),
        def: clamp(p.defBase + p.defBuff, 0, 9),
        handCount: p.hand.length,
        hand: i === viewerIdx ? p.hand : null,
        used: p.used, discard: p.discard,
        poison: p.poison, cannotHeal: p.cannotHeal,
        ready: p.ready, deckChosen: p.deck.length === 7
      }))
    };
  }

  // ---------- Match flow ----------
  function submitDeck(state, idx, deck) {
    if (state.phase !== 'deck-select') return err(state, '不在選牌階段');
    if (!Array.isArray(deck) || deck.length !== 7) return err(state, '請選 7 張');
    const seen = new Set();
    for (const id of deck) {
      if (seen.has(id)) return err(state, '卡牌重複');
      seen.add(id);
      const c = CARDS[id];
      if (!c || c.pack === 'common') return err(state, '無此卡或不可用：' + id);
    }
    state.players[idx].deck = deck;
    state.players[idx].ready = true;
    log(state, `${state.players[idx].name} 已準備好牌組`);
    if (state.players.length === 2 && state.players.every(p => p.ready)) startMatch(state);
  }

  function startMatch(state) {
    state.phase = 'playing';
    state.firstPlayer = Math.random() < 0.5 ? 0 : 1;
    state.currentTurn = state.firstPlayer;
    state.turnNumber = 1;
    state.isNight = false; state.pending = null; state.winner = null;
    state.players.forEach(p => {
      p.hand = [...p.deck, ...COMMON_CARDS.map(c => c.id)];
      p.discard = []; p.used = [];
      p.hp = 8; p.voltage = 2; p.atkBase = 2; p.defBase = 2;
      p.atkBuff = 0; p.defBuff = 0;
      p.poison = false; p.cannotHeal = false;
      p.nextDmgReduce = 0; p.magicDmgBonus = 0;
      p.skipNextVoltage = false; p.extraVoltageThisTurn = 0;
      p._dmgReduceTurn = 0; p._reviveTo2 = false;
    });
    log(state, `對戰開始！${state.players[state.firstPlayer].name} 先手。`);
    beginTurn(state);
  }

  function beginTurn(state) {
    if (state.phase !== 'playing') return;
    const p = state.players[state.currentTurn];
    if (!p.skipNextVoltage) p.voltage = clamp(p.voltage + 1, 0, 9);
    p.skipNextVoltage = false; p.extraVoltageThisTurn = 0;
    if (p.poison) { p.hp -= 1; log(state, `${p.name} 中毒 -1 HP。`); }
    p.atkBuff = 0; p.defBuff = 0; p.magicDmgBonus = 0;
    const stillUsed = [];
    for (const cid of p.used) {
      const c = CARDS[cid];
      if (c.restrict === 'L') p.discard.push(cid); else p.hand.push(cid);
    }
    p.used = [];
    state.isNight = (state.players[0].voltage + state.players[1].voltage) >= 12;
    log(state, `——— 回合 ${state.turnNumber}：${p.name} 開始（${state.isNight ? '月' : '日'}）———`);
    checkVictory(state);
  }

  function endTurn(state, idx) {
    if (state.phase !== 'playing') return err(state, '不在進行中');
    if (state.currentTurn !== idx) return err(state, '不是你的回合');
    if (state.pending) return err(state, '尚有未結算的攻擊');
    const p = state.players[idx];
    p.voltage = clamp(p.voltage + p.extraVoltageThisTurn, 0, 9);
    p.extraVoltageThisTurn = 0;
    log(state, `${p.name} 結束回合。`);
    state.currentTurn = 1 - state.currentTurn;
    if (state.currentTurn === state.firstPlayer) state.turnNumber++;
    beginTurn(state);
  }

  function checkVictory(state) {
    for (let i = 0; i < 2; i++) {
      if (state.players[i].hp <= 0) {
        state.players[i].hp = 0;
        state.winner = 1 - i;
        state.phase = 'game-over';
        log(state, `${state.players[1 - i].name} 獲勝！`);
        break;
      }
    }
  }

  function err(state, msg) { log(state, `⚠ ${msg}`); }

  // ---------- Card play ----------
  function playCard(state, idx, cardId, choice) {
    if (state.phase !== 'playing') return err(state, '不在對戰中');
    if (state.pending) return err(state, '等待反應結算中');
    if (state.currentTurn !== idx) return err(state, '不是你的回合');
    const p = state.players[idx];
    const card = CARDS[cardId];
    if (!card) return err(state, '無此卡');
    const inHand = p.hand.indexOf(cardId);
    if (inHand < 0) return err(state, '手牌沒有此卡');
    let cost = typeof card.cost === 'number' ? card.cost : 0;
    if (card.id === 'BC.2') cost = clamp(choice?.x || 1, 1, p.voltage);
    if (p.voltage < cost) return err(state, '魔力不足');
    p.voltage -= cost;
    p.hand.splice(inHand, 1);
    p.used.push(cardId);
    log(state, `${p.name} 使用「${card.namecn}」 (花費 ${cost})`);
    applyCardEffect(state, idx, cardId, cost, choice);
    checkVictory(state);
  }

  function applyCardEffect(state, idx, cardId, paidCost, choice) {
    const p = state.players[idx]; const opp = state.players[1 - idx];
    const card = CARDS[cardId]; const type = card.types[0];
    // Breath
    if (card.id === 'BC.1') { p.atkBuff += 1; log(state, `→ ${p.name} 攻擊力 +1（本回合）`); return; }
    if (card.id === 'BC.2') { p.defBuff += paidCost; log(state, `→ ${p.name} 防禦力 +${paidCost}（本回合）`); return; }
    if (card.id === 'BC.3') { p.voltage = clamp(p.voltage + 1, 0, 9); log(state, `→ ${p.name} 魔力 +1`); return; }
    if (type === 'attack') {
      let dmg = atkDamage(state, idx, cardId);
      let unstoppable = /無法被反應|無視防禦/.test(card.desc || '') || card.id === 'No.03';
      let ignoreDef = /無視防禦/.test(card.desc || '') || card.id === 'No.06' || card.id === 'No.85';
      queueAttack(state, idx, cardId, 'attack', dmg, { unstoppable, ignoreDef }); return;
    }
    if (type === 'magic') {
      let dmg = magicDamage(state, idx, cardId);
      queueAttack(state, idx, cardId, 'magic', dmg, { unstoppable: false, ignoreDef: true }); return;
    }
    if (type === 'stone') { log(state, `（${card.namecn} 為反應卡，請在對手攻擊時使用）`); return; }
    if (type === 'aid') applyAid(state, idx, cardId, paidCost, choice);
    if (type === 'special') applySpecial(state, idx, cardId, paidCost, choice);
  }

  function atkDamage(state, idx, cardId) {
    const p = state.players[idx]; const card = CARDS[cardId];
    let base = clamp(p.atkBase + p.atkBuff, 0, 99);
    if (card.id === 'No.25' && !state.isNight) base *= 2;
    if (card.id === 'No.46' || card.id === 'No.65') base *= 2;
    let bonus = 0; const d = card.desc || '';
    const m = d.match(/傷害\+(\d+)/); if (m) bonus += parseInt(m[1]);
    if (card.id === 'No.21' && state.isNight) bonus += 2;
    if (card.id === 'No.81' && base >= 7) bonus += 1;
    if (card.id === 'No.81' && base <= 6) bonus -= 1;
    if (card.id === 'No.86') bonus += 2;
    if (card.id === 'No.89') base += 1;
    if (card.id === 'No.90') { bonus += 3; if (p.hand.length === 0) bonus += 3; }
    return Math.max(0, base + bonus);
  }

  function magicDamage(state, idx, cardId) {
    const p = state.players[idx]; const opp = state.players[1 - idx];
    const card = CARDS[cardId]; const ds = card.descsp || '';
    const m = ds.match(/魔法攻擊（(\d+)/);
    let base = m ? parseInt(m[1]) : 1;
    if (card.id === 'No.09' && p.hand.length === 0) base = 6;
    if (card.id === 'No.10') base = Math.ceil(opp.hp / 2);
    if (card.id === 'No.11') base = opp.hp;
    if (card.id === 'No.50') base = p.discard.length * 2;
    if (card.id === 'No.69') base = 8;
    base += p.magicDmgBonus;
    return Math.max(0, base);
  }

  function queueAttack(state, attackerIdx, cardId, kind, dmg, opts) {
    const defenderIdx = 1 - attackerIdx;
    state.pending = {
      attackerIdx, defenderIdx, cardId, kind,
      previewDamage: dmg, rawDamage: dmg,
      reactable: !opts.unstoppable, ignoreDef: opts.ignoreDef
    };
    log(state, `→ ${state.players[attackerIdx].name} ${kind === 'magic' ? '魔法攻擊' : '物理攻擊'} ${CARDS[cardId].namecn} 預計 ${dmg} 點${opts.unstoppable ? '（無法反應）' : ''}`);
    if (!state.pending.reactable) resolveAttack(state);
  }

  function resolveAttack(state) {
    const pend = state.pending; if (!pend) return;
    const attacker = state.players[pend.attackerIdx];
    const defender = state.players[pend.defenderIdx];
    if (pend.invalidated) { log(state, `※ 攻擊被無效化`); state.pending = null; return; }
    let dmg = pend.previewDamage;
    if (pend.kind === 'attack' && !pend.ignoreDef) {
      const def = clamp(defender.defBase + defender.defBuff, 0, 9);
      dmg = Math.max(0, dmg - def);
    }
    if (defender.nextDmgReduce) { dmg = Math.max(0, dmg - defender.nextDmgReduce); defender.nextDmgReduce = 0; }
    if (defender._dmgReduceTurn) dmg = Math.max(0, dmg - defender._dmgReduceTurn);
    dmg = Math.max(0, dmg);
    defender.hp -= dmg;
    log(state, `※ ${defender.name} 受到 ${dmg} 點傷害（HP ${defender.hp + dmg} → ${defender.hp}）`);

    const cid = pend.cardId;
    if (cid === 'No.08') { attacker.hp -= 3; log(state, `代價：${attacker.name} -3 HP`); }
    if (cid === 'No.31') { attacker.hp -= 2; log(state, `代價：${attacker.name} -2 HP`); }
    if (cid === 'No.84') { attacker.hp -= 4; log(state, `代價：${attacker.name} -4 HP`); }
    if (cid === 'No.28' && state.isNight) healPlayer(state, pend.attackerIdx, dmg);
    if (cid === 'No.87') healPlayer(state, pend.attackerIdx, dmg);
    if (cid === 'No.04') { defender.poison = true; log(state, `${defender.name} 中毒`); }
    if (cid === 'No.26') { defender.cannotHeal = true; log(state, `${defender.name} 被刻印（無法回復）`); }
    if (cid === 'No.05' || cid === 'No.45' || cid === 'No.83') {
      if (defender.hand.length) {
        const i = Math.floor(Math.random() * defender.hand.length);
        const lost = defender.hand.splice(i, 1)[0];
        defender.discard.push(lost);
        log(state, `${defender.name} 被迫棄置「${CARDS[lost].namecn}」`);
      }
    }
    if (defender._reviveTo2 && defender.hp <= 0) {
      defender.hp = 2;
      log(state, `※ ${defender.name} 拒卻死亡，以 2 HP 復活`);
    }
    defender._reviveTo2 = false;
    state.players.forEach(p => p._dmgReduceTurn = 0);
    state.pending = null;
    checkVictory(state);
  }

  function healPlayer(state, idx, amount) {
    const p = state.players[idx];
    if (p.cannotHeal) { log(state, `${p.name} 被刻印，無法回復`); return; }
    const before = p.hp;
    p.hp = clamp(p.hp + amount, 0, 15);
    log(state, `${p.name} 恢復生命 ${before} → ${p.hp}`);
  }

  function applyAid(state, idx, cardId, paidCost, choice) {
    const p = state.players[idx]; const opp = state.players[1 - idx];
    switch (cardId) {
      case 'No.12': p.nextDmgReduce += 1; break;
      case 'No.13': healPlayer(state, idx, 4); break;
      case 'No.14': p.atkBuff += 2; break;
      case 'No.15': p.extraVoltageThisTurn += 1; break;
      case 'No.16': queueAttack(state, idx, cardId, 'attack', 10, { unstoppable: false, ignoreDef: false }); return;
      case 'No.30': p.defBuff += 2; p.atkBuff -= clamp(p.atkBase + p.atkBuff, 0, 99); break;
      case 'No.31': p.atkBuff += 1; p.hp -= 2; break;
      case 'No.32': p.extraVoltageThisTurn += 1; break;
      case 'No.33': if (state.isNight) p.atkBuff += 1; else p.defBuff += 1; break;
      case 'No.34': queueAttack(state, idx, cardId, 'attack', state.isNight ? 5 : 1, { unstoppable: false, ignoreDef: false }); return;
      case 'No.35': if (state.isNight) queueAttack(state, idx, cardId, 'magic', 2, { unstoppable: false, ignoreDef: true }); else healPlayer(state, idx, 1); return;
      case 'No.36': queueAttack(state, idx, cardId, 'attack', state.isNight ? 5 : 2, { unstoppable: false, ignoreDef: false }); return;
      case 'No.52': p.atkBuff += 1; break;
      case 'No.53': queueAttack(state, idx, cardId, 'magic', 1, { unstoppable: false, ignoreDef: true }); p.hp -= 1; return;
      case 'No.54': queueAttack(state, idx, cardId, 'attack', clamp(p.atkBase + p.atkBuff, 0, 99), { unstoppable: false, ignoreDef: false }); return;
      case 'No.55': p.magicDmgBonus += 1; break;
      case 'No.56': queueAttack(state, idx, cardId, 'magic', 4, { unstoppable: false, ignoreDef: true }); p.atkBuff += 2; return;
      case 'No.72': healPlayer(state, idx, 2); break;
      case 'No.73': if (p.hp < 8) { p.hp = 8; log(state, `→ 你的生命變為 8`); } else { opp.hp = 8; log(state, `→ 對手的生命變為 8`); } break;
      case 'No.74': queueAttack(state, idx, cardId, 'attack', clamp(p.atkBase + p.atkBuff, 0, 99), { unstoppable: false, ignoreDef: false }); return;
      case 'No.75': queueAttack(state, idx, cardId, 'magic', 1, { unstoppable: false, ignoreDef: true }); return;
      case 'No.76': if (p.hp > opp.hp) { opp.hp = 0; log(state, `※ 你的生命比對手多，立即勝利！`); checkVictory(state); } return;
      case 'No.93': healPlayer(state, idx, 2); break;
      case 'No.94': p.atkBuff = p.voltage - clamp(p.atkBase, 0, 99); break;
      case 'No.95': queueAttack(state, idx, cardId, 'magic', 2, { unstoppable: false, ignoreDef: true }); return;
      case 'No.96': queueAttack(state, idx, cardId, 'magic', 2, { unstoppable: false, ignoreDef: true }); p.magicDmgBonus += 1; return;
      default: log(state, `（${CARDS[cardId].namecn} 效果未完整實作，僅消耗COST）`);
    }
  }

  function applySpecial(state, idx, cardId, paidCost, choice) {
    const p = state.players[idx]; const sel = choice?.choice;
    switch (cardId) {
      case 'No.51':
        if (sel === 'heal') healPlayer(state, idx, 5);
        else if (sel === 'atk') p.atkBuff += 1;
        else if (sel === 'def') p.defBuff += 1;
        else p.extraVoltageThisTurn += 1; break;
      case 'No.70':
        if (sel === 'magic') queueAttack(state, idx, cardId, 'magic', 1, { unstoppable: false, ignoreDef: true });
        else queueAttack(state, idx, cardId, 'attack', clamp(p.atkBase + p.atkBuff, 0, 99), { unstoppable: false, ignoreDef: false });
        return;
      case 'No.71':
        if (sel === 'voltage') p.voltage = clamp(p.voltage + 1, 0, 9); else p.atkBuff += 1; break;
      case 'No.91':
        if (sel === 'magic') queueAttack(state, idx, cardId, 'magic', 2, { unstoppable: false, ignoreDef: true });
        else if (sel === 'heal') healPlayer(state, idx, 2);
        else queueAttack(state, idx, cardId, 'attack', clamp(p.atkBase + p.atkBuff, 0, 99), { unstoppable: false, ignoreDef: false });
        return;
      case 'No.92':
        if (sel === 'magic') queueAttack(state, idx, cardId, 'magic', 9, { unstoppable: true, ignoreDef: true });
        else queueAttack(state, idx, cardId, 'attack', clamp(p.atkBase + p.atkBuff, 0, 99) * 3, { unstoppable: true, ignoreDef: false });
        return;
    }
  }

  function reactStone(state, defenderIdx, cardId) {
    if (!state.pending) return err(state, '沒有可反應的攻擊');
    if (state.pending.defenderIdx !== defenderIdx) return err(state, '不是你被攻擊');
    if (!state.pending.reactable) return err(state, '此次攻擊無法被反應');
    const p = state.players[defenderIdx]; const card = CARDS[cardId];
    if (!card || !card.types.includes('stone')) return err(state, '不是反應卡');
    const inHand = p.hand.indexOf(cardId);
    if (inHand < 0) return err(state, '手牌沒有此卡');
    const cost = typeof card.cost === 'number' ? card.cost : 1;
    if (p.voltage < cost) return err(state, '魔力不足');
    p.voltage -= cost;
    p.hand.splice(inHand, 1);
    p.used.push(cardId);
    log(state, `${p.name} 反應「${card.namecn}」 (花費 ${cost})`);
    const pend = state.pending;
    switch (cardId) {
      case 'No.17': p._reviveTo2 = true; break;
      case 'No.18': p.defBuff += 3; break;
      case 'No.19': pend.previewDamage = Math.max(0, pend.previewDamage - 2); break;
      case 'No.20': case 'No.40': case 'No.80': pend.invalidated = true; break;
      case 'No.37': state.isNight = !state.isNight; healPlayer(state, defenderIdx, 2); break;
      case 'No.38': pend.previewDamage = 0; break;
      case 'No.39': p._dmgReduceTurn = (p._dmgReduceTurn||0) + 3; break;
      case 'No.57': case 'No.58': case 'No.77': case 'No.98': pend.invalidated = true; break;
      case 'No.59': if (pend.previewDamage <= 3) pend.previewDamage = 0; break;
      case 'No.60': pend.previewDamage = 1; break;
      case 'No.78': p._dmgReduceTurn = (p._dmgReduceTurn||0) + 2; break;
      case 'No.79': healPlayer(state, defenderIdx, 3); break;
      case 'No.97': pend.previewDamage = Math.max(0, pend.previewDamage - 1); break;
      case 'No.99': state.players[1 - defenderIdx].atkBuff -= 2; break;
      case 'No.100': p._dmgReduceTurn = (p._dmgReduceTurn||0) + 1; break;
    }
  }

  function passReaction(state, defenderIdx) {
    if (!state.pending) return;
    if (state.pending.defenderIdx !== defenderIdx) return;
    resolveAttack(state);
  }

  function rematch(state) {
    if (state.phase !== 'game-over') return;
    state.players.forEach(p => { p.deck = []; p.ready = false; });
    state.phase = 'deck-select';
    state.log = [];
    log(state, '再戰一場！請重新選牌。');
  }

  return { createRoom, addPlayer, submitDeck, playCard, reactStone, passReaction, endTurn, rematch, publicView, log };
})();
