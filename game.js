// Blade Rondo — game logic, aligned with the 2018 official rulebook.
// Pure functions, no DOM, no network.
window.Game = (() => {
  const CARDS = window.CARD_BY_ID;
  if (CARDS['no.45'] && !CARDS['No.45']) CARDS['No.45'] = CARDS['no.45'];  // 原始資料大小寫不一致修正
  const COMMON = window.COMMON_CARDS; // [加熱法, 加護法, 鼓動法]
  const BC = { HEAT: 'BC.1', GUARD: 'BC.2', BEAT: 'BC.3' };

  // Persistent subordinates (NT expansion: 召喚 Y cards stay on the field).
  // Each entry describes what the subordinate is and what it does on its owner's turn-start.
  // action.kind: 'attack' (physical), 'magic', 'heal', 'damage_self', 'passive'
  const SUBORDINATE_TABLE = {
    'No.16': { name:'牛人',           atk:10, def:0, action:{kind:'attack',  dayDmg:10, nightDmg:10} },
    'No.33': { name:'人偶•音樂劇', isDoll:true,   atk:0,  def:0, action:{kind:'passive', dayDef:1, nightAtk:1} },
    'No.34': { name:'人偶•閒角', isDoll:true,     atk:1,  def:0, action:{kind:'attack',  dayDmg:1, nightDmg:5} },
    'No.35': { name:'人偶•滑稽劇', isDoll:true,   atk:0,  def:0, action:{kind:'dayheal_or_nightmagic', dayHeal:1, nightDmg:2} },
    'No.36': { name:'人偶•無賴傳', isDoll:true,   atk:2,  def:0, action:{kind:'attack',  dayDmg:2, nightDmg:5} },
    'No.52': { name:'奈迪',           atk:0,  def:1, coin:1, action:{kind:'passive', atkBonus:1, magicBonus:1} },
    'No.53': { name:'路尼亞',         atk:0,  def:1, coin:1, action:{kind:'magic_self_dmg', dmg:1, selfDmg:1} },
    'No.54': { name:'暗影',           atk:0,  def:2, coin:2, action:{kind:'attack_user_atk'} },
    'No.55': { name:'菲尤',           atk:0,  def:3, coin:3, action:{kind:'passive', magicBonus:1} },
    'No.56': { name:'高伐',           atk:9,  def:6, coin:6, action:{kind:'attack',  dayDmg:9, nightDmg:9} },
    'No.74': { name:'羅蒂',           atk:1,  def:2, action:{kind:'attack',  dayDmg:1, nightDmg:1} },
    'No.75': { name:'賽奴',           atk:0,  def:3, action:{kind:'magic',   dmg:1} },
    'No.76': { name:'多莉亞娜',       atk:0,  def:5, action:{kind:'win_if_higher'} },
    'No.95': { name:'奈斯提可亞',     atk:0,  def:2, action:{kind:'passive', physToMagic:2} },
    'No.96': { name:'莉潔卡',         atk:0,  def:4, action:{kind:'magic',   dmg:2} },
  };

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const now = () => new Date().toISOString().slice(11, 19);

  // ---------- State factory ----------

  // ----- Attachment helpers -----

  // ----- Multi-target choice helpers (Wave 3) -----
  function requirePick(state, opts) {
    // opts = { forIdx, sourcePlayer, type: 'pick_hand_card'|'pick_subordinate', count, cardId, prompt, action, options, chainStep? }
    state.pendingChoice = opts;
    log(state, `❓ ${state.players[opts.forIdx].name} 需要選擇：${opts.prompt}`);
  }

  function respondChoice(state, idx, selectedIds) {
    if (!state.pendingChoice) return err(state, '沒有等待中的選擇');
    if (state.pendingChoice.forIdx !== idx) return err(state, '不是你要選');
    const pc = state.pendingChoice;
    const sel = Array.isArray(selectedIds) ? selectedIds : [selectedIds];
    if (sel.length > pc.count) return err(state, `最多選 ${pc.count} 張`);
    state.pendingChoice = null;

    // Apply action
    switch (pc.action) {
      case 'discard_hand_from': {
        const src = state.players[pc.sourcePlayer];
        for (const cid of sel) {
          const i = src.hand.indexOf(cid);
          if (i >= 0) {
            src.hand.splice(i, 1);
            src.discard.push(cid);
            log(state, `${src.name} 棄置「${(CARDS[cid]||{}).namecn||cid}」`);
          }
        }
        break;
      }
      case 'discard_subordinate_from': {
        const src = state.players[pc.sourcePlayer];
        for (const cid of sel) {
          const j = src.subordinates.findIndex(s => s.cardId === cid);
          if (j >= 0) {
            const sub = src.subordinates.splice(j, 1)[0];
            src.discard.push(sub.cardId);
            log(state, `${src.name} 的配下「${sub.name}」被棄置`);
          }
        }
        break;
      }
      case 'reveal_then_attacker_picks_one': {
        // Chain step 2: now attacker picks 1 from the revealed cards
        if (sel.length === 0) break;
        const attackerIdx = pc.chainStep?.attackerIdx;
        if (attackerIdx == null) break;
        requirePick(state, {
          forIdx: attackerIdx,
          sourcePlayer: pc.sourcePlayer,
          type: 'pick_from_list',
          count: 1,
          cardId: pc.cardId,
          prompt: `從對手公開的 ${sel.length} 張中選 1 張棄置`,
          action: 'discard_hand_from',
          options: sel
        });
        return;
      }
      case 'mulligan_double_else_quad': {
        // No.65: opp picks 2 to discard → damage ×2; else ×4
        const pend = state.pending;
        if (!pend) break;
        if (sel.length === 2) {
          const src = state.players[pc.sourcePlayer];
          for (const cid of sel) {
            const i = src.hand.indexOf(cid);
            if (i >= 0) { src.hand.splice(i,1); src.discard.push(cid); }
          }
          pend.previewDamage *= 2;
          log(state, `${src.name} 棄置 2 張，傷害 ×2 = ${pend.previewDamage}`);
        } else {
          pend.previewDamage *= 4;
          log(state, `不棄置，傷害 ×4 = ${pend.previewDamage}`);
        }
        break;
      }
      case 'sacrifice_doll_refund': {
        if (sel.length === 0) break;
        const p = state.players[pc.sourcePlayer];
        const j = p.subordinates.findIndex(sub => sub.cardId === sel[0] && sub.isDoll);
        if (j >= 0) {
          const sub = p.subordinates.splice(j, 1)[0];
          p.discard.push(sub.cardId);
          const refund = CARDS[sub.cardId]?.cost || 0;
          p.costSpent = Math.max(0, p.costSpent - refund);
          log(state, `🎴 錬成：棄置人偶「${sub.name}」，退回 ${refund} 點魔力 (本回合)`);
        }
        break;
      }

      case 'reuse_card': {
        const yes = sel[0] === 'yes';
        const p = state.players[idx];
        const cardId = pc.cardId;
        if (yes && p.voltage - p.costSpent >= 1 && !p.reusedThisTurn.has(cardId)) {
          p.costSpent += 1;
          p.reusedThisTurn.add(cardId);
          log(state, `${p.name} 付 1 cost 再次使用「${(CARDS[cardId]||{}).namecn||cardId}」`);
          // Trigger attack again
          queueAttack(state, idx, cardId, 'attack', ATK(state,idx), {});
        }
        break;
      }
      case 'discard_set_then_reuse_42': {
        const p = state.players[idx];
        const ref = sel[0];
        let discardedCoin = 0;
        if (ref && ref.startsWith('TOKEN:')) {
          const tIdx = parseInt(ref.split(':')[1]);
          const tok = p.tokens.splice(tIdx, 1)[0];
          if (tok) { p.discard.push(tok.cardId); discardedCoin = tok.coin; log(state,`絢爛劍：棄置 token ${tok.name}`); }
        } else if (ref) {
          const j = p.subordinates.findIndex(sub => sub.cardId === ref);
          if (j >= 0) { const sub = p.subordinates.splice(j,1)[0]; p.discard.push(sub.cardId); discardedCoin = sub.coin; log(state,`絢爛劍：棄置配下「${sub.name}」`); }
        }
        if (discardedCoin > 0 && !p.reusedThisTurn.has('No.42')) {
          p.reusedThisTurn.add('No.42');
          log(state, `絢爛劍：0 cost 再用`);
          queueAttack(state, idx, 'No.42', 'attack', ATK(state, idx), { noChainTrigger:true });
        }
        break;
      }
      case 'execute_doll_night': {
        const target = state.players[pc.sourcePlayer].subordinates.find(sub => sub.cardId === sel[0] && sub.isDoll);
        if (target) {
          // Force night execution — temporarily flip isNight
          const wasNight = state.isNight;
          state.isNight = true;
          // Reuse triggerSubordinates logic for just this one
          const tempSubs = [target];
          const realSubs = state.players[pc.sourcePlayer].subordinates;
          state.players[pc.sourcePlayer].subordinates = tempSubs;
          triggerSubordinates(state, pc.sourcePlayer);
          state.players[pc.sourcePlayer].subordinates = realSubs;
          state.isNight = wasNight;
          log(state, `🎭 指揮劍：執行人偶「${target.name}」[月] 行動`);
        }
        break;
      }
      case 'renseion_choice_value': {
        // No.85: 錬成 cost 1 (無視反應) / 5 (無視防禦) / skip
        const pend = state.pending;
        const choice = sel[0];
        const p = state.players[idx];
        if (choice === 'no_react' && p.voltage - p.costSpent >= 1) {
          p.costSpent += 1;
          if (pend) pend.reactable = false;
          log(state, `錬成 1 cost：本攻擊無法反應`);
        } else if (choice === 'no_def' && p.voltage - p.costSpent >= 5) {
          p.costSpent += 5;
          if (pend) pend.ignoreDef = true;
          log(state, `錬成 5 cost：本攻擊無視防禦`);
        }
        break;
      }
    }
    checkVictory(state);
  }

  function attach(state, idx, kind, extra = {}) {
    state.players[idx].attachments.push({ kind, ...extra });
    log(state, `📎 ${state.players[idx].name} 被付與【${kind}】`);
  }
  function hasAttach(state, idx, kind) {
    return state.players[idx].attachments.some(a => a.kind === kind);
  }
  function removeAttach(state, idx, kind) {
    const arr = state.players[idx].attachments;
    const i = arr.findIndex(a => a.kind === kind);
    if (i >= 0) arr.splice(i, 1);
  }

  function createRoom(roomCode) {
    return {
      id: roomCode, phase: 'lobby', players: [],
      log: [], pending: null, currentTurn: 0,
      turnNumber: 0, firstPlayer: 0, isNight: false, winner: null
    };
  }
  function makePlayer(name) {
    return {
      name,
      deck: [],           // 7 chosen sword cards (set during deck-select)
      hand: [],           // sword cards currently in hand
      breath: [],         // breath cards face-up in front (加熱法/加護法/鼓動法)
      breathUsed: [],     // breath cards used this turn (return to breath at turn end)
      used: [],           // sword cards face-up in play area this turn
      setArea: [],        // face-down response cards (carry across turns)
      discard: [],        // L cards permanently used
      hp: 8, voltage: 0, atkBase: 0, defBase: 0,
      atkBuff: 0, defBuff: 0,
      costSpent: 0,       // total cost spent THIS turn (must be ≤ voltage)
      nextDmgReduce: 0,   // 燐火-style buffered reduction
      magicDmgBonus: 0,   // 漩渦/狂想
      _dmgReduceTurn: 0,  // per-incoming-attack temp
      _reviveTo2: false,  // 拒卻死亡 set
      ready: false, cannotHeal: false, poison: false,
      extraVoltageThisTurn: 0,  // 加速之輪舞曲 etc.
      subordinates: [],   // [{cardId, name, atk, def, coin, action}] — NT 配下
      attachments: [],    // [{kind, sourceCard, ownerIdx, ...}] — 付與效果
      coatDef: 0,         // [外套] this-turn DEF (returns to hand at own turn start)
      coatActive: false,  // 包裹之波萊羅 (attack→0)
      frozenCards: [],    // [DEPRECATED v7] kept for compat
      frozen: [],         // [v8] 凍結設置區：打出凍結卡先放這，之後可免費啟動
      ravenBonus: 0,      // 暗鴉：下一次物理攻擊 +1
      magicBonusOnceThisTurn: 0,  // 漩渦：本回合魔法傷害+1
      reusedThisTurn: new Set(),  // 用來避免無限再用
      sealed: new Set(),          // 封印之瑪瑙：禁用同名卡
      responseCostDiscount: 0,    // 紋章劍：本回合反應卡 cost -N
      magicCountThisTurn: 0,      // 風暴之菖蒲：本回合已魔法攻擊次數
      tokens: []                  // 徵稅劍：付與帶 COIN 的代用 token
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
  function err(state, msg) { log(state, `⚠ ${msg}`); }

  // ---------- Public view (sent to a viewer) ----------
  function publicView(state, viewerIdx) {
    return {
      phase: state.phase, roomId: state.id, isNight: state.isNight,
      turnNumber: state.turnNumber, currentTurn: state.currentTurn,
      firstPlayer: state.firstPlayer, winner: state.winner,
      pendingChoice: state.pendingChoice && state.pendingChoice.forIdx === viewerIdx ? state.pendingChoice : (state.pendingChoice ? { forIdx: state.pendingChoice.forIdx, prompt: '對手選擇中…' } : null),
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
        costSpent: p.costSpent,
        budget: Math.max(0, p.voltage - p.costSpent),
        handCount: p.hand.length,
        hand: i === viewerIdx ? p.hand : null,
        breath: p.breath,
        breathUsed: p.breathUsed,
        used: p.used,
        // Stones face-down: opponent only sees count, viewer sees the cards
        setArea: i === viewerIdx ? p.setArea : null,
        setCount: p.setArea.length,
        discard: p.discard,
        subordinates: p.subordinates.map(s => ({ cardId: s.cardId, name: s.name, atk: s.atk, def: s.def, coin: s.coin || 0, isDoll: !!s.isDoll })),
        coinTotal: p.subordinates.reduce((sum, s) => sum + (s.coin || 0), 0) + (p.tokens||[]).reduce((sum, t) => sum + (t.coin||0), 0),
        frozen: i === viewerIdx ? p.frozen : [],
        frozenCount: p.frozen.length,
        attachments: p.attachments.map(a => ({ kind: a.kind, src: a.sourceCard })),
        sealed: [...p.sealed],
        tokens: p.tokens,
        responseCostDiscount: p.responseCostDiscount || 0,
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
    state.players.forEach((p, i) => {
      p.hand = [...p.deck];
      p.breath = [BC.HEAT, BC.GUARD];
      p.breathUsed = []; p.used = []; p.setArea = []; p.discard = [];
      p.hp = 8; p.voltage = 0; p.atkBase = 0; p.defBase = 0;
      p.atkBuff = 0; p.defBuff = 0; p.costSpent = 0;
      p.poison = false; p.cannotHeal = false;
      p.nextDmgReduce = 0; p.magicDmgBonus = 0;
      p._dmgReduceTurn = 0; p._reviveTo2 = false;
      p.extraVoltageThisTurn = 0;
      p.subordinates = [];
      p.attachments = []; p.coatDef = 0; p.coatActive = false;
      p.frozenCards = []; p.frozen = []; p.ravenBonus = 0; p.magicBonusOnceThisTurn = 0;
      p.reusedThisTurn = new Set();
      p.sealed = new Set();
      p.responseCostDiscount = 0;
      p.magicCountThisTurn = 0;
      p.tokens = [];
    });
    // 後攻 compensation: ATK=1, get 鼓動法
    const secondIdx = 1 - state.firstPlayer;
    state.players[secondIdx].atkBase = 1;
    state.players[secondIdx].breath.push(BC.BEAT);
    log(state, `對戰開始！${state.players[state.firstPlayer].name} 先手；${state.players[secondIdx].name} 後攻獲得 +1 攻擊力與「鼓動法」。`);
    beginTurn(state);
  }


  function triggerSubordinates(state, idx) {
    const p = state.players[idx]; const opp = state.players[1 - idx];
    for (const sub of p.subordinates) {
      const a = sub.action;
      if (!a) continue;
      switch (a.kind) {
        case 'attack': {
          const dmg = state.isNight ? a.nightDmg : a.dayDmg;
          // Subordinate's physical attack — uses subordinate's ATK, subject to opp DEF
          // For simplicity we treat dmg as a fixed amount minus opp DEF
          const def = clamp(opp.defBase + opp.defBuff, 0, 9);
          const final = Math.max(0, dmg - def);
          opp.hp -= final;
          log(state, `🐂 ${p.name} 的「${sub.name}」物理攻擊：${final} 傷害`);
          break;
        }
        case 'magic': {
          opp.hp -= a.dmg;
          log(state, `✨ ${p.name} 的「${sub.name}」魔法攻擊：${a.dmg} 傷害`);
          break;
        }
        case 'magic_self_dmg': {
          opp.hp -= a.dmg; p.hp -= a.selfDmg;
          log(state, `✨ ${p.name} 的「${sub.name}」魔法 ${a.dmg}，自身 -${a.selfDmg}`);
          break;
        }
        case 'attack_user_atk': {
          const base = clamp(p.atkBase + p.atkBuff, 0, 99);
          const def = clamp(opp.defBase + opp.defBuff, 0, 9);
          const final = Math.max(0, base - def);
          opp.hp -= final;
          log(state, `🗡 ${p.name} 的「${sub.name}」自走攻擊：${final} 傷害`);
          break;
        }
        case 'dayheal_or_nightmagic': {
          if (state.isNight) { opp.hp -= a.nightDmg; log(state, `🎭 ${p.name} 的「${sub.name}」赤焰魔法：${a.nightDmg} 傷害`); }
          else { healPlayer(state, idx, a.dayHeal); }
          break;
        }
        case 'passive': {
          if (a.atkBonus)   { p.atkBuff += a.atkBonus;   log(state, `🛡 ${sub.name} 加成：${p.name} 攻擊力 +${a.atkBonus}`); }
          if (a.magicBonus) { p.magicDmgBonus += a.magicBonus; log(state, `🛡 ${sub.name} 加成：${p.name} 魔法傷害 +${a.magicBonus}`); }
          if (state.isNight && a.nightAtk) { p.atkBuff += a.nightAtk; log(state, `🌙 ${sub.name}（夜）：${p.name} 攻擊力 +${a.nightAtk}`); }
          if (!state.isNight && a.dayDef)  { p.defBuff += a.dayDef;  log(state, `☀ ${sub.name}（晝）：${p.name} 防禦力 +${a.dayDef}`); }
          break;
        }
        case 'win_if_higher': {
          if (p.hp > opp.hp) { opp.hp = 0; log(state, `※ ${sub.name}：你的生命比對手多，立即勝利！`); }
          break;
        }
      }
      checkVictory(state);
      if (state.phase !== 'playing') return;
    }
  }

  function beginTurn(state) {
    if (state.phase !== 'playing') return;
    const p = state.players[state.currentTurn];

    // Reset per-turn budget & buffs (buffs persisted only "本回合", so reset at own turn start)
    p.costSpent = 0;
    p.atkBuff = 0; p.defBuff = 0; p.magicDmgBonus = 0;

    p.magicBonusOnceThisTurn = 0;
    p.reusedThisTurn = new Set();
    p.responseCostDiscount = 0;
    p.magicCountThisTurn = 0;
    // 包裹之波萊羅：回合開始時返回手牌
    if (p.coatActive) {
      p.coatActive = false; p.coatDef = 0;
      // The card itself is in attachments; remove and return
      const coat = p.attachments.find(a => a.kind === '外套');
      if (coat) { removeAttach(state, state.currentTurn, '外套'); p.hand.push(coat.sourceCard); log(state, `🧥 ${p.name}「外套」回到手牌`); }
    }
    // Return THIS player's face-down stones still on field — opponent's-turn-end rule:
    // (Strictly the rule fires at end of opponent's turn = before our beginTurn.
    //  Easier place to apply the cleanup.)
    if (p.setArea.length > 0) {
      for (const cid of p.setArea) p.hand.push(cid);
      log(state, `${p.name} 未使用的反應卡 ${p.setArea.length} 張回到手牌`);
      p.setArea = [];
    }

    // Voltage gain — at 9, lose 1 life instead
    if (p.voltage >= 9) { p.hp -= 1; log(state, `⚡ ${p.name} 魔力已滿 (9)，回合開始改受 1 點傷害`); }
    else p.voltage = clamp(p.voltage + 1, 0, 9);

    // Poison
    if (p.poison) { p.hp -= 1; log(state, `🩸 ${p.name} 中毒失 1 生命`); }
    // 鈍痛 attachment: pay 1 cost or discard it
    while (hasAttach(state, state.currentTurn, '鈍痛')) {
      if (p.voltage - p.costSpent >= 1) {
        p.costSpent += 1;
        removeAttach(state, state.currentTurn, '鈍痛');
        log(state, `${p.name} 鈍痛：支付 1 cost 解除`);
      } else {
        removeAttach(state, state.currentTurn, '鈍痛');
        log(state, `${p.name} 鈍痛：魔力不足，自動解除`);
      }
    }

    // Day / night: total voltage ≥ 12 (Night Theater expansion)
    state.isNight = (state.players[0].voltage + state.players[1].voltage) >= 12;
    // NT: trigger persistent subordinates' turn-start actions
    triggerSubordinates(state, state.currentTurn);
    if (state.phase !== 'playing') return;
    log(state, `——— 回合 ${state.turnNumber}：${p.name} 開始（${state.isNight ? '月' : '日'}）———`);
    checkVictory(state);
  }

  function endTurn(state, idx) {
    if (state.phase !== 'playing') return err(state, '不在進行中');
    if (state.currentTurn !== idx) return err(state, '不是你的回合');
    if (state.pending) return err(state, '尚有未結算的攻擊');
    const p = state.players[idx];

    // Apply end-of-turn bonus voltage (e.g. 加速之輪舞曲)
    if (p.extraVoltageThisTurn) {
      if (p.voltage >= 9) { p.hp -= 1; log(state, `⚡ 加成讓魔力溢位 -1 HP`); }
      else p.voltage = clamp(p.voltage + p.extraVoltageThisTurn, 0, 9);
      p.extraVoltageThisTurn = 0;
    }

    // Resolve used cards: L → discard; frozen → stay; non-L sword → hand
    const stayUsed = [];
    for (const cid of p.used) {
      const c = CARDS[cid];
      if (p.frozenCards.includes(cid)) { stayUsed.push(cid); continue; }
      if ((p._forceDiscard||[]).includes(cid)) {
        p.discard.push(cid);
        const idx2 = p._forceDiscard.indexOf(cid);
        if (idx2 >= 0) p._forceDiscard.splice(idx2, 1);
        log(state, `🔥 ${(CARDS[cid]||{}).namecn} 因效果棄置`);
        continue;
      }
      // No.63 銀嶺槍: 追加 if in play area at turn end, freeze it
      if (cid === 'No.63') {
        p.frozen.push(cid);
        log(state, `❄ 銀嶺槍 自動凍結 (可下回合免費啟動)`);
        continue;
      }
      if (c.restrict === 'L') p.discard.push(cid); else p.hand.push(cid);
    }
    p.used = stayUsed;
    for (const cid of p.breathUsed) p.breath.push(cid);
    p.breathUsed = [];

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

  // ---------- Helpers: cost charging ----------
  function canAfford(p, cost) { return (p.costSpent + cost) <= p.voltage; }
  function chargeCost(p, cost) { p.costSpent += cost; }

  // ---------- Card play ----------
  function playCard(state, idx, cardId, choice) {
    if (state.phase !== 'playing') return err(state, '不在對戰中');
    if (state.pending) return err(state, '等待反應結算中');
    if (state.currentTurn !== idx) return err(state, '不是你的回合');
    const p = state.players[idx];
    const card = CARDS[cardId];
    if (!card) return err(state, '無此卡');

    // Determine source pile (breath in front, or hand)
    const inBreath = p.breath.indexOf(cardId);
    const inHand = p.hand.indexOf(cardId);
    if (inBreath < 0 && inHand < 0) return err(state, '不可使用此卡');
    // Seal check (封印之瑪瑙)
    const cardName = (CARDS[cardId]||{}).namecn;
    if (cardName && p.sealed.has(cardName)) return err(state, `「${cardName}」已被封印，整局無法再使用`);

    // Cost: 加護法 (BC.2) chooses X cost; stones cost 1 (fixed)
    let cost = typeof card.cost === 'number' ? card.cost : 0;
    if (cardId === BC.GUARD) cost = clamp(choice?.x || 1, 1, p.voltage - p.costSpent);
    if (card.types.includes('stone')) cost = typeof card.cost === 'number' ? card.cost : 1;
    if (!canAfford(p, cost)) return err(state, `本回合可花費餘額不足 (剩 ${p.voltage - p.costSpent}，需 ${cost})`);

    // Pay cost
    chargeCost(p, cost);

    // Stones go face-down to setArea (effect deferred to opponent's turn)
    if (card.types.includes('stone')) {
      if (inBreath >= 0) p.breath.splice(inBreath, 1); else p.hand.splice(inHand, 1);
      p.setArea.push(cardId);
      log(state, `${p.name} 蓋置反應卡（${cost} cost）`);
      return;
    }

    // Remove from source
    if (inBreath >= 0) { p.breath.splice(inBreath, 1); p.breathUsed.push(cardId); }
    else { p.hand.splice(inHand, 1); p.used.push(cardId); }

    log(state, `${p.name} 使用「${card.namecn}」 (花費 ${cost}，剩 ${p.voltage - p.costSpent})`);
    applyCardEffect(state, idx, cardId, cost, choice);
    checkVictory(state);
  }


  // ===================== CARD_HANDLERS (per-card overrides) =====================
  // These override the generic switch-case logic when present.
  // Each handler returns nothing; mutates state directly.

  function countBlueCards(state, idx) {
    const p = state.players[idx];
    const allIds = [...p.used, ...p.discard, ...p.subordinates.map(s=>s.cardId)];
    let n = 0;
    for (const cid of allIds) {
      const c = CARDS[cid];
      if (c && (c.types||[]).includes('magic')) n++;
    }
    return n;
  }
  function hasDollInDiscard(state, idx) {
    const dolls = new Set(['No.33','No.34','No.35','No.36']);
    return state.players[idx].discard.some(cid => dolls.has(cid));
  }

  function ATK(s, i) { const p = s.players[i]; return clamp(p.atkBase + p.atkBuff, 0, 99); }
  const CARD_HANDLERS = {
    // -------- BR pack --------
    'No.01': { resolve(s,i) { queueAttack(s,i,'No.01','attack', ATK(s,i), {}); } },
    'No.02': { resolve(s,i) { queueAttack(s,i,'No.02','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      const p = s.players[i];
      if (!p.reusedThisTurn.has('No.02') && p.voltage - p.costSpent >= 1) {
        requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_yesno', count: 1, cardId: 'No.02',
          prompt: '舞踏劍：付 1 cost 再次使用？',
          action: 'reuse_card',
          options: ['yes','no']
        });
      }
    } },  // reuse omitted
    'No.03': { resolve(s,i) { queueAttack(s,i,'No.03','attack', ATK(s,i), { unstoppable:true }); } },
    'No.04': { resolve(s,i) { queueAttack(s,i,'No.04','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) { if (d >= 1) attach(s,1-i,'毒',{sourceCard:'No.04'}); s.players[1-i].poison = true; } },
    'No.05': { resolve(s,i) { queueAttack(s,i,'No.05','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      if (d >= 1 && s.players[1-i].hand.length > 0) {
        const n = Math.min(3, s.players[1-i].hand.length);
        requirePick(s, { forIdx: 1-i, sourcePlayer: 1-i, type: 'pick_hand_card', count: n, cardId: 'No.05',
          prompt: `公開 ${n} 張手牌（之後由對手選 1 張棄置）`,
          action: 'reveal_then_attacker_picks_one',
          chainStep: { attackerIdx: i },
          options: s.players[1-i].hand
        });
      }
    } },
    'No.06': { resolve(s,i) { queueAttack(s,i,'No.06','attack', ATK(s,i), { ignoreDef:true }); } },
    'No.07': { resolve(s,i) { queueAttack(s,i,'No.07','magic', 1 + s.players[i].magicDmgBonus + s.players[i].magicBonusOnceThisTurn, { ignoreDef:true }); } },
    'No.08': { resolve(s,i) { queueAttack(s,i,'No.08','magic', 3 + s.players[i].magicDmgBonus + s.players[i].magicBonusOnceThisTurn, { ignoreDef:true }); s.players[i].hp -= 3; log(s,`代價：${s.players[i].name} -3 HP`); } },
    'No.09': { resolve(s,i) { let d = (s.players[i].hand.length === 0 ? 6 : 3) + s.players[i].magicDmgBonus; queueAttack(s,i,'No.09','magic', d, { ignoreDef:true }); } },
    'No.10': { resolve(s,i) { queueAttack(s,i,'No.10','magic', Math.ceil(s.players[1-i].hp/2), { ignoreDef:true }); } },
    'No.11': { resolve(s,i) { queueAttack(s,i,'No.11','magic', s.players[1-i].hp, { ignoreDef:true }); } },
    'No.12': { resolve(s,i) { attach(s,i,'燐光',{sourceCard:'No.12'}); s.players[i].nextDmgReduce += 1; } },
    'No.13': { resolve(s,i) { healPlayer(s,i,4); } },
    'No.14': { resolve(s,i) { s.players[i].atkBuff += 2; log(s,`→ ${s.players[i].name} ATK +2 (本回合)`); } },
    'No.15': { resolve(s,i) { s.players[i].extraVoltageThisTurn += 1; } },
    'No.16': { resolve(s,i) { summonSubordinate(s,i,'No.16'); } },
    // Stones (BR) — applied via reactStone hook (existing logic mostly fine)

    // -------- NT pack --------
    'No.21': { resolve(s,i) { const d = ATK(s,i) + (s.isNight ? 2 : 0); queueAttack(s,i,'No.21','attack', d, {}); } },
    'No.22': { resolve(s,i) { queueAttack(s,i,'No.22','attack', ATK(s,i), {}); } },  // 加護法再用簡化
    'No.23': { resolve(s,i) { s.players[1-i].defBuff -= 1; queueAttack(s,i,'No.23','attack', ATK(s,i), {}); } },
    'No.24': { resolve(s,i) { queueAttack(s,i,'No.24','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      if (d >= 1) {
        const dolls = s.players[i].subordinates.filter(sub => sub.isDoll);
        if (dolls.length > 0) {
          requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_doll_night_action', count: 1, cardId: 'No.24',
            prompt: '選 1 個人偶執行其 [月] 行動',
            action: 'execute_doll_night',
            options: dolls.map(sub => sub.cardId)
          });
        }
      }
    } },  // 追加簡化為傷害+2
    'No.25': { resolve(s,i) { const d = s.isNight ? ATK(s,i) : ATK(s,i)*2; queueAttack(s,i,'No.25','attack', d, {}); } },
    'No.26': { resolve(s,i) { if (s.isNight) { log(s,`月：魔彈再也無法命中`); return; } queueAttack(s,i,'No.26','magic', 3, { ignoreDef:true }); }, onAttackEnd(s,i,d) { if (d >= 1) s.players[1-i].cannotHeal = true; } },
    'No.27': { resolve(s,i) {
      queueAttack(s,i,'No.27','magic', 4, { ignoreDef:true });
      if (!hasDollInDiscard(s, i)) {
        const myDolls = s.players[i].subordinates.filter(sub => sub.isDoll);
        if (myDolls.length > 0) {
          requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_subordinate', count: 1, cardId: 'No.27',
            prompt: '代償：棄置 1 個自己人偶配下', action: 'discard_subordinate_from',
            options: myDolls.map(sub => sub.cardId)
          });
        }
      }
    } },
    'No.28': { resolve(s,i) { if (!s.isNight) { log(s,`日：少女在陽光下化作了灰燼`); return; } queueAttack(s,i,'No.28','magic', 5, { ignoreDef:true }); }, onAttackEnd(s,i,d) { if (d >= 1) healPlayer(s,i,d); } },
    'No.29': { resolve(s,i) { const dolls = s.players[i].subordinates.filter(sub=>sub.isDoll).length; if (dolls >= 3) { s.players[1-i].hp = 0; checkVictory(s); log(s,`※ 終曲之彩雀花：3人偶條件達成，立即勝利！`); return; } queueAttack(s,i,'No.29','magic', 10, { ignoreDef:true }); } },
    'No.30': { resolve(s,i) { const p = s.players[i]; p.coatActive = true; p.defBuff += 2; attach(s,i,'外套',{sourceCard:'No.30'}); log(s,`🧥 ${p.name} 穿上外套 (DEF+2, ATK→0)`); } },
    'No.31': { resolve(s,i) { s.players[i].atkBuff += 1; s.players[i].hp -= 2; log(s,`代價：-2 HP`); } },
    'No.32': { resolve(s,i,choice) {
      s.players[i].extraVoltageThisTurn += 1;
      // 錬成: 可棄置 1 個自己的人偶配下，cost-X (already paid; refund)
      const dolls = s.players[i].subordinates.filter(sub => sub.isDoll);
      if (dolls.length > 0) {
        requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_doll_sacrifice', count: 1, cardId: 'No.32',
          prompt: '可棄置 1 個自己人偶，退回該配下 cost 數量魔力',
          action: 'sacrifice_doll_refund',
          options: dolls.map(sub => sub.cardId)
        });
      }
    } },
    'No.33': { resolve(s,i) { summonSubordinate(s,i,'No.33'); } },
    'No.34': { resolve(s,i) { summonSubordinate(s,i,'No.34'); } },
    'No.35': { resolve(s,i) { summonSubordinate(s,i,'No.35'); } },
    'No.36': { resolve(s,i) { summonSubordinate(s,i,'No.36'); } },

    // -------- GG pack --------
    'No.41': { resolve(s,i,choice) {
      queueAttack(s,i,'No.41','attack', ATK(s,i) + (choice?.renseion ? 1 : 0), {});
      if (choice?.renseion) {
        // pay extra 1 cost
        s.players[i].costSpent += 1;
        s.players[i].tokens.push({ cardId: 'No.41', name: '徵稅劍-付與', coin: 1 });
        log(s, `🪙 徵稅劍 付與：你的設置區獲得 1 COIN token`);
      }
    } },
    'No.42': { resolve(s,i) { queueAttack(s,i,'No.42','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      const p = s.players[i];
      if (!p.reusedThisTurn.has('No.42')) {
        // List items in set area with COIN value
        const eligible = [];
        p.subordinates.forEach(sub => { if (sub.coin > 0) eligible.push(sub.cardId); });
        p.tokens.forEach((t,idx) => { if (t.coin > 0) eligible.push('TOKEN:'+idx); });
        if (eligible.length > 0 && p.voltage - p.costSpent >= 0) {
          requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_setarea_coin', count: 1, cardId: 'No.42',
            prompt: '絢爛劍：可棄置設置區 1 個 COIN 卡，0 cost 再用',
            action: 'discard_set_then_reuse_42',
            options: eligible
          });
        }
      }
    } },
    'No.43': { resolve(s,i) { queueAttack(s,i,'No.43','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      if (d >= 0) { s.players[i].responseCostDiscount = (s.players[i].responseCostDiscount||0) + 1; log(s,`紋章劍：本回合反應卡 cost-1`); }
    } },
    'No.44': { resolve(s,i) { queueAttack(s,i,'No.44','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) { if (d >= 1) queueAttack(s,i,'No.44','magic', 3, { ignoreDef:true, noChainTrigger:true }); } },
    'No.45': { resolve(s,i) { queueAttack(s,i,'No.45','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      if (d >= 1 && s.players[1-i].hand.length > 0) {
        requirePick(s, { forIdx: 1-i, sourcePlayer: 1-i, type: 'pick_hand_card', count: 1, cardId: 'No.45',
          prompt: '從手牌選 1 張棄置', action: 'discard_hand_from',
          options: s.players[1-i].hand });
      }
    } },
    'No.46': { resolve(s,i) { queueAttack(s,i,'No.46','attack', ATK(s,i)*2, {}); } },
    'No.47': { resolve(s,i) {
      const p = s.players[i];
      const cTotal = p.subordinates.reduce((a,sub)=>a+(sub.coin||0),0) + (p.tokens||[]).reduce((a,t)=>a+(t.coin||0),0);
      const d = cTotal >= 4 ? 2 : 1;
      queueAttack(s,i,'No.47','magic', d + p.magicDmgBonus, { ignoreDef:true });
      if (cTotal >= 4) {
        // Mark to discard self at turn end instead of returning to hand
        if (!p.frozenCards.includes('No.47')) p._forceDiscard = p._forceDiscard || []; p._forceDiscard?.push('No.47');
      }
    } },
    'No.48': { resolve(s,i,choice) { if (choice?.renseion) { attach(s,i,'暗鴉',{sourceCard:'No.48'}); } queueAttack(s,i,'No.48','magic', 1 + s.players[i].magicDmgBonus, { ignoreDef:true }); }, onAttackEnd(s,i,d) { if (d >= 1) s.players[i].ravenBonus = 1; } },
    'No.49': { resolve(s,i) { queueAttack(s,i,'No.49','magic', 4 + s.players[i].magicDmgBonus, { ignoreDef:true }); }, onAttackEnd(s,i,d) {
      if (s.players[1-i].subordinates.length > 0) {
        const eligible = s.players[1-i].subordinates.filter(sub => (CARDS[sub.cardId]?.cost||0) <= 2).map(sub => sub.cardId);
        if (eligible.length) requirePick(s, { forIdx: i, sourcePlayer: 1-i, type: 'pick_subordinate', count: 1, cardId: 'No.49',
          prompt: '從對手配下選 1 個 (cost ≤ 2) 棄置', action: 'discard_subordinate_from',
          options: eligible });
      }
    } },
    'No.50': { resolve(s,i) {
      const blue = countBlueCards(s,i);
      queueAttack(s,i,'No.50','magic', blue * 2 + s.players[i].magicDmgBonus, { ignoreDef:true });
      log(s, `烈焰之花冠：藍色卡 ${blue} × 2 = ${blue*2} 傷害`);
    } },
    'No.51': { resolve(s,i,choice) {
      const sel = choice?.choice;
      if (sel === 'heal') healPlayer(s,i,5);
      else if (sel === 'atk') s.players[i].atkBuff += 1;
      else if (sel === 'def') s.players[i].defBuff += 1;
      else s.players[i].extraVoltageThisTurn += 1;
    } },
    'No.52': { resolve(s,i) { summonSubordinate(s,i,'No.52'); } },
    'No.53': { resolve(s,i) { summonSubordinate(s,i,'No.53'); } },
    'No.54': { resolve(s,i) { summonSubordinate(s,i,'No.54'); } },
    'No.55': { resolve(s,i) { summonSubordinate(s,i,'No.55'); } },
    'No.56': { resolve(s,i) { summonSubordinate(s,i,'No.56'); } },
    // Stones GG handled by reactStone

    // -------- FV pack (basic freeze handling) --------
    'No.61': { freezeFirst: true, resolve(s,i) { queueAttack(s,i,'No.61','attack', ATK(s,i), {}); } },
    'No.62': { resolve(s,i,choice) { let d = ATK(s,i); if (choice?.renseion === 'discard_heat') { const hi = s.players[i].breath.indexOf('BC.1'); if (hi>=0) { s.players[i].breath.splice(hi,1); s.players[i].discard.push('BC.1'); d += 2; log(s,`錬成：棄置加熱法，+2傷害`); } } queueAttack(s,i,'No.62','attack', d, {}); } },
    'No.63': { resolve(s,i) { queueAttack(s,i,'No.63','attack', ATK(s,i), {}); } },  // 自動凍結在 endTurn 處理
    'No.64': { resolve(s,i) { queueAttack(s,i,'No.64','attack', ATK(s,i) + 1, {}); }, onAttackEnd(s,i,d) {
      if (d >= 1 && s.players[1-i].subordinates.length > 0) {
        const eligible = s.players[1-i].subordinates.filter(sub => (CARDS[sub.cardId]?.cost||0) <= d).map(sub => sub.cardId);
        if (eligible.length) requirePick(s, { forIdx: i, sourcePlayer: 1-i, type: 'pick_subordinate', count: 1, cardId: 'No.64',
          prompt: `從對手配下選 1 個（cost ≤ ${d}）棄置`, action: 'discard_subordinate_from',
          options: eligible });
      }
    } },
    'No.65': { resolve(s,i) { 
      // queue with x2 placeholder; if opp opts not-discard, x4 will replace
      queueAttack(s,i,'No.65','attack', ATK(s,i), {});
      // Defender chooses 0 or 2 hand cards
      if (s.players[1-i].hand.length >= 2) {
        requirePick(s, { forIdx: 1-i, sourcePlayer: 1-i, type: 'pick_hand_card', count: 2, cardId: 'No.65',
          prompt: '可選 2 張手牌棄置 (傷害×2)；不選則 (傷害×4)',
          action: 'mulligan_double_else_quad',
          options: s.players[1-i].hand
        });
      } else {
        // not enough cards → x4
        if (s.pending) { s.pending.previewDamage *= 4; log(s,`手牌不足 2，傷害 ×4`); }
      }
    } },
    'No.66': { freezeFirst: true, resolve(s,i) { queueAttack(s,i,'No.66','magic', 1 + s.players[i].magicDmgBonus, { ignoreDef:true }); } },
    'No.67': { resolve(s,i) { queueAttack(s,i,'No.67','magic', 2 + s.players[i].magicDmgBonus, { ignoreDef:true }); s.players[i].magicBonusOnceThisTurn += 1; } },
    'No.68': { resolve(s,i) { queueAttack(s,i,'No.68','magic', 3 + s.players[i].magicDmgBonus, { ignoreDef:true }); } },
    'No.69': { resolve(s,i) {
      const p = s.players[i];
      const already = (p.magicCountThisTurn||0) > 0;
      queueAttack(s,i,'No.69','magic', 8 + p.magicDmgBonus, { ignoreDef:true, unstoppable: already });
      if (already) log(s,`風暴之菖蒲：本回合已魔法攻擊，無法被反應`);
    } },
    'No.70': { resolve(s,i,choice) {
      const sel = choice?.choice || 'attack';
      const renseion = !!choice?.renseion;
      const p = s.players[i];
      if (renseion) {
        const need = 3;
        if (p.voltage - p.costSpent >= need) {
          p.costSpent += need;
          if (sel === 'magic') queueAttack(s,i,'No.70','magic', 1 + 2 + p.magicDmgBonus, { ignoreDef:true });
          else queueAttack(s,i,'No.70','attack', ATK(s,i) + 2, {});
          log(s,`錬成：紫陽花之魔劍 額外 +2 傷害`);
          return;
        }
      }
      if (sel === 'magic') queueAttack(s,i,'No.70','magic', 1, { ignoreDef:true });
      else queueAttack(s,i,'No.70','attack', ATK(s,i), {});
    } },
    'No.71': { freezeFirst: true, resolve(s,i,choice) { if (choice?.choice === 'voltage') { s.players[i].voltage = clamp(s.players[i].voltage+1,0,9); } else s.players[i].atkBuff += 1; } },
    'No.72': { resolve(s,i,choice) {
      const p = s.players[i];
      healPlayer(s, i, 2);
      if (choice?.renseion && p.voltage - p.costSpent >= 9) {
        p.costSpent += 9;
        log(s,`錬成 9 cost：發動 2 次龍鳴劍 (ATK 視為 15)`);
        queueAttack(s,i,'No.72','attack', 15, {});
        if (s.pending) resolveAttack(s);  // resolve first immediately
        queueAttack(s,i,'No.72','attack', 15, {});
      }
    } },
    'No.73': { freezeFirst: true, resolve(s,i) { const p = s.players[i], opp = s.players[1-i]; if (p.hp < 8) { p.hp = 8; log(s,`→ 自己生命變為 8`); } else { opp.hp = 8; log(s,`→ 對手生命變為 8`); } } },
    'No.74': { resolve(s,i) { summonSubordinate(s,i,'No.74'); } },
    'No.75': { resolve(s,i) { summonSubordinate(s,i,'No.75'); } },
    'No.76': { resolve(s,i) { summonSubordinate(s,i,'No.76'); } },

    // -------- LD pack --------
    'No.81': { resolve(s,i) { const a = ATK(s,i); const d = a + (a >= 7 ? 1 : (a <= 6 ? -1 : 0)); queueAttack(s,i,'No.81','attack', d, {}); } },
    'No.82': { resolve(s,i) { queueAttack(s,i,'No.82','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) { if (d >= 1) { attach(s,i,'燐光',{sourceCard:'No.82'}); s.players[i].nextDmgReduce += 1; } } },
    'No.83': { resolve(s,i) { queueAttack(s,i,'No.83','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      if (d >= 1 && s.players[1-i].hand.length > 0) {
        requirePick(s, { forIdx: 1-i, sourcePlayer: 1-i, type: 'pick_hand_card', count: 1, cardId: 'No.83',
          prompt: '從手牌選 1 張棄置', action: 'discard_hand_from',
          options: s.players[1-i].hand });
      }
    } },
    'No.84': { resolve(s,i) { queueAttack(s,i,'No.84','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) { if (d >= 1) { queueAttack(s,i,'No.84','magic', 4 + s.players[i].magicDmgBonus, { ignoreDef:true, noChainTrigger:true }); s.players[i].hp -= 4; log(s,`代價：-4 HP`); } } },
    'No.85': { resolve(s,i,choice) {
      queueAttack(s,i,'No.85','attack', ATK(s,i), {});
      // 錬成 1 cost (no_react) / 5 cost (no_def). Ask self.
      const have = s.players[i].voltage - s.players[i].costSpent;
      const options = ['skip'];
      if (have >= 1) options.push('no_react');
      if (have >= 5) options.push('no_def');
      if (options.length > 1) {
        requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_renseion_85', count: 1, cardId: 'No.85',
          prompt: '錬成：1cost 無反應 / 5cost 無視防禦 / 不錬成',
          action: 'renseion_choice_value',
          options: options
        });
      }
    } },
    'No.86': { resolve(s,i) { queueAttack(s,i,'No.86','attack', ATK(s,i) + 2, {}); } },
    'No.87': { resolve(s,i) { queueAttack(s,i,'No.87','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) { if (d >= 1) healPlayer(s,i,d); } },
    'No.88': { resolve(s,i) { queueAttack(s,i,'No.88','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      if (d >= 1) {
        attach(s, 1-i, '鈍痛', { sourceCard: 'No.88' });
      }
    } },
    'No.89': { resolve(s,i) { s.players[i].atkBuff += 1; queueAttack(s,i,'No.89','attack', ATK(s,i), {}); } },
    'No.90': { resolve(s,i) { let d = ATK(s,i) + 3; if (s.players[i].hand.length === 0) d += 3; queueAttack(s,i,'No.90','attack', d, {}); } },
    'No.91': { resolve(s,i,choice) {
      const sel = choice?.choice;
      if (sel === 'magic') queueAttack(s,i,'No.91','magic', 2 + s.players[i].magicDmgBonus, { ignoreDef:true });
      else if (sel === 'heal') healPlayer(s,i,2);
      else queueAttack(s,i,'No.91','attack', ATK(s,i), {});
    } },
    'No.92': { resolve(s,i,choice) {
      if (choice?.choice === 'magic') queueAttack(s,i,'No.92','magic', 9, { unstoppable:true, ignoreDef:true });
      else queueAttack(s,i,'No.92','attack', ATK(s,i)*3, { unstoppable:true });
    } },
    'No.93': { resolve(s,i) { healPlayer(s,i,2); attach(s,i,'水蜜',{sourceCard:'No.93'}); } },
    'No.94': { resolve(s,i) {
      const p = s.players[i];
      const x = s.firstPlayer === i ? Math.max(0, p.voltage - 1) : p.voltage;
      p.atkBuff = x - p.atkBase;
      log(s,`迸發：你的 ATK 變為 ${x} (${s.firstPlayer === i ? '先攻 X-1' : '後攻 X'})`);
    } },
    'No.95': { resolve(s,i) { summonSubordinate(s,i,'No.95'); } },
    'No.96': { resolve(s,i) { summonSubordinate(s,i,'No.96'); } },
  };
  function state_isFirstPlayer(s, i) { return s.firstPlayer === i; }

  function randomDiscard(state, idx) {
    const h = state.players[idx].hand;
    if (!h.length) return;
    const j = Math.floor(Math.random() * h.length);
    const lost = h.splice(j, 1)[0];
    state.players[idx].discard.push(lost);
    log(state, `${state.players[idx].name} 被迫棄置「${(CARDS[lost]||{}).namecn||lost}」`);
  }

  function applyCardEffect(state, idx, cardId, paidCost, choice) {
    const p = state.players[idx]; const opp = state.players[1 - idx];
    const card = CARDS[cardId]; const type = card.types[0];
    // First: per-card handler override
    if (CARD_HANDLERS[cardId] && CARD_HANDLERS[cardId].resolve) {
      const h = CARD_HANDLERS[cardId];
      // 凍結: 首次打出 → 進凍結設置區，主效果留到下次免費啟動
      if (h.freezeFirst && !choice?._fromFrozen) {
        // Remove from used (was pushed in playCard), put in frozen
        const usedIdx = state.players[idx].used.indexOf(cardId);
        if (usedIdx >= 0) state.players[idx].used.splice(usedIdx, 1);
        state.players[idx].frozen.push(cardId);
        log(state, `❄ ${state.players[idx].name} 凍結「${(CARDS[cardId]||{}).namecn||cardId}」(可在之後回合免費啟動)`);
        return;
      }
      h.resolve(state, idx, choice);
      return;
    }
    // Breath
    if (cardId === BC.HEAT) { p.atkBuff += 1; log(state, `→ ${p.name} 攻擊力 +1（本回合）`); return; }
    if (cardId === BC.GUARD) { p.defBuff += paidCost; log(state, `→ ${p.name} 防禦力 +${paidCost}（本回合）`); return; }
    if (cardId === BC.BEAT) {
      if (p.voltage >= 9) { p.hp -= 1; log(state, `⚡ 魔力滿無法獲得，-1 HP`); }
      else p.voltage = clamp(p.voltage + 1, 0, 9);
      log(state, `→ ${p.name} 魔力 +1`);
      return;
    }

    if (type === 'attack') {
      let dmg = atkDamage(state, idx, cardId);
      let unstoppable = /無法被反應|無視防禦/.test(card.desc || '') || card.id === 'No.03';
      let ignoreDef = /無視防禦/.test(card.desc || '') || card.id === 'No.06' || card.id === 'No.85';
      queueAttack(state, idx, cardId, 'attack', dmg, { unstoppable, ignoreDef });
      return;
    }
    if (type === 'magic') {
      queueAttack(state, idx, cardId, 'magic', magicDamage(state, idx, cardId), { unstoppable: false, ignoreDef: true });
      return;
    }
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
    if (p.coatActive) base = 0;
    if (p.ravenBonus) { bonus += p.ravenBonus; p.ravenBonus = 0; }
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
    base += p.magicBonusOnceThisTurn;
    return Math.max(0, base);
  }

  function queueAttack(state, attackerIdx, cardId, kind, dmg, opts) {
    if (kind === 'magic') state.players[attackerIdx].magicCountThisTurn = (state.players[attackerIdx].magicCountThisTurn||0) + 1;
    const defenderIdx = 1 - attackerIdx;
    state.pending = {
      attackerIdx, defenderIdx, cardId, kind,
      previewDamage: dmg, rawDamage: dmg,
      reactable: !opts.unstoppable, ignoreDef: opts.ignoreDef,
      noChainTrigger: !!opts.noChainTrigger
    };
    log(state, `→ ${state.players[attackerIdx].name} ${kind === 'magic' ? '魔法攻擊' : '物理攻擊'} ${CARDS[cardId].namecn} 預計 ${dmg} 點${opts.unstoppable ? '（無法反應）' : ''}`);
    if (!state.pending.reactable) resolveAttack(state);
  }

  function resolveAttack(state) {
    const pend = state.pending; if (!pend) return;
    const attacker = state.players[pend.attackerIdx];
    const defender = state.players[pend.defenderIdx];
    if (pend.invalidated) { log(state, `※ 攻擊被無效化`); state.pending = null; defender._dmgReduceTurn = 0; return; }
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

    // 追加 effects trigger if damage ≥ 0 (per rulebook 3.1 — 0-dmg still triggers 追加)
    const cid = pend.cardId;
    if (cid === 'No.28' && state.isNight) healPlayer(state, pend.attackerIdx, dmg);
    if (cid === 'No.87') healPlayer(state, pend.attackerIdx, dmg);
    if (cid === 'No.04') { defender.poison = true; log(state, `${defender.name} 中毒`); }
    if (cid === 'No.26') { defender.cannotHeal = true; log(state, `${defender.name} 被刻印（無法回復）`); }
    // No.05/45/83: handled by per-card onAttackEnd hooks via requirePick (multi-target UI)
    // 拒卻死亡 revival check
    if (defender._reviveTo2 && defender.hp <= 0) {
      defender.hp = 2;
      log(state, `※ ${defender.name} 拒卻死亡，以 2 HP 復活`);
    }
    defender._reviveTo2 = false;
    // 水蜜 trigger
    if (hasAttach(state, pend.defenderIdx, '水蜜') && dmg >= 4) {
      removeAttach(state, pend.defenderIdx, '水蜜');
      healPlayer(state, pend.defenderIdx, 3);
      log(state, `🍯 水蜜觸發：${defender.name} 獲得 3 HP`);
    }
    state.players.forEach(p => p._dmgReduceTurn = 0);
    state.pending = null;  // ← clear before onAttackEnd so 追加 can queue a fresh attack
    checkVictory(state);
    // Call onAttackEnd hook for 追加 effects (skip if this attack is itself a 追加 chain)
    const handler = CARD_HANDLERS[pend.cardId];
    if (handler && handler.onAttackEnd && !pend.noChainTrigger) {
      handler.onAttackEnd(state, pend.attackerIdx, dmg);
    }
    checkVictory(state);
  }

  function healPlayer(state, idx, amount) {
    const p = state.players[idx];
    if (p.cannotHeal) { log(state, `${p.name} 被刻印，無法回復`); return; }
    const before = p.hp;
    p.hp = clamp(p.hp + amount, 0, 15);
    log(state, `${p.name} 恢復生命 ${before} → ${p.hp}`);
  }

  function summonSubordinate(state, idx, cardId) {
    const spec = SUBORDINATE_TABLE[cardId];
    if (!spec) { log(state, `（${(CARDS[cardId]||{}).namecn||cardId} 沒有對應配下定義）`); return; }
    const p = state.players[idx];
    p.subordinates.push({ cardId, name: spec.name, atk: spec.atk, def: spec.def, coin: spec.coin || 0, isDoll: !!spec.isDoll, action: spec.action });
    log(state, `🪄 ${p.name} 召喚配下「${spec.name}」 (ATK ${spec.atk} / DEF ${spec.def})`);
  }

  function applyAid(state, idx, cardId, paidCost, choice) {
    const p = state.players[idx]; const opp = state.players[1 - idx];
    switch (cardId) {
      case 'No.12': p.nextDmgReduce += 1; break;
      case 'No.13': healPlayer(state, idx, 4); break;
      case 'No.14': p.atkBuff += 2; break;
      case 'No.15': p.extraVoltageThisTurn += 1; break;
      case 'No.16': summonSubordinate(state, idx, cardId); return;
      case 'No.30': p.defBuff += 2; p.atkBuff -= clamp(p.atkBase + p.atkBuff, 0, 99); break;
      case 'No.31': p.atkBuff += 1; p.hp -= 2; break;
      case 'No.32': p.extraVoltageThisTurn += 1; break;
      case 'No.33': if (state.isNight) p.atkBuff += 1; else p.defBuff += 1; break;
      case 'No.34': summonSubordinate(state, idx, cardId); return;
      case 'No.35': summonSubordinate(state, idx, cardId); return;
      case 'No.36': summonSubordinate(state, idx, cardId); return;
      case 'No.52': summonSubordinate(state, idx, cardId); return;
      case 'No.53': summonSubordinate(state, idx, cardId); return;
      case 'No.54': summonSubordinate(state, idx, cardId); return;
      case 'No.55': summonSubordinate(state, idx, cardId); return;
      case 'No.56': summonSubordinate(state, idx, cardId); return;
      case 'No.72': healPlayer(state, idx, 2); break;
      case 'No.73': if (p.hp < 8) { p.hp = 8; log(state, `→ 你的生命變為 8`); } else { opp.hp = 8; log(state, `→ 對手的生命變為 8`); } break;
      case 'No.74': summonSubordinate(state, idx, cardId); return;
      case 'No.75': summonSubordinate(state, idx, cardId); return;
      case 'No.76': summonSubordinate(state, idx, cardId); return;
      case 'No.93': healPlayer(state, idx, 2); break;
      case 'No.94': p.atkBuff = p.voltage - clamp(p.atkBase, 0, 99); break;
      case 'No.95': summonSubordinate(state, idx, cardId); return;
      case 'No.96': summonSubordinate(state, idx, cardId); return;
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
        if (sel === 'voltage') {
          if (p.voltage >= 9) { p.hp -= 1; log(state, `⚡ 魔力滿，-1 HP`); }
          else p.voltage = clamp(p.voltage + 1, 0, 9);
        } else p.atkBuff += 1;
        break;
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

  // Reaction: flip a face-down stone (no extra cost — paid when set)
  function reactStone(state, defenderIdx, cardId) {
    if (!state.pending) return err(state, '沒有可反應的攻擊');
    if (state.pending.defenderIdx !== defenderIdx) return err(state, '不是你被攻擊');
    if (!state.pending.reactable) return err(state, '此次攻擊無法被反應');
    const p = state.players[defenderIdx]; const card = CARDS[cardId];
    if (!card || !card.types.includes('stone')) return err(state, '不是反應卡');
    const inSet = p.setArea.indexOf(cardId);
    if (inSet < 0) return err(state, '場上沒有蓋置此反應卡');
    p.setArea.splice(inSet, 1);
    p.discard.push(cardId);   // all stones are L (一次性)
    log(state, `${p.name} 反應「${card.namecn}」`);

    const pend = state.pending;
    switch (cardId) {
      case 'No.17': p._reviveTo2 = true; break;
      case 'No.18': p.defBuff += 3; break;

      case 'No.19': pend.invalidated = true; {
        const aCard = CARDS[pend.cardId];
        if (aCard) { state.players[pend.attackerIdx].sealed.add(aCard.namecn); log(state, `🔒 封印：${state.players[pend.attackerIdx].name} 無法再使用「${aCard.namecn}」`); }
        break;
      }
      case 'No.20': case 'No.40': case 'No.80': pend.invalidated = true; break;
      case 'No.37': state.isNight = !state.isNight; healPlayer(state, defenderIdx, 2); break;
      case 'No.38': pend.previewDamage = 0; break;
      case 'No.39': p._dmgReduceTurn = (p._dmgReduceTurn||0) + 3; break;
      case 'No.57': case 'No.58': case 'No.98': pend.invalidated = true; break;
      case 'No.77': {
        pend.invalidated = true;
        // 凍結對手攻擊卡 (簡化: 不檢查配下來源)
        const attackerP = state.players[pend.attackerIdx];
        const aid = pend.cardId;
        // Try to find aid in attacker's used and move to attacker's frozen
        const i = attackerP.used.indexOf(aid);
        if (i >= 0) {
          attackerP.used.splice(i, 1);
          attackerP.frozen.push(aid);
          log(state, `❄ 束縛之榍石：對手「${(CARDS[aid]||{}).namecn||aid}」被凍結`);
        }
        break;
      }
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


  function activateFrozen(state, idx, cardId, choice) {
    if (state.phase !== 'playing') return err(state, '不在對戰中');
    if (state.pending) return err(state, '等待反應結算中');
    if (state.currentTurn !== idx) return err(state, '不是你的回合');
    const p = state.players[idx];
    const i = p.frozen.indexOf(cardId);
    if (i < 0) return err(state, '此卡不在凍結區');
    p.frozen.splice(i, 1);
    const card = CARDS[cardId];
    log(state, `❄→ ${p.name} 啟動凍結中的「${card.namecn}」(免費)`);
    // Push to used so end-of-turn handling routes it correctly
    p.used.push(cardId);
    const h = CARD_HANDLERS[cardId];
    if (h && h.resolve) {
      // Pass _fromFrozen flag to bypass freezeFirst check
      h.resolve(state, idx, { ...(choice||{}), _fromFrozen: true });
    } else {
      // Fall back to generic dispatch
      applyCardEffect(state, idx, cardId, 0, choice || {});
    }
    checkVictory(state);
  }

  return { createRoom, activateFrozen, respondChoice, addPlayer, submitDeck, playCard, reactStone, passReaction, endTurn, rematch, publicView, log };
})();
