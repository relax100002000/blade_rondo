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
    'No.33': { name:'人偶•音樂劇', isDoll:true,   atk:0,  def:0, action:null },  // 常駐效果（ATKof/DEFof 計算）
    'No.34': { name:'人偶•閒角', isDoll:true,     atk:1,  def:0, action:{kind:'attack',  dayDmg:1, nightDmg:5, hits:2} },  // 雑草刈りの鋏 ×2
    'No.35': { name:'人偶•滑稽劇', isDoll:true,   atk:0,  def:0, action:{kind:'dayheal_or_nightmagic', dayHeal:1, nightDmg:2} },
    'No.36': { name:'人偶•無賴傳', isDoll:true,   atk:2,  def:0, action:{kind:'attack',  dayDmg:2, nightDmg:5} },
    'No.52': { name:'奈迪',           atk:0,  def:1, coin:1, action:null },  // 常駐：配下的攻擊力與魔法傷害 +1
    'No.53': { name:'路尼亞',         atk:0,  def:1, coin:1, action:{kind:'magic_self_dmg', dmg:1, selfDmg:1} },
    'No.54': { name:'暗影',           atk:0,  def:2, coin:2, action:{kind:'attack_user_atk'} },
    'No.55': { name:'菲尤',           atk:0,  def:3, coin:3, action:null },  // 在場期間魔法傷害+1（queueAttack 計算）
    'No.56': { name:'高伐',           atk:9,  def:6, coin:6, action:{kind:'choose_56'} },  // 無慈悲殴り 物理 / ヴォイド 魔法(4)
    'No.74': { name:'羅蒂',           atk:1,  def:2, action:{kind:'attack_74'} },  // 後攻なら攻撃力+1
    'No.75': { name:'賽奴',           atk:0,  def:3, action:{kind:'magic_75'} },   // セットエリア4枚以上なら(2)
    'No.76': { name:'多莉亞娜',       atk:0,  def:5, action:{kind:'win_if_higher'} },
    'No.95': { name:'奈斯提可亞',     atk:0,  def:2, action:null },  // 在場期間：你的物理攻擊變為魔法攻擊(2)（queueAttack 處理）
    'No.96': { name:'莉潔卡',         atk:0,  def:4, action:{kind:'magic',   dmg:2} },
  };

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  // 規則書：參數骰子上限 9；但「本回合」類的劍卡效果可暫時超過 9（細則 2）
  const budgetOf = p => p.voltage + (p.bonusBudget || 0) - p.costSpent;   // 鼓動法：本回合可多用 1 cost
  // 窓辺立つミュージカル：場にある間【昼】防御力+1／【夜】攻撃力+1（あなたと配下）
  // 有效的配下（聖域のフローライト：ターン終了時まで相手の配下の攻撃と効果を全て無効化）
  const subsOn = (p, cid) => p.subsNullEOT ? 0 : p.subordinates.filter(x => x.cardId === cid).length;
  const ATKof = p => Math.max(0, p.atkBase + p.atkBuff + (p._night ? subsOn(p, 'No.33') : 0));
  const DEFof = p => Math.max(0, p.defBase + p.defBuff + (p.coatActive ? 2 : 0) + (!p._night ? subsOn(p, 'No.33') : 0));
  const poisonCount = p => p.attachments.filter(a => a.kind === '毒').length;  // 細則 6.1：同名付與可重複
  // 攻擊以外的「ダメージを与える」（不受防禦力影響；適用本回合減傷）
  //   何れかのプレイヤーがダメージを受ける時 → 回合玩家、非回合玩家依序可棄置〈燐光〉使其 ±1
  function dealDamage(state, targetIdx, n, srcIdx, label) {
    const t = state.players[targetIdx];
    const d0 = Math.max(0, n - (t.dmgReduceEOT || 0));
    const tp = state.currentTurn, holders = [];
    for (const who of [tp, 1 - tp]) {
      const k = state.players[who].attachments.filter(a => a.kind === '燐光').length;
      for (let j = 0; j < k; j++) holders.push(who);
    }
    const ev = { targetIdx, dmg: d0, srcIdx, label, holders };
    if (!holders.length) return applyDamageEvent(state, ev);
    askRinkouDmg(state, ev);
  }
  function askRinkouDmg(state, ev) {
    if (!ev.holders.length) return applyDamageEvent(state, ev);
    const who = ev.holders.shift();
    requirePick(state, { forIdx: who, sourcePlayer: who, type: 'pick_rinkou', count: 1, cardId: 'No.12', ev,
      prompt: `燐光：${state.players[ev.targetIdx].name} 將受到 ${ev.dmg} 點傷害（${ev.label || ''}），要棄置燐光使其 +1 或 -1 嗎？`,
      action: 'rinkou_dmg', options: ['+1', '-1', 'none'] });
  }
  function useRinkou(state, idx) {
    const pl = state.players[idx];
    const ai = pl.attachments.findIndex(a => a.kind === '燐光');
    if (ai < 0) return false;
    const a = pl.attachments.splice(ai, 1)[0];
    if (a.sourceCard) pl.discard.push(a.sourceCard);
    return true;
  }
  function applyDamageEvent(state, ev) {
    const t = state.players[ev.targetIdx], d = Math.max(0, ev.dmg), srcIdx = ev.srcIdx, label = ev.label;
    t.hp -= d;
    log(state, `※ ${t.name} 受到 ${d} 點傷害${label ? '（' + label + '）' : ''}（HP ${t.hp + d} → ${t.hp}）`);
    if (srcIdx != null && d >= 4 && t !== state.players[srcIdx]) triggerMitsu(state, srcIdx);
    checkVictory(state);
  }
  // 〈水蜜〉：あなたか、あなたの配下が相手に4以上のダメージを与えた時、捨て札にしてライフを3得る
  function triggerMitsu(state, idx) {
    const p = state.players[idx];
    const ai = p.attachments.findIndex(a => a.kind === '水蜜');
    if (ai < 0) return;
    p.attachments.splice(ai, 1); p.discard.push('No.93');
    log(state, `🍯 水蜜：${p.name} 給予 4 以上傷害，獲得 3 生命`);
    healPlayer(state, idx, 3);
  }
  function updateDayNight(state) {
    // NT：雙方 VOLTAGE 合計 ≤11 為日、≥12 為月（狀態，隨魔力變動更新）；明滅のアレキサンドライト：ターン終了時まで昼夜逆轉
    const base = (state.players[0].voltage + state.players[1].voltage) >= 12;
    state.isNight = state.dayNightFlipped ? !base : base;
    state.players.forEach(p => p._night = state.isNight);
  }
  const musicalCount = p => subsOn(p, 'No.33');
  // 駆り立てるマーチ（ネーデ）：場にある間、配下の攻撃力と魔法攻撃のダメージ+1
  const marchCount = p => subsOn(p, 'No.52');
  const subPhysBonus = (p, night) => marchCount(p) + (night ? musicalCount(p) : 0);
  const subMagBonus = p => marchCount(p);
  const now = () => new Date().toISOString().slice(11, 19);

  // ---------- State factory ----------

  // ----- Attachment helpers -----

  // ----- Multi-target choice helpers (Wave 3) -----
  function requirePick(state, opts) {
    // opts = { forIdx, sourcePlayer, type, count, cardId, prompt, action, options, ... }
    // 已有等待中的選擇時排隊，依序處理
    if (state.pendingChoice) { (state.choiceQueue = state.choiceQueue || []).push(opts); return; }
    state.pendingChoice = opts;
    log(state, `❓ ${state.players[opts.forIdx].name} 需要選擇：${opts.prompt}`);
  }
  function promoteChoice(state) {
    if (!state.pendingChoice && state.choiceQueue && state.choiceQueue.length) {
      state.pendingChoice = state.choiceQueue.shift();
      log(state, `❓ ${state.players[state.pendingChoice.forIdx].name} 需要選擇：${state.pendingChoice.prompt}`);
    }
  }
  function respondChoice(state, idx, selectedIds) {
    const had = state.pendingChoice;
    respondChoiceInner(state, idx, selectedIds);
    if (had && state.pendingChoice === had) return;   // 被拒絕（不是你選／數量不符）
    processSubQueue(state);
  }

  function respondChoiceInner(state, idx, selectedIds) {
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
        if (src.subsSafeEOT && pc.sourcePlayer !== idx) { log(state, `🛐 聖域のフローライト：配下不會被棄置`); break; }
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
          pend.dmgMul = 2;
          log(state, `${src.name} 棄置 2 張，這次攻擊的傷害 ×2`);
        } else {
          pend.dmgMul = 4;
          log(state, `不棄置，這次攻擊的傷害 ×4`);
        }
        break;
      }
      case 'sacrifice_doll_refund': {
        if (sel.length === 0) break;
        const p = state.players[pc.sourcePlayer];
        const j = p.subordinates.findIndex(sub => sub.cardId === sel[0] && sub.isDoll);
        if (j >= 0) {
          const sub = p.subordinates.splice(j, 1)[0];
          p.hand.push(sub.cardId);   // 錬成：ドール 1 枚を手札に戻す
          const refund = CARDS[sub.cardId]?.cost || 0;
          p.costSpent = Math.max(0, p.costSpent - refund);
          log(state, `🎴 錬成：人偶「${sub.name}」返回手牌，本卡 cost -${refund}`);
        }
        break;
      }

      case 'reuse_card': {
        const yes = sel[0] === 'yes';
        const p = state.players[idx];
        const cardId = pc.cardId;
        if (yes && budgetOf(p) >= 1 && p.used.includes(cardId)) {
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
        if (discardedCoin > 0 && p.used.includes('No.42')) {
          log(state, `絢爛劍：0 cost 再用`);
          queueAttack(state, idx, 'No.42', 'attack', ATK(state, idx), {});
        }
        break;
      }
      case 'execute_doll_night': {
        const target = state.players[pc.sourcePlayer].subordinates.find(sub => sub.cardId === sel[0] && sub.isDoll && sub.cardId !== 'No.33');
        if (target) {
          log(state, `🎭 指揮劍：執行人偶「${target.name}」[月] 行動`);
          // クロウリーシラン：指揮剣で選んだドールの物理攻撃にも +1 が適用される
          const carry = state.players[pc.sourcePlayer].ravenCarry || 0; state.players[pc.sourcePlayer].ravenCarry = 0;
          queueSubordinateActions(state, pc.sourcePlayer, target, true, true, carry);
        }
        break;
      }
      case 'kuro_reuse': {
        const p = state.players[idx];
        if (sel[0] !== 'yes' || !p.used.includes('No.22')) break;
        const zone = p.breath.includes('BC.2') ? p.breath : p.breathUsed;
        const k = zone.indexOf('BC.2');
        if (k < 0) break;
        zone.splice(k, 1); p.discard.push('BC.2');
        log(state, `黒の剣：棄置加護法，0 cost 再使用`);
        queueAttack(state, idx, 'No.22', 'attack', ATKof(p), {});
        break;
      }
      case 'campanella': {
        const t = sel[0] === 'opp' ? 1 - idx : idx;
        if (sel[0] === 'self' || sel[0] === 'opp') { state.players[t].hp = 8; log(state, `🔔 調停するカンパネラ：${state.players[t].name} 的生命變為 8`); }
        break;
      }
      case 'tourmaline': {
        const p = state.players[idx];
        const j = p.subordinates.findIndex(x => x.cardId === sel[0] && x.isDoll);
        if (j >= 0) { const sub = p.subordinates.splice(j, 1)[0]; p.discard.push(sub.cardId); p.dmgReduceEOT += 3; log(state, `身代わりのトルマリン：棄置「${sub.name}」，本回合受到傷害 -3`); }
        return;
      }
      case 'sub56_choice': {
        const p = state.players[idx];
        if (sel[0] === 'magic') queueAttack(state, idx, 'No.56', 'magic', 4 + subMagBonus(p), { fromSub: 'No.56', ignoreDef: true });
        else queueAttack(state, idx, 'No.56', 'attack', 9 + subPhysBonus(p, state.isNight), { fromSub: 'No.56', atkMul: 0 });
        return;
      }
      case 'refreeze_66': {
        const p = state.players[idx];
        if (sel[0] === 'yes' && budgetOf(p) >= 1 && p.used.includes('No.66')) { p.costSpent += 1; p.freezeAtEnd.push('No.66'); log(state, `アイシクルドロップ：支付 1 cost，回合結束時凍結`); }
        break;
      }
      case 'discard_setarea_from': {
        const src = state.players[pc.sourcePlayer];
        const ref = sel[0] || '';
        const [zone, cid] = [ref.slice(0, 4), ref.slice(4)];
        if (zone === 'SUB:' && src.subsSafeEOT) { log(state, `🛐 聖域のフローライト：配下不會被棄置`); break; }
        if (zone === 'SUB:') { const j = src.subordinates.findIndex(x => x.cardId === cid); if (j >= 0) { src.subordinates.splice(j, 1); src.discard.push(cid); } }
        if (zone === 'FRZ:') { const j = src.frozen.indexOf(cid); if (j >= 0) { src.frozen.splice(j, 1); src.discard.push(cid); } }
        if (zone === 'SET:') { const j = src.setArea.indexOf(cid); if (j >= 0) { src.setArea.splice(j, 1); src.discard.push(cid); } }
        if (zone === 'TOK:') { const k = parseInt(cid); if (src.tokens[k]) { src.discard.push(src.tokens[k].cardId); src.tokens.splice(k, 1); } }
        if (zone === 'ATT:') {
          const k = parseInt(cid); const a = src.attachments[k];
          if (a) { src.attachments.splice(k, 1); src.discard.push(a.sourceCard); if (a.kind === '外套') { src.coatActive = false; } }
        }
        const shown = (zone === 'TOK:' || zone === 'ATT:') ? cid.split(':')[1] : cid;
        if (zone) log(state, `${src.name} 設置區的「${(CARDS[shown]||{}).namecn||shown}」被棄置`);
        break;
      }
      case 'pay_or_invalidate': {
        const pend = state.pending; const p = state.players[idx];
        if (!pend) break;
        if (sel[0] === 'yes' && budgetOf(p) >= 1) { p.costSpent += 1; log(state, `${p.name} 支付 1 cost，攻擊不被無效化`); }
        else { pend.invalidated = true; log(state, `${p.name} 不支付 → 攻擊被無效化`); }
        return;
      }
      case 'coin_ex1': {
        const p = state.players[idx];
        if (!sel.length) { log(state, `${p.name} 不進行金貨交換`); beginTurnRest(state); return; }
        let total = 0; const returned = [];
        // 先處理 token（依索引由大到小移除）
        const toks = sel.filter(r => r.startsWith('TOK:')).map(r => parseInt(r.split(':')[1])).sort((a, b) => b - a);
        for (const k of toks) { const t = p.tokens[k]; if (t) { total += t.coin || 0; p.tokens.splice(k, 1); p.hand.push(t.cardId); returned.push(t.cardId); } }
        for (const r of sel.filter(r => r.startsWith('SUB:'))) {
          const j = p.subordinates.findIndex(x => x.cardId === r.slice(4));
          if (j >= 0) { const sub = p.subordinates.splice(j, 1)[0]; total += sub.coin || 0; p.hand.push(sub.cardId); returned.push(sub.cardId); }
        }
        log(state, `🪙 金貨交換：${p.name} 收回 ${returned.map(c => (CARDS[c]||{}).namecn).join('、')}（金貨 ${total}）`);
        // 手牌中「別的」金貨卡（剛收回的不算）
        const skip = {}; returned.forEach(c => skip[c] = (skip[c] || 0) + 1);
        const opts = [];
        p.hand.forEach((cid, k) => { if (coinOf(cid) > 0) { if (skip[cid]) { skip[cid]--; return; } if (coinOf(cid) <= total) opts.push('H:' + k + ':' + cid); } });
        if (!opts.length || total <= 0) { beginTurnRest(state); return; }
        requirePick(state, { forIdx: idx, sourcePlayer: idx, type: 'pick_coin', count: opts.length, cardId: null, limit: total,
          prompt: `金貨交換：從手牌選金貨卡放到設置區（金貨合計 ≤ ${total}）`, action: 'coin_ex2', options: opts });
        return;
      }
      case 'coin_ex2': {
        const p = state.players[idx];
        let left = pc.limit || 0;
        const picks = sel.map(r => ({ k: parseInt(r.split(':')[1]), cid: r.split(':')[2] })).sort((a, b) => b.k - a.k);
        const placed = [];
        for (const { k, cid } of picks) {
          const v = coinOf(cid);
          if (v > left || p.hand[k] !== cid) continue;
          left -= v; p.hand.splice(k, 1);
          if (cid === 'No.41') p.tokens.push({ cardId: 'No.41', name: '徴税剣', coin: 1 });
          else { const spec = SUBORDINATE_TABLE[cid]; p.subordinates.push({ cardId: cid, name: spec.name, atk: spec.atk, def: spec.def, coin: spec.coin || 0, isDoll: !!spec.isDoll, action: spec.action }); }
          placed.push(cid);
        }
        if (placed.length) log(state, `🪙 金貨交換：${p.name} 將 ${placed.map(c => (CARDS[c]||{}).namecn).join('、')} 放到設置區`);
        beginTurnRest(state);
        return;
      }
      case 'cresc_x': {
        const p = state.players[idx];
        let X = parseInt(String(sel[0] || 'x0').slice(1)) || 0;
        if (X > budgetOf(p)) X = 0;
        if (X > 0) { p.costSpent += X; log(state, `錬成：支付 ${X} cost，攻擊力 +${X}`); }
        queueAttack(state, idx, 'No.74', 'attack', pc.base + X, { fromSub: 'No.74', atkMul: 0 });
        return;
      }
      case 'rinkou_dmg': {
        const ev = pc.ev;
        if ((sel[0] === '+1' || sel[0] === '-1') && useRinkou(state, idx)) {
          ev.dmg = sel[0] === '+1' ? ev.dmg + 1 : Math.max(0, ev.dmg - 1);
          log(state, `✨ ${state.players[idx].name} 棄置燐光：傷害 ${sel[0]} → ${ev.dmg}`);
        }
        askRinkouDmg(state, ev);
        return;
      }
      case 'rinkou': {
        const pend = state.pending;
        if (!pend || pend.stage !== 'rinkou') break;
        if (sel[0] === '+1' || sel[0] === '-1') {
          // 〈燐光〉：このカードを捨て札にしても良い。そうした場合、そのダメージを+1するか、-1する。
          const pl = state.players[idx];
          const ai = pl.attachments.findIndex(a => a.kind === '燐光');
          if (ai >= 0) {
            const a = pl.attachments.splice(ai, 1)[0];
            if (a.sourceCard) pl.discard.push(a.sourceCard);
            pend.finalDmg = sel[0] === '+1' ? pend.finalDmg + 1 : Math.max(0, pend.finalDmg - 1);
            log(state, `✨ ${pl.name} 棄置燐光：傷害 ${sel[0]} → ${pend.finalDmg}`);
          }
        }
        askRinkou(state);
        return;
      }
      case 'renseion_choice_value': {
        // No.85 金剛劍
        const p = state.players[idx];
        const c = sel[0] || 'skip';
        let nr = c === 'no_react' || c === 'both';
        let nd = c === 'no_def' || c === 'both';
        const need = (nr ? 1 : 0) + (nd ? 5 : 0);
        if (need > budgetOf(p)) { nr = nd = false; }
        else if (need > 0) { p.costSpent += need; log(state, `錬成 ${need} cost：${nr ? '無法被反應 ' : ''}${nd ? '無視防禦' : ''}`); }
        queueAttack(state, idx, 'No.85', 'attack', ATKof(p), { unstoppable: nr, ignoreDef: nd });
        break;
      }
      case 'reuse_85': {
        const p = state.players[idx];
        if (sel[0] === 'yes' && budgetOf(p) >= 2 && !p.reusedThisTurn.has('No.85') && p.used.includes('No.85')) {
          p.costSpent += 2; p.reusedThisTurn.add('No.85');
          log(state, `${p.name} 支付 2 cost 再次使用「金剛劍」`);
          CARD_HANDLERS['No.85'].resolve(state, idx, {});
        }
        break;
      }
      case 'optional_followup': {
        // No.44 ダズル / No.84 エマージェンス
        const p = state.players[idx];
        const ex = pc.extra || {};
        const exCost = Math.max(0, ex.cost - (p.magicCostDiscount || 0));   // ダズル／エマージェンス 為◆魔法
        if (sel[0] === 'yes' && budgetOf(p) >= exCost) {
          p.costSpent += exCost;
          if (ex.selfDmg) dealDamage(state, idx, ex.selfDmg, null, '代償');
          queueAttack(state, idx, pc.cardId, 'magic', ex.dmg + p.magicDmgBonus, { ignoreDef: true, noChainTrigger: true });
        }
        break;
      }
    }
    checkVictory(state);
  }

  // 相手のセットエリアにあるカード（配下・凍結・裏向きの布石・金貨token・付与カード）中 cost ≤ max 者
  // ◆補助的行動：可被具◆補助符號的布石反應（靜寂のクリスタル、明滅のアレキサンドライト、迷い道のトパーズ、ぬくもりのアンバー、極光の空のオパール）
  function isAidAction(cardId, choice) {
    const c = CARDS[cardId] || {};
    if ((c.types || []).includes('aid')) return true;
    if (cardId === 'No.51' || cardId === 'No.71') return true;
    if (cardId === 'No.91' && choice?.choice === 'heal') return true;
    return false;
  }
  function openAidWindow(state, idx, cardId, fn, opts = {}) {
    const p = state.players[idx], opp = state.players[1 - idx];
    const symbolUsedBefore = p.symbolsUsed.has('aid');
    p.symbolsUsed.add('aid');
    if (p.lockedSymbols.has('aid')) { log(state, `🔒 迷い道のトパーズ：本回合◆補助行動皆被無效化`); return; }
    if (opts.unreactable || opp.setArea.length === 0) { fn(); return; }
    state.pending = { attackerIdx: idx, defenderIdx: 1 - idx, cardId, kind: 'aid', reactable: true,
      fromSub: opts.fromSub || null, symbolUsedBefore, applyFn: fn, previewDamage: 0 };
    log(state, `→ ${p.name} 的◆補助行動「${opts.label || (CARDS[cardId] || {}).namecn}」（對手可反應）`);
  }
  const RESP_SYMBOLS = { 'No.40': ['attack', 'aid'], 'No.37': ['attack', 'magic', 'aid'], 'No.57': ['attack', 'magic', 'aid'],
                         'No.79': ['attack', 'magic', 'aid'], 'No.80': ['attack', 'magic', 'aid'] };
  function setAreaRefs(o, max) {
    const ok = cid => ((CARDS[cid] || {}).cost || 0) <= max;
    return [
      ...o.subordinates.filter(x => ok(x.cardId)).map(x => 'SUB:' + x.cardId),
      ...o.frozen.filter(ok).map(c => 'FRZ:' + c),
      ...o.setArea.filter(ok).map(c => 'SET:' + c),
      ...(o.tokens || []).map((t, k) => ok(t.cardId) ? 'TOK:' + k + ':' + t.cardId : null).filter(Boolean),
      ...o.attachments.map((a, k) => a.sourceCard && ok(a.sourceCard) ? 'ATT:' + k + ':' + a.sourceCard : null).filter(Boolean)
    ];
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
      hp: 15, voltage: 0, atkBase: 0, defBase: 0,  // 初始 HP 15（規則書 P.4：ライフストーン置於 15）
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
      tokens: [],                 // 徵稅劍：付與帶 COIN 的代用 token
      bonusBudget: 0,             // 鼓動法：本回合額外可用 cost
      frozenLocked: new Set(),    // 本回合才被凍結（束縛之榍石）→ 下回合起才能啟動
      freezeAtEnd: [],            // 凍結卡：本回合結束時才移入設置區
      usedResponses: [],          // 已翻開處理的反應卡：對手回合結束時才進棄牌
      dmgReduceEOT: 0,            // 「ターン終了時まで、あなたが受けるダメージは-N」
      jade: 0,                    // 干渉拒絶のジェイド：攻擊終了時對對手造成 1 傷害
      magicCostDiscount: 0,       // 紋章劍：ターン終了時まで◆魔法のコスト-1
      subAtkDebuff: 0,            // 錆這いのモルガナイト：配下攻擊力 -2
      symbolsUsed: new Set(),     // 迷い道のトパーズ：本回合用過的攻擊符號
      lockedSymbols: new Set(),
      activatedFromFrozen: new Set()
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
        reactable: state.pending.reactable && !state.pending.stage,
        aidLabel: state.pending.kind === 'aid' ? ((CARDS[state.pending.cardId] || {}).namecn || '') : null,
        fromSub: state.pending.fromSub || null
      } : null,
      log: state.log.slice(-40),
      players: state.players.map((p, i) => ({
        idx: i, name: p.name, hp: p.hp, voltage: p.voltage,
        atk: ATKof(p),
        def: DEFof(p),
        costSpent: p.costSpent,
        budget: Math.max(0, budgetOf(p)),
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
        responseCostDiscount: 0,
        magicCostDiscount: p.magicCostDiscount || 0,
        poison: poisonCount(p) > 0, poisonCount: poisonCount(p), cannotHeal: p.cannotHeal,
        usedResponses: p.usedResponses || [],
        frozenLocked: i === viewerIdx ? [...(p.frozenLocked || [])] : [],
        ready: p.ready, deckChosen: p.deck.length === 7
      }))
    };
  }

  // ---------- Match flow ----------
  function submitDeck(state, idx, deck) {
    if (state.phase !== 'deck-select') return err(state, '不在選牌階段');
    if (!Array.isArray(deck) || deck.length !== 7) return err(state, '請選 7 張');
    const seen = {};
    for (const id of deck) {
      seen[id] = (seen[id] || 0) + 1;
      if (seen[id] > 2) return err(state, '同名卡最多 2 張');
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
      p.hp = 15; p.voltage = 0; p.atkBase = 0; p.defBase = 0;
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
      p.bonusBudget = 0; p.frozenLocked = new Set(); p.freezeAtEnd = []; p.usedResponses = [];
      p.dmgReduceEOT = 0; p.jade = 0; p.magicCostDiscount = 0; p.subAtkDebuff = 0;
      p.symbolsUsed = new Set(); p.lockedSymbols = new Set(); p.activatedFromFrozen = new Set();
    });
    state.subQueue = []; state.dayNightFlipped = false;
    // 後攻 compensation: ATK=1, get 鼓動法
    const secondIdx = 1 - state.firstPlayer;
    state.players[secondIdx].atkBase = 1;
    state.players[secondIdx].breath.push(BC.BEAT);
    log(state, `對戰開始！${state.players[state.firstPlayer].name} 先手；${state.players[secondIdx].name} 後攻獲得 +1 攻擊力與「鼓動法」。`);
    beginTurn(state);
  }


  // ----- 配下行動（規則：配下的行動也可被反應，故逐一排入結算） -----
  function queueSubordinateActions(state, idx, onlySub, forceNight, front, bonus) {
    const p = state.players[idx];
    const subs = onlySub ? [onlySub] : p.subordinates.slice();
    const jobs = subs.flatMap(sub => Array((sub.action && sub.action.hits) || 1).fill(0).map(() => ({ idx, cardId: sub.cardId, forceNight: !!forceNight, bonus: bonus || 0 })));
    state.subQueue = front ? jobs.concat(state.subQueue || []) : (state.subQueue || []).concat(jobs);
  }
  function processSubQueue(state) {
    promoteChoice(state);
    while (state.phase === 'playing' && !state.pending && !state.pendingChoice && state.subQueue && state.subQueue.length) {
      const job = state.subQueue.shift();
      const p = state.players[job.idx];
      const sub = p.subordinates.find(x => x.cardId === job.cardId);
      if (!sub) continue;
      if (p.subsNullEOT) { log(state, `🛐 聖域のフローライト：「${sub.name}」的行動被無效化`); continue; }
      const nm = (CARDS[sub.cardId] || {}).namecn;
      if (nm && p.sealed.has(nm)) { log(state, `🔒 「${sub.name}」被封印，無法行動`); continue; }
      runSubAction(state, job.idx, sub, job.forceNight, job.bonus);
      checkVictory(state);
    }
  }
  function runSubAction(state, idx, sub, forceNight, bonus) {
    const p = state.players[idx];
    const night = forceNight || state.isNight;
    const a = sub.action;
    if (!a) return;
    const so = { fromSub: sub.cardId };
    switch (a.kind) {
      case 'attack':
        log(state, `🐂 ${p.name} 的「${sub.name}」物理攻擊`);
        queueAttack(state, idx, sub.cardId, 'attack', (night ? a.nightDmg : a.dayDmg) + subPhysBonus(p, night) + (bonus || 0), { ...so, atkMul: 0 });
        break;
      case 'magic':
        log(state, `✨ ${p.name} 的「${sub.name}」魔法攻擊`);
        queueAttack(state, idx, sub.cardId, 'magic', a.dmg + subMagBonus(p), { ...so, ignoreDef: true });
        break;
      case 'magic_self_dmg':
        dealDamage(state, idx, a.selfDmg, null, '代償');
        queueAttack(state, idx, sub.cardId, 'magic', a.dmg + subMagBonus(p), { ...so, ignoreDef: true });
        break;
      case 'attack_user_atk':
        log(state, `🗡 ${p.name} 的「${sub.name}」物理攻擊`);
        queueAttack(state, idx, sub.cardId, 'attack', ATKof(p) + subPhysBonus(p, night) + (bonus || 0), { ...so, atkMul: 1 });
        break;
      case 'dayheal_or_nightmagic':
        if (night) queueAttack(state, idx, sub.cardId, 'magic', a.nightDmg + subMagBonus(p), { ...so, ignoreDef: true });
        else openAidWindow(state, idx, sub.cardId, () => healPlayer(state, idx, a.dayHeal), { fromSub: sub.cardId, label: `${sub.name}：ヒール` });   // ◆補助 ヒール
        break;
      case 'passive':
        if (a.atkBonus)   { p.atkBuff += a.atkBonus;   log(state, `🛡 ${sub.name} 加成：${p.name} 攻擊力 +${a.atkBonus}`); }
        if (a.magicBonus) { p.magicDmgBonus += a.magicBonus; log(state, `🛡 ${sub.name} 加成：${p.name} 魔法傷害 +${a.magicBonus}`); }
        if (night && a.nightAtk) { p.atkBuff += a.nightAtk; log(state, `🌙 ${sub.name}（月）：${p.name} 攻擊力 +${a.nightAtk}`); }
        if (!night && a.dayDef)  { p.defBuff += a.dayDef;  log(state, `☀ ${sub.name}（日）：${p.name} 防禦力 +${a.dayDef}`); }
        break;
      case 'choose_56':
        requirePick(state, { forIdx: idx, sourcePlayer: idx, type: 'pick_yesno', count: 1, cardId: 'No.56',
          prompt: `「${sub.name}」：選擇 無慈悲殴り（物理 ATK9）或 ヴォイド（魔法 4）`, action: 'sub56_choice', options: ['attack', 'magic'] });
        break;
      case 'attack_74': {
        // 銀駆けの爪牙：後攻なら攻撃力+1、錬成（Xコスト）なら3コストにつき+3
        const base = 1 + (state.firstPlayer !== idx ? 1 : 0) + subPhysBonus(p, night) + (bonus || 0);
        const maxX = Math.floor(budgetOf(p) / 3) * 3;
        if (maxX >= 3) {
          const opts = []; for (let x = 0; x <= Math.min(maxX, 9); x += 3) opts.push('x' + x);
          requirePick(state, { forIdx: idx, sourcePlayer: idx, type: 'pick_yesno', count: 1, cardId: 'No.74', base,
            prompt: `「${sub.name}」銀駆けの爪牙：錬成要支付幾 cost？（每 3 cost 攻擊力 +3）`, action: 'cresc_x', options: opts });
        } else queueAttack(state, idx, sub.cardId, 'attack', base, { ...so, atkMul: 0 });
        break;
      }
      case 'magic_75': {
        const n = p.setArea.length + p.frozen.length + p.subordinates.length + (p.tokens || []).length + p.attachments.length;
        queueAttack(state, idx, sub.cardId, 'magic', (n >= 4 ? 2 : 1) + subMagBonus(p), { ...so, ignoreDef: true });
        break;
      }
      case 'win_if_higher':   // ◆補助 末梢の楔（cost 0 → 極光の空のオパール 不能擋，ぬくもりのアンバー 可）
        openAidWindow(state, idx, sub.cardId, () => {
          if (p.hp > state.players[1 - idx].hp) { state.players[1 - idx].hp = 0; log(state, `※ ${sub.name}：你的生命比對手多，立即勝利！`); }
          else log(state, `${sub.name}：末梢の楔 條件未達成`);
        }, { fromSub: sub.cardId, label: `${sub.name}：末梢の楔` });
        break;
    }
  }

  // 回合開始時的處理（規則書 P.4）：①VOLTAGE+1（已 9 則 Burst 失 1 生命）②付與卡的回合開始效果 ③配下的回合開始效果
  function beginTurn(state) {
    if (state.phase !== 'playing') return;
    const ci = state.currentTurn;
    const p = state.players[ci];

    p.costSpent = 0; p.bonusBudget = 0; p.magicDmgBonus = 0;
    p.magicBonusOnceThisTurn = 0;
    p.reusedThisTurn = new Set();
    p.responseCostDiscount = 0;
    p.magicCountThisTurn = 0;
    // 包裹之波萊羅：回合開始時返回手牌
    if (p.coatActive) {
      p.coatActive = false; p.coatDef = 0;
      const coat = p.attachments.find(a => a.kind === '外套');
      if (coat) { removeAttach(state, ci, '外套'); p.hand.push(coat.sourceCard); log(state, `🧥 ${p.name}「外套」回到手牌`); }
    }

    // ① VOLTAGE
    if (p.voltage >= 9) { p.hp -= 1; log(state, `⚡ ${p.name} Burst：魔力已為 9，失去 1 點生命`); }
    else p.voltage += 1;
    updateDayNight(state);
    log(state, `——— 回合 ${state.turnNumber}：${p.name} 開始（${state.isNight ? '月' : '日'}）———`);

    // ② GG：金貨交換（1ターン1度、行動ではないのでレスポンス不可）
    if (offerCoinExchange(state, ci)) return;
    beginTurnRest(state);
  }
  const coinOf = cid => (SUBORDINATE_TABLE[cid] && SUBORDINATE_TABLE[cid].coin) || (cid === 'No.41' ? 1 : 0);
  function offerCoinExchange(state, ci) {
    const p = state.players[ci];
    const setItems = [
      ...p.subordinates.filter(x => (x.coin || 0) > 0).map(x => 'SUB:' + x.cardId),
      ...(p.tokens || []).map((t, k) => (t.coin || 0) > 0 ? 'TOK:' + k + ':' + t.cardId : null).filter(Boolean)
    ];
    if (!setItems.length || !p.hand.some(cid => coinOf(cid) > 0)) return false;
    requirePick(state, { forIdx: ci, sourcePlayer: ci, type: 'pick_coin', count: setItems.length, cardId: null,
      prompt: '金貨交換：選擇要收回手牌的設置區金貨卡（可不選＝不交換）', action: 'coin_ex1', options: setItems });
    return true;
  }
  // 回合開始的其餘處理（付與卡 → 配下）
  function beginTurnRest(state) {
    if (state.phase !== 'playing') return;
    const ci = state.currentTurn;
    const p = state.players[ci];
    // ③ 付與卡：毒（每張各失 1 生命）、鈍痛
    const pc = poisonCount(p);
    if (pc > 0) { p.hp -= pc; log(state, `🩸 ${p.name} 中毒（×${pc}）失去 ${pc} 生命`); }
    while (hasAttach(state, ci, '鈍痛')) {
      if (budgetOf(p) >= 1) { p.costSpent += 1; log(state, `${p.name} 鈍痛：支付 1 cost 解除`); }
      else log(state, `${p.name} 鈍痛：魔力不足，自動解除`);
      removeAttach(state, ci, '鈍痛');
    }
    checkVictory(state);
    if (state.phase !== 'playing') return;

    // ④ 配下的回合開始效果（逐一結算，可被反應）
    queueSubordinateActions(state, ci);
    processSubQueue(state);
  }

  // 回合結束時的處理（規則書 P.5）
  function endTurn(state, idx) {
    if (state.phase !== 'playing') return err(state, '不在進行中');
    if (state.currentTurn !== idx) return err(state, '不是你的回合');
    if (state.pending) return err(state, '尚有未結算的攻擊');
    if (state.pendingChoice || (state.choiceQueue && state.choiceQueue.length)) return err(state, '尚有未完成的選擇');
    if (state.subQueue && state.subQueue.length) return err(state, '配下行動尚未結算完');
    const p = state.players[idx];
    const opp = state.players[1 - idx];

    // 回合結束時魔力 +1 類效果（加速之輪舞曲等）；Burst 只發生在回合開始，這裡已 9 就不再增加
    if (p.extraVoltageThisTurn) {
      p.voltage = clamp(p.voltage + p.extraVoltageThisTurn, 0, 9);
      p.extraVoltageThisTurn = 0;
      updateDayNight(state);
    }

    // 出牌區的表向卡：凍結 → 設置區；有 L → 棄牌；無 L 劍卡 → 手牌
    for (const cid of p.used) {
      const c = CARDS[cid];
      const fd = (p._forceDiscard || []).indexOf(cid);
      if (fd >= 0) {
        p._forceDiscard.splice(fd, 1); p.discard.push(cid);
        log(state, `🔥 ${(c || {}).namecn} 因效果棄置`); continue;
      }
      const fz = p.freezeAtEnd.indexOf(cid);
      if (fz >= 0) {
        p.freezeAtEnd.splice(fz, 1); p.frozen.push(cid);
        log(state, `❄ 「${(c || {}).namecn}」凍結於設置區（下回合起可免費啟動）`); continue;
      }
      if (c.restrict === 'L') p.discard.push(cid); else p.hand.push(cid);
    }
    p.used = []; p.freezeAtEnd = [];
    // 呼吸法：無 L 回到面前；有 L（鼓動法）進棄牌
    for (const cid of p.breathUsed) {
      if ((CARDS[cid] || {}).restrict === 'L') p.discard.push(cid); else p.breath.push(cid);
    }
    p.breathUsed = [];
    p.frozenLocked = new Set(); opp.frozenLocked = new Set();

    // 對手：未翻開的反應卡回手牌、已處理的反應卡進棄牌
    if (opp.setArea.length > 0) {
      log(state, `${opp.name} 未使用的反應卡 ${opp.setArea.length} 張回到手牌`);
      for (const cid of opp.setArea) opp.hand.push(cid);
      opp.setArea = [];
    }
    for (const cid of opp.usedResponses) opp.discard.push(cid);
    opp.usedResponses = [];

    if (state.dayNightFlipped) { state.dayNightFlipped = false; updateDayNight(state); }
    // 「本回合／ターン終了時まで」的暫時效果結束
    for (const pl of state.players) {
      pl.atkBuff = 0; pl.defBuff = 0; pl.dmgReduceEOT = 0; pl.jade = 0;
      pl.magicCostDiscount = 0; pl.subAtkDebuff = 0; pl.ravenBonus = 0; pl.ravenCarry = 0; pl.subsNullEOT = false; pl.subsSafeEOT = false; pl.magicBonusOnceThisTurn = 0;
      pl.symbolsUsed = new Set(); pl.lockedSymbols = new Set(); pl.activatedFromFrozen = new Set();
    }

    log(state, `${p.name} 結束回合。`);
    state.currentTurn = 1 - state.currentTurn;
    if (state.currentTurn === state.firstPlayer) state.turnNumber++;
    beginTurn(state);
  }

  function checkVictory(state) {
    if (state.phase === 'game-over') return;
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
  function canAfford(p, cost) { return cost <= budgetOf(p); }
  function chargeCost(p, cost) { p.costSpent += cost; }

  // ---------- Card play ----------
  function playCard(state, idx, cardId, choice) {
    if (state.phase !== 'playing') return err(state, '不在對戰中');
    if (state.pending) return err(state, '等待反應結算中');
    if (state.pendingChoice) return err(state, '等待選擇中');
    if (state.currentTurn !== idx) return err(state, '不是你的回合');
    const p = state.players[idx];
    const card = CARDS[cardId];
    if (!card) return err(state, '無此卡');
    // 封厄のアゲート：瑪瑙下方卡片的同名卡無法使用（官方 Q&A Q26）
    if (card.namecn && p.sealed.has(card.namecn)) return err(state, `「${card.namecn}」已被封印，無法使用`);
    // Determine source pile (breath in front, or hand)
    const inBreath = p.breath.indexOf(cardId);
    const inHand = p.hand.indexOf(cardId);
    if (inBreath < 0 && inHand < 0) return err(state, '不可使用此卡');

    // Cost: 加護法 (BC.2) chooses X cost; stones cost 1 (fixed)
    let cost = typeof card.cost === 'number' ? card.cost : 0;
    // 開花するスケルツォ 錬成（付費前）：配下の「ドール」1枚を手札に戻し、コストを-X
    let scherzoDoll = null;
    if (cardId === 'No.32' && choice?.renseionDoll) {
      scherzoDoll = p.subordinates.find(x => x.cardId === choice.renseionDoll && x.isDoll) || null;
      if (scherzoDoll) cost = Math.max(0, cost - ((CARDS[scherzoDoll.cardId] || {}).cost || 0));
    }
    // 加護法：COST 為自己決定的 X（可為 0）
    if (cardId === BC.GUARD) cost = clamp(Number.isInteger(choice?.x) ? choice.x : 1, 0, Math.max(0, budgetOf(p)));
    // 反應卡：一律 1 cost
    if (card.types.includes('stone')) cost = 1;
    // 紋章劍 追加：ターン終了時まで◆魔法のコスト-1
    if (card.types.includes('magic')) cost = Math.max(0, cost - (p.magicCostDiscount || 0));
    // スパイラルセージ：このターンに1度でも魔法攻撃が行われているならコスト-1
    if (cardId === 'No.68' && (p.magicCountThisTurn || 0) > 0) cost = Math.max(0, cost - 1);
    if (!canAfford(p, cost)) return err(state, `本回合可花費餘額不足 (剩 ${budgetOf(p)}，需 ${cost})`);

    if (scherzoDoll) {
      p.subordinates.splice(p.subordinates.indexOf(scherzoDoll), 1); p.hand.push(scherzoDoll.cardId);
      log(state, `🎴 錬成：人偶「${scherzoDoll.name}」返回手牌，本卡 cost 變為 ${cost}`);
    }
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

    log(state, `${p.name} 使用「${card.namecn}」 (花費 ${cost}，剩 ${budgetOf(p)})`);
    if (isAidAction(cardId, choice)) openAidWindow(state, idx, cardId, () => applyCardEffect(state, idx, cardId, cost, choice), { unreactable: cardId === 'No.76' });
    else applyCardEffect(state, idx, cardId, cost, choice);
    checkVictory(state);
  }


  // ===================== CARD_HANDLERS (per-card overrides) =====================
  // These override the generic switch-case logic when present.
  // Each handler returns nothing; mutates state directly.

  function countBlueCards(state, idx) {
    const p = state.players[idx];
    // パイロガーランド：プレイエリア、セットエリア、捨て札にある◆魔法（自身含む）
    const allIds = [...p.used, ...p.discard, ...p.frozen, ...p.subordinates.map(s=>s.cardId),
      ...p.attachments.map(a => a.sourceCard).filter(Boolean), ...(p.tokens||[]).map(t => t.cardId)];
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

  function ATK(s, i) { const p = s.players[i]; return ATKof(p); }
  const CARD_HANDLERS = {
    // -------- BR pack --------
    'No.01': { resolve(s,i) { queueAttack(s,i,'No.01','attack', ATK(s,i), {}); } },
    'No.02': { resolve(s,i) { queueAttack(s,i,'No.02','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      const p = s.players[i];
      if (p.used.includes('No.02') && budgetOf(p) >= 1) {   // この攻撃の直後、もう一度1コストで使用できる（可連續）
        requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_yesno', count: 1, cardId: 'No.02',
          prompt: '舞踏劍：付 1 cost 再次使用？',
          action: 'reuse_card',
          options: ['yes','no']
        });
      }
    } },  // reuse omitted
    'No.03': { resolve(s,i) { queueAttack(s,i,'No.03','attack', ATK(s,i), { unstoppable:true }); } },
    'No.04': { resolve(s,i) { queueAttack(s,i,'No.04','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d,pd) { if (d >= 1 && !(pd && pd.sealAfter)) { const u = s.players[i].used.lastIndexOf('No.04'); if (u >= 0) s.players[i].used.splice(u, 1); attach(s,1-i,'毒',{sourceCard:'No.04'}); } } },
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
    'No.07': { resolve(s,i) { queueAttack(s,i,'No.07','magic', 1 + s.players[i].magicDmgBonus, { ignoreDef:true }); } },
    'No.08': { resolve(s,i) { queueAttack(s,i,'No.08','magic', 3 + s.players[i].magicDmgBonus, { ignoreDef:true }); dealDamage(s, i, 3, null, '代償'); } },
    'No.09': { resolve(s,i) { let d = (s.players[i].hand.length === 0 ? 6 : 3) + s.players[i].magicDmgBonus; queueAttack(s,i,'No.09','magic', d, { ignoreDef:true }); } },
    'No.10': { resolve(s,i) { queueAttack(s,i,'No.10','magic', Math.ceil(s.players[1-i].hp/2), { ignoreDef:true }); } },
    'No.11': { resolve(s,i) { queueAttack(s,i,'No.11','magic', s.players[1-i].hp, { ignoreDef:true }); } },
    'No.12': { resolve(s,i) { const p = s.players[i]; const u = p.used.lastIndexOf('No.12'); if (u >= 0) p.used.splice(u, 1); attach(s,i,'燐光',{sourceCard:'No.12'}); } },
    'No.13': { resolve(s,i) { healPlayer(s,i,4); } },
    'No.14': { resolve(s,i) { s.players[i].atkBuff += 2; log(s,`→ ${s.players[i].name} ATK +2 (本回合)`); } },
    'No.15': { resolve(s,i) { s.players[i].extraVoltageThisTurn += 1; } },
    'No.16': { resolve(s,i) { summonSubordinate(s,i,'No.16'); } },
    // Stones (BR) — applied via reactStone hook (existing logic mostly fine)

    // -------- NT pack --------
    'No.21': { resolve(s,i) { queueAttack(s,i,'No.21','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      // 【夜】追加：相手に2ダメージを与える（防禦力無關）
      if (s.isNight && d >= 1) dealDamage(s, 1-i, 2, i, '夜想劍 追加');
    } },
    'No.22': { resolve(s,i) { queueAttack(s,i,'No.22','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      // この攻撃の直後、あなたの「加護法」を捨て札にしても良い。そうした場合、もう一度0コストでこのカードを使用する（使用済みの加護法も可）
      const p = s.players[i];
      if (p.used.includes('No.22') && (p.breath.includes('BC.2') || p.breathUsed.includes('BC.2')))
        requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_yesno', count: 1, cardId: 'No.22',
          prompt: '黒の剣：棄置「加護法」，以 0 cost 再使用一次？', action: 'kuro_reuse', options: ['yes','no'] });
    } },
    'No.23': { resolve(s,i) { queueAttack(s,i,'No.23','attack', ATK(s,i), { preDefDown: 1 }); } },  // この物理攻撃の前に、相手の防御力を-1する（攻擊前效果，反應之後）
    'No.24': { resolve(s,i) { queueAttack(s,i,'No.24','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      if (d >= 1) {
        const dolls = s.players[i].subordinates.filter(sub => sub.isDoll && sub.cardId !== 'No.33');
        if (dolls.length > 0) {
          requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_doll_night_action', count: 1, cardId: 'No.24',
            prompt: '選 1 個人偶執行其 [月] 行動',
            action: 'execute_doll_night',
            options: dolls.map(sub => sub.cardId)
          });
        }
      }
    } },  // 追加簡化為傷害+2
    'No.25': { resolve(s,i) { const d = s.isNight ? ATK(s,i) : ATK(s,i)*2; queueAttack(s,i,'No.25','attack', d, { atkMul: s.isNight ? 1 : 2 }); } },
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
    'No.30': { resolve(s,i) { const p = s.players[i]; p.coatActive = true;
      p.atkBase = 0; p.atkBuff = 0;   // 代償：あなたの攻撃力を0にする
      { const u = p.used.lastIndexOf('No.30'); if (u >= 0) p.used.splice(u, 1); }
      attach(s,i,'外套',{sourceCard:'No.30'}); log(s,`🧥 ${p.name} 穿上外套 (DEF+2, ATK→0)`); } },
    'No.31': { resolve(s,i) { const p = s.players[i]; p.atkBase = Math.min(9, p.atkBase + 1); log(s,`攻擊力 +1`); dealDamage(s, i, 2, null, '代償'); } },
    'No.32': { resolve(s,i) { s.players[i].extraVoltageThisTurn += 1; } },  // ターン終了時に、あなたのボルテージは+1される（錬成於 playCard 付費前處理）
    'No.33': { resolve(s,i) { summonSubordinate(s,i,'No.33'); } },
    'No.34': { resolve(s,i) { summonSubordinate(s,i,'No.34'); } },
    'No.35': { resolve(s,i) { summonSubordinate(s,i,'No.35'); } },
    'No.36': { resolve(s,i) { summonSubordinate(s,i,'No.36'); } },

    // -------- GG pack --------
    'No.41': { resolve(s,i,choice) {
      // 錬成：1コストを支払う。追加：錬成しているなら（このカードを）付与する。金貨：1
      const p = s.players[i];
      let ren = false;
      if (choice?.renseion && budgetOf(p) >= 1) { p.costSpent += 1; ren = true; log(s, `錬成：支付 1 cost`); }
      queueAttack(s,i,'No.41','attack', ATK(s,i), { renseion: ren });
    }, onAttackEnd(s,i,d,pd) {
      const p = s.players[i];
      if (d >= 1 && pd && pd.renseion && p.used.includes('No.41')) {
        p.used.splice(p.used.lastIndexOf('No.41'), 1);
        p.tokens.push({ cardId: 'No.41', name: '徴税剣', coin: 1 });
        log(s, `🪙 徴税剣 追加：付與到你的設置區（金貨 1）`);
      }
    } },
    'No.42': { resolve(s,i) { queueAttack(s,i,'No.42','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      const p = s.players[i];
      if (p.used.includes('No.42')) {
        // List items in set area with COIN value
        const eligible = [];
        p.subordinates.forEach(sub => { if (sub.coin > 0) eligible.push(sub.cardId); });
        p.tokens.forEach((t,idx) => { if (t.coin > 0) eligible.push('TOKEN:'+idx); });
        if (eligible.length > 0 && budgetOf(p) >= 0) {
          requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_setarea_coin', count: 1, cardId: 'No.42',
            prompt: '絢爛劍：可棄置設置區 1 個 COIN 卡，0 cost 再用',
            action: 'discard_set_then_reuse_42',
            options: eligible
          });
        }
      }
    } },
    'No.43': { resolve(s,i) { queueAttack(s,i,'No.43','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      if (d >= 1) { s.players[i].magicCostDiscount = (s.players[i].magicCostDiscount||0) + 1; log(s,`紋章劍 追加：本回合◆魔法 cost -1`); }
    } },
    'No.44': { resolve(s,i) { queueAttack(s,i,'No.44','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      // 追加：この攻撃の直後、以下を行っても良い。1 ダズル：魔法攻撃(3)
      if (d >= 1 && budgetOf(s.players[i]) >= Math.max(0, 1 - (s.players[i].magicCostDiscount||0))) requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_yesno', count: 1, cardId: 'No.44',
        prompt: '魔導劍 追加：支付 1 cost 進行魔法攻擊 (3)？', action: 'optional_followup', extra: { cost: 1, dmg: 3 }, options: ['yes','no'] });
    } },
    'No.45': { resolve(s,i) { queueAttack(s,i,'No.45','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      if (d >= 1 && s.players[1-i].hand.length > 0) {
        requirePick(s, { forIdx: 1-i, sourcePlayer: 1-i, type: 'pick_hand_card', count: 1, cardId: 'No.45',
          prompt: '從手牌選 1 張棄置', action: 'discard_hand_from',
          options: s.players[1-i].hand });
      }
    } },
    'No.46': { resolve(s,i) { queueAttack(s,i,'No.46','attack', ATK(s,i)*2, { atkMul: 2 }); } },
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
    'No.48': { resolve(s,i,choice) { if (choice?.renseion) { const p = s.players[i]; const u = p.used.lastIndexOf('No.48'); if (u >= 0) p.used.splice(u, 1); attach(s,i,'暗鴉',{sourceCard:'No.48'}); } queueAttack(s,i,'No.48','magic', 1 + s.players[i].magicDmgBonus, { ignoreDef:true }); }, onAttackEnd(s,i,d) { if (d >= 1) s.players[i].ravenBonus = 1; } },
    'No.49': { resolve(s,i,choice) {
      // 錬成：Xコストを支払う → 追加可棄置的範圍變為 cost ≤ 2+X
      const p = s.players[i];
      const X = Math.max(0, Math.min(parseInt(choice?.renseionX) || 0, budgetOf(p)));
      if (X > 0) { p.costSpent += X; log(s, `錬成：支付 ${X} cost（可棄置範圍 cost ≤ ${2 + X}）`); }
      queueAttack(s,i,'No.49','magic', 4 + p.magicDmgBonus, { ignoreDef:true, renseionX: X });
    }, onAttackEnd(s,i,d,pd) {
      // 追加：相手のセットエリアにあるコスト2以下のカード1枚を捨て札にしても良い（錬成 X 未實作）
      if (d < 1) return;
      const lim = 2 + ((pd && pd.renseionX) || 0);
      const eligible = setAreaRefs(s.players[1-i], lim);
      if (eligible.length) requirePick(s, { forIdx: i, sourcePlayer: 1-i, type: 'pick_setarea', count: 1, cardId: 'No.49',
        prompt: `從對手設置區選 1 張 (cost ≤ ${lim}) 棄置（可不選）`, action: 'discard_setarea_from', options: eligible });
    } },
    'No.50': { resolve(s,i) {
      const blue = countBlueCards(s,i);
      queueAttack(s,i,'No.50','magic', blue * 2 + s.players[i].magicDmgBonus, { ignoreDef:true });
      log(s, `烈焰之花冠：藍色卡 ${blue} × 2 = ${blue*2} 傷害`);
    } },
    'No.51': { resolve(s,i,choice) {
      const sel = choice?.choice;
      if (sel === 'heal') healPlayer(s,i,5);
      else if (sel === 'atk') s.players[i].atkBase = Math.min(9, s.players[i].atkBase + 1);
      else if (sel === 'def') s.players[i].defBase = Math.min(9, s.players[i].defBase + 1);
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
    'No.62': { resolve(s,i,choice) { let d = ATK(s,i); if (choice?.renseion === 'discard_heat') { const pp = s.players[i]; const zone = pp.breath.includes('BC.1') ? pp.breath : pp.breathUsed; const hi = zone.indexOf('BC.1'); if (hi>=0) { zone.splice(hi,1); s.players[i].discard.push('BC.1'); d += 2; log(s,`錬成：棄置加熱法，+2傷害`); } } queueAttack(s,i,'No.62','attack', d, {}); } },
    'No.63': { resolve(s,i) { queueAttack(s,i,'No.63','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      // 追加：回合結束時若在出牌區則凍結（需造成 1 以上傷害）
      if (d >= 1 && s.players[i].used.includes('No.63') && !s.players[i].activatedFromFrozen.has('No.63')) s.players[i].freezeAtEnd.push('No.63');
    } },
    'No.64': { resolve(s,i) { queueAttack(s,i,'No.64','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      // 追加：相手のセットエリアにある、コストがX以下のカードを1枚選んで捨て札にしても良い（X=與えたダメージ）
      if (d < 1) return;
      const eligible = setAreaRefs(s.players[1-i], d);
      if (eligible.length) requirePick(s, { forIdx: i, sourcePlayer: 1-i, type: 'pick_setarea', count: 1, cardId: 'No.64',
        prompt: `露払いの白刃：從對手設置區選 1 張（cost ≤ ${d}）棄置（可不選）`, action: 'discard_setarea_from', options: eligible });
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
        if (s.pending) { s.pending.dmgMul = 4; log(s,`手牌不足 2，傷害 ×4`); }
      }
    } },
    'No.66': { freezeFirst: true, resolve(s,i) { queueAttack(s,i,'No.66','magic', 1 + s.players[i].magicDmgBonus, { ignoreDef:true }); }, onAttackEnd(s,i,d) {
      // この攻撃の直後、1コストを支払っても良い。支払った場合、ターン終了時にこのカードを凍結する
      const p = s.players[i];
      if (p.used.includes('No.66') && budgetOf(p) >= 1) requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_yesno', count: 1, cardId: 'No.66',
        prompt: 'アイシクルドロップ：支付 1 cost，回合結束時再凍結？', action: 'refreeze_66', options: ['yes','no'] });
    } },
    'No.67': { resolve(s,i) { queueAttack(s,i,'No.67','magic', 2 + s.players[i].magicDmgBonus, { ignoreDef:true }); }, onAttackEnd(s,i,d) {
      // 追加：ターン終了時まで、あなたの魔法攻撃のダメージは+1される
      if (d >= 1) { s.players[i].magicBonusOnceThisTurn += 1; log(s, `ヴォルテクスビオラ 追加：本回合你的魔法攻擊傷害 +1`); }
    } },
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
        if (budgetOf(p) >= need) {
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
    'No.71': { freezeFirst: true, resolve(s,i,choice) { if (choice?.choice === 'voltage') { s.players[i].bonusBudget = (s.players[i].bonusBudget||0) + 1; log(s,`覚醒の蜜：本回合可多使用 1 cost`); } else s.players[i].atkBuff += 1; } },
    'No.72': { resolve(s,i,choice) {
      const p = s.players[i];
      healPlayer(s, i, 2);
      if (choice?.renseion && budgetOf(p) >= 9) {
        p.costSpent += 9;
        log(s,`錬成 9 cost：發動 2 次龍鳴劍 (ATK 視為 15)`);
        // 竜鳴剣×2：攻撃力を15として扱う物理攻撃。第二次在第一次結算完（含燐光、被無效化時亦同）後才排入
        queueAttack(s,i,'No.72','attack', 15, { atkMul: 0, thenAttack: [i, 'No.72', 'attack', 15, { atkMul: 0 }] });
      }
    } },
    'No.73': { freezeFirst: true, resolve(s,i) {
      // 〈凍結〉あなたか相手のライフを8にする（非回復、非傷害）
      requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_yesno', count: 1, cardId: 'No.73',
        prompt: '調停するカンパネラ：讓誰的生命變為 8？', action: 'campanella', options: ['self', 'opp'] });
    } },
    'No.74': { resolve(s,i) { summonSubordinate(s,i,'No.74'); } },
    'No.75': { resolve(s,i) { summonSubordinate(s,i,'No.75'); } },
    'No.76': { resolve(s,i) { summonSubordinate(s,i,'No.76'); } },

    // -------- LD pack --------
    'No.81': { resolve(s,i) { const a = ATK(s,i); queueAttack(s,i,'No.81','attack', a + (a >= 7 ? 1 : -1), { giten: true }); } },  // 攻撃力6以下ならダメージ-1、7以上なら+1（結算時依當下攻擊力重判）
    'No.82': { resolve(s,i) { queueAttack(s,i,'No.82','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      // 追加：あなたに〈燐光〉を付与しても良い（本卡移到設置區，使用燐光時棄置）
      const p = s.players[i];
      if (d >= 1 && p.used.includes('No.82')) { p.used.splice(p.used.lastIndexOf('No.82'), 1); attach(s,i,'燐光',{sourceCard:'No.82'}); }
    } },
    'No.83': { resolve(s,i,choice) {
      // 錬成：このカードを[L]にする。追加：錬成している場合、相手は自分の手札を1枚選んで捨て札にする
      const ren = !!choice?.renseion;
      if (ren) { const p = s.players[i]; p._forceDiscard = p._forceDiscard || []; p._forceDiscard.push('No.83'); log(s, `錬成：片腹打ちの杭 成為 [L]`); }
      queueAttack(s,i,'No.83','attack', ATK(s,i), { renseion: ren });
    }, onAttackEnd(s,i,d,pd) {
      if (d >= 1 && pd && pd.renseion && s.players[1-i].hand.length > 0) {
        requirePick(s, { forIdx: 1-i, sourcePlayer: 1-i, type: 'pick_hand_card', count: 1, cardId: 'No.83',
          prompt: '從手牌選 1 張棄置', action: 'discard_hand_from', options: s.players[1-i].hand });
      }
    } },
    'No.84': { resolve(s,i) { queueAttack(s,i,'No.84','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      // 追加：この攻撃の直後、以下を行っても良い。2 エマージェンス：魔法攻撃(4)　代償：あなたは4ダメージを受ける
      if (d >= 1 && budgetOf(s.players[i]) >= 2) requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_yesno', count: 1, cardId: 'No.84',
        prompt: '天翔之刃 追加：支付 2 cost 進行魔法攻擊 (4)？（代償：自己受 4 傷害）', action: 'optional_followup', extra: { cost: 2, dmg: 4, selfDmg: 4 }, options: ['yes','no'] });
    } },
    'No.85': { resolve(s,i,choice) {
      // 錬成在付費／反應之前處理：1 cost → 無法被反應；5 cost → 無視防禦；可兩者都做
      const have = budgetOf(s.players[i]);
      const options = ['skip'];
      if (have >= 1) options.push('no_react');
      if (have >= 5) options.push('no_def');
      if (have >= 6) options.push('both');
      if (options.length > 1) {
        requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_renseion_85', count: 1, cardId: 'No.85',
          prompt: '金剛劍 錬成：1cost 無法被反應 / 5cost 無視防禦 / 兩者 / 不錬成',
          action: 'renseion_choice_value', options });
        return;
      }
      queueAttack(s,i,'No.85','attack', ATK(s,i), {});
    }, onAttackEnd(s,i,d) {
      // この攻撃の直後、もう一度2コストでこのカードを使用できる
      const p = s.players[i];
      if (!p.reusedThisTurn.has('No.85') && p.used.includes('No.85') && budgetOf(p) >= 2) {
        requirePick(s, { forIdx: i, sourcePlayer: i, type: 'pick_yesno', count: 1, cardId: 'No.85',
          prompt: '金剛劍：支付 2 cost 再使用一次？', action: 'reuse_85', options: ['yes','no'] });
      }
    } },
    'No.86': { resolve(s,i) { queueAttack(s,i,'No.86','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) { if (d >= 1) dealDamage(s, 1-i, 2, i, '怒濤槍 追加'); } },
    'No.87': { resolve(s,i) { queueAttack(s,i,'No.87','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) { if (d >= 1) healPlayer(s,i,d); } },
    'No.88': { resolve(s,i) { queueAttack(s,i,'No.88','attack', ATK(s,i), {}); }, onAttackEnd(s,i,d) {
      if (d >= 1) {
        attach(s, 1-i, '鈍痛', { sourceCard: 'No.88' });
      }
    } },
    'No.89': { resolve(s,i) { queueAttack(s,i,'No.89','attack', ATK(s,i), { preAtkUp: 1 }); } },  // この物理攻撃の前に、攻撃力を+1する（被無效化則不發生）
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
    'No.93': { resolve(s,i) { const p = s.players[i]; healPlayer(s,i,2); const u = p.used.lastIndexOf('No.93'); if (u >= 0) p.used.splice(u, 1); attach(s,i,'水蜜',{sourceCard:'No.93'}); } },
    'No.94': { resolve(s,i) {
      const p = s.players[i];
      const x = s.firstPlayer === i ? Math.max(0, p.voltage - 1) : p.voltage;
      p.atkBase = clamp(x, 0, 9);
      log(s,`迸發：你的 ATK 變為 ${p.atkBase} (${s.firstPlayer === i ? '先攻 X-1' : '後攻 X'})`);
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
        // 規則：只處理「凍結」；本回合結束時移入設置區，下回合起才可免費啟動
        state.players[idx].freezeAtEnd.push(cardId);
        log(state, `❄ ${state.players[idx].name} 使用「${(CARDS[cardId]||{}).namecn||cardId}」：凍結（回合結束時移入設置區）`);
        return;
      }
      h.resolve(state, idx, choice);
      return;
    }
    // Breath
    // 加熱法「あなたの攻撃力は+1される」：改變參數本身（上限 9）
    if (cardId === BC.HEAT) { p.atkBase = Math.min(9, p.atkBase + 1); log(state, `→ ${p.name} 攻擊力 +1（現為 ${p.atkBase}）`); return; }
    // 加護法「あなたの防御力はXになる」
    if (cardId === BC.GUARD) { p.defBase = clamp(paidCost, 0, 9); log(state, `→ ${p.name} 防禦力變為 ${p.defBase}`); return; }
    // 鼓動法「このターンの間、あなたはコストを1多く使用できる」（L）
    if (cardId === BC.BEAT) { p.bonusBudget = (p.bonusBudget || 0) + 1; log(state, `→ ${p.name} 本回合可多使用 1 cost`); return; }

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
    let base = ATKof(p);
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
    return Math.max(0, base);
  }

  function queueAttack(state, attackerIdx, cardId, kind, dmg, opts) {
    const atkP = state.players[attackerIdx];
    // 夢見るソルフェージュ（ネスティコア）：このカードが場にある間、あなたの物理攻撃は魔法攻撃(2)になる
    //   ・只限玩家本人（配下不適用）；符號仍為◆物理（紋章劍、迷い道のトパーズ 依物理判定）
    //   ・卡片本身的傷害加成（灰の剣 +2 等）保留；攻擊力相關計算不再適用
    let asMagic = false;
    if (kind === 'attack' && !opts.fromSub && subsOn(atkP, 'No.95') > 0) {
      const mul = opts.atkMul != null ? opts.atkMul : 1;
      const bonus = Math.max(0, dmg - mul * ATKof(atkP));
      dmg = 2 + bonus;
      opts = { ...opts, ignoreDef: true, atkMul: 0 };
      asMagic = true;
    }
    if (kind === 'magic' || asMagic) atkP.magicCountThisTurn = (atkP.magicCountThisTurn||0) + 1;
    // 振り撒くラプソディー（フィーユ）：あなたと配下の魔法攻撃ダメージ +1（在場期間）
    if (kind === 'magic' || asMagic) dmg += subsOn(atkP, 'No.55');
    // ヴォルテクスビオラ：ターン終了時まで「あなたの」魔法攻撃 +1（配下不適用）
    if ((kind === 'magic' || asMagic) && !opts.fromSub) dmg += (atkP.magicBonusOnceThisTurn || 0);
    // クロウリーシラン 追加：この攻撃の直後に物理攻撃を行う場合 +1（只限下一次攻擊）
    if (atkP.ravenBonus) {
      if (kind === 'attack' && !opts.fromSub) { dmg += atkP.ravenBonus; if (cardId === 'No.24') atkP.ravenCarry = atkP.ravenBonus; }
      atkP.ravenBonus = 0;
    }
    // 迷い道のトパーズ：記錄本回合是否已用過同符號
    const symbolUsedBefore = atkP.symbolsUsed.has(kind);
    atkP.symbolsUsed.add(kind);
    const defenderIdx = 1 - attackerIdx;
    state.pending = {
      attackerIdx, defenderIdx, cardId, kind,
      previewDamage: dmg, rawDamage: dmg,
      reactable: !opts.unstoppable, ignoreDef: opts.ignoreDef,
      noChainTrigger: !!opts.noChainTrigger,
      fromSub: opts.fromSub || null,
      // 攻擊結算 16 步：反應(4) 在確定攻擊力(6) 之前 → 結算時依當下攻擊力重算
      atkMul: opts.atkMul != null ? opts.atkMul : (kind === 'attack' ? 1 : 0),
      atkSnap: ATKof(state.players[attackerIdx]),
      symbolUsedBefore, asMagic,
      thenAttack: opts.thenAttack || null,
      preDefDown: opts.preDefDown || 0, preAtkUp: opts.preAtkUp || 0, renseion: !!opts.renseion, giten: !!opts.giten, renseionX: opts.renseionX || 0
    };
    if (atkP.lockedSymbols.has(kind)) { state.pending.invalidated = true; state.pending.reactable = false; log(state, `🔒 迷い道のトパーズ：本回合此符號的行動皆被無效化`); }
    log(state, `→ ${state.players[attackerIdx].name} ${kind === 'magic' ? '魔法攻擊' : (asMagic ? '物理→魔法攻擊(2)' : '物理攻擊')} ${CARDS[cardId].namecn} 預計 ${dmg} 點${opts.unstoppable ? '（無法反應）' : ''}`);
    if (!state.pending.reactable) resolveAttack(state);
  }

  function resolveAttack(state) {
    const pend = state.pending; if (!pend) return;
    if (pend.kind === 'aid') {
      state.pending = null;
      if (pend.invalidated) log(state, `※ ◆補助行動被無效化`);
      else pend.applyFn();
      checkVictory(state);
      processSubQueue(state);
      return;
    }
    const attacker = state.players[pend.attackerIdx];
    const defender = state.players[pend.defenderIdx];
    if (pend.invalidated) {
      log(state, `※ 攻擊被無效化`); state.pending = null;
      if (pend.thenAttack && state.phase === 'playing') { queueAttack(state, ...pend.thenAttack); if (state.pending) return; }
      processSubQueue(state); return;
    }
    let dmg = pend.previewDamage;
    // 細則 5.2 第 5 步「攻撃前の効果」（在反應之後、確定攻擊力／防禦力之前）
    if (pend.preAtkUp) { attacker.atkBase = Math.min(9, attacker.atkBase + pend.preAtkUp); log(state, `${attacker.name} 攻擊力 +${pend.preAtkUp}（現為 ${attacker.atkBase}）`); }
    if (pend.preDefDown) { defender.defBase = Math.max(0, defender.defBase - pend.preDefDown); log(state, `${defender.name} 防禦力 -${pend.preDefDown}（現為 ${defender.defBase}）`); }
    if (pend.kind === 'attack' && pend.atkMul) dmg = Math.max(0, dmg + pend.atkMul * (ATKof(attacker) - pend.atkSnap));
    if (pend.giten && !pend.asMagic) { const was = pend.atkSnap >= 7 ? 1 : -1, now = ATKof(attacker) >= 7 ? 1 : -1; dmg = Math.max(0, dmg + now - was); }
    if (pend.kind === 'attack' && pend.fromSub && !pend.atkMul && attacker.subAtkDebuff) dmg = Math.max(0, dmg - attacker.subAtkDebuff);
    if (pend.kind === 'attack' && !pend.ignoreDef) {
      // GG 起：受物理攻擊時可改用自己配下的防禦力（取較高者）
      const def = Math.max(DEFof(defender), ...defender.subordinates.map(x => x.def || 0));
      dmg = Math.max(0, dmg - def);
    }
    if (defender.dmgReduceEOT) dmg = Math.max(0, dmg - defender.dmgReduceEOT);
    // 細則 5.2 第 9 步：ターンプレイヤーのダメージ補正（乗算：圧壊剣）
    if (pend.dmgMul) dmg = dmg * pend.dmgMul;
    // 細則 5.2 第 10 步：非ターンプレイヤーのダメージ補正（上書き）
    if (pend.setDmg != null) dmg = pend.setDmg;
    if (pend.zeroIfLE != null && dmg <= pend.zeroIfLE) dmg = 0;
    pend.finalDmg = Math.max(0, dmg);
    // 細則 5.2 第 10/11 步：ターンプレイヤー → 非ターンプレイヤー 的「燐光」（每次產生傷害時可選擇 ±1）
    const tp = state.currentTurn;
    pend.rinkouQueue = [];
    for (const who of [tp, 1 - tp]) {
      const n = state.players[who].attachments.filter(a => a.kind === '燐光').length;
      for (let k = 0; k < n; k++) pend.rinkouQueue.push(who);
    }
    pend.stage = 'rinkou';
    askRinkou(state);
  }

  function askRinkou(state) {
    const pend = state.pending;
    if (!pend || pend.stage !== 'rinkou') return;
    if (pend.rinkouQueue.length === 0) return finishAttack(state);
    const who = pend.rinkouQueue.shift();
    const opts = ['+1', '-1', 'none'];
    requirePick(state, { forIdx: who, sourcePlayer: who, type: 'pick_rinkou', count: 1, cardId: 'No.12',
      prompt: `燐光：本次傷害目前為 ${pend.finalDmg}，要棄置燐光使傷害 +1 或 -1 嗎？`, action: 'rinkou', options: opts });
  }

  function finishAttack(state) {
    const pend = state.pending;
    const attacker = state.players[pend.attackerIdx];
    const defender = state.players[pend.defenderIdx];
    const dmg = Math.max(0, pend.finalDmg);
    pend.stage = 'done';
    defender.hp -= dmg;
    log(state, `※ ${defender.name} 受到 ${dmg} 點傷害（HP ${defender.hp + dmg} → ${defender.hp}）`);

    // 「追加」只在造成 1 點以上傷害時處理（各卡 onAttackEnd 內判斷 d >= 1）
    // 拒卻死亡 revival check
    if (defender._reviveTo2 && defender.hp <= 0) {
      defender.hp = 2;
      log(state, `※ ${defender.name} 拒卻死亡，以 2 HP 復活`);
    }
    defender._reviveTo2 = false;
    if (dmg >= 4) triggerMitsu(state, pend.attackerIdx);
    state.pending = null;  // ← clear before onAttackEnd so 追加 can queue a fresh attack
    checkVictory(state);
    // 封厄のアゲート：攻擊照常結算，「攻擊終了後」把該卡放到瑪瑙下方（細則 6.2–6.4）
    if (pend.sealAfter) {
      const nm = (CARDS[pend.cardId] || {}).namecn || pend.cardId;
      if (pend.fromSub) {
        const j = attacker.subordinates.findIndex(x => x.cardId === pend.fromSub);
        if (j >= 0) attacker.subordinates.splice(j, 1);
        attacker.sealed.add(nm);   // 同名配下也全部無法行動
        log(state, `🔒 封印：${attacker.name} 的配下「${nm}」被放到瑪瑙下方，同名配下無法再行動、同名卡無法再使用`);
      } else {
        const u = attacker.used.lastIndexOf(pend.cardId);
        if (u >= 0) attacker.used.splice(u, 1);
        attacker.sealed.add(nm);
        log(state, `🔒 封印：「${nm}」被放到瑪瑙下方，同名卡無法再使用`);
      }
    }
    // 干渉拒絶のジェイド：攻撃が終了するたびに相手に1ダメージ
    if (defender.jade && state.phase === 'playing') dealDamage(state, pend.attackerIdx, defender.jade, pend.defenderIdx, '干渉拒絶のジェイド');
    // 泥濘のヘリオドール：配下以外の攻撃なら、攻撃終了後その攻撃カードを捨て札にする
    if (pend.discardAfter) { attacker._forceDiscard = attacker._forceDiscard || []; attacker._forceDiscard.push(pend.cardId); }
    // ドール・ピカレスク 腐触のスピアテイル 追加：相手は自分の手札を1枚選んで捨て札にする
    if (pend.fromSub === 'No.36' && dmg >= 1 && defender.hand.length && state.phase === 'playing') {
      requirePick(state, { forIdx: pend.defenderIdx, sourcePlayer: pend.defenderIdx, type: 'pick_hand_card', count: 1, cardId: 'No.36',
        prompt: '腐触のスピアテイル：從手牌選 1 張棄置', action: 'discard_hand_from', options: defender.hand });
    }
    // 追加 / 攻擊終了後 / 直後 效果（追加攻擊本身不再觸發）
    const handler = CARD_HANDLERS[pend.cardId];
    if (handler && handler.onAttackEnd && !pend.noChainTrigger && !pend.fromSub) {
      handler.onAttackEnd(state, pend.attackerIdx, dmg, pend);
    }
    checkVictory(state);
    if (pend.thenAttack && state.phase === 'playing' && !state.pending) queueAttack(state, ...pend.thenAttack);
    processSubQueue(state);
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
    // 召喚 (Y)：即使有 L 也不進棄牌，卡片本身成為設置區的配下
    const ui = p.used.lastIndexOf(cardId);
    if (ui >= 0) p.used.splice(ui, 1);
    p.subordinates.push({ cardId, name: spec.name, atk: spec.atk, def: spec.def, coin: spec.coin || 0, isDoll: !!spec.isDoll, action: spec.action });
    log(state, `🪄 ${p.name} 召喚配下「${spec.name}」 (ATK ${spec.atk} / DEF ${spec.def})`);
  }

  function applyAid(state, idx, cardId, paidCost, choice) {
    const p = state.players[idx]; const opp = state.players[1 - idx];
    switch (cardId) {
      case 'No.12': attach(state, idx, '燐光', { sourceCard: 'No.12' }); break;
      case 'No.13': healPlayer(state, idx, 4); break;
      case 'No.14': p.atkBuff += 2; break;
      case 'No.15': p.extraVoltageThisTurn += 1; break;
      case 'No.16': summonSubordinate(state, idx, cardId); return;
      case 'No.30': p.defBuff += 2; p.atkBuff -= ATKof(p); break;
      case 'No.31': p.atkBase = Math.min(9, p.atkBase + 1); p.hp -= 2; break;
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
      case 'No.94': p.atkBase = clamp(state.firstPlayer === idx ? p.voltage - 1 : p.voltage, 0, 9); break;
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
        else if (sel === 'atk') p.atkBase = Math.min(9, p.atkBase + 1);
        else if (sel === 'def') p.defBase = Math.min(9, p.defBase + 1);
        else p.extraVoltageThisTurn += 1; break;
      case 'No.70':
        if (sel === 'magic') queueAttack(state, idx, cardId, 'magic', 1, { unstoppable: false, ignoreDef: true });
        else queueAttack(state, idx, cardId, 'attack', ATKof(p), { unstoppable: false, ignoreDef: false });
        return;
      case 'No.71':
        if (sel === 'voltage') {
          p.bonusBudget = (p.bonusBudget || 0) + 1;
        } else p.atkBuff += 1;
        break;
      case 'No.91':
        if (sel === 'magic') queueAttack(state, idx, cardId, 'magic', 2, { unstoppable: false, ignoreDef: true });
        else if (sel === 'heal') healPlayer(state, idx, 2);
        else queueAttack(state, idx, cardId, 'attack', ATKof(p), { unstoppable: false, ignoreDef: false });
        return;
      case 'No.92':
        if (sel === 'magic') queueAttack(state, idx, cardId, 'magic', 9, { unstoppable: true, ignoreDef: true });
        else queueAttack(state, idx, cardId, 'attack', ATKof(p) * 3, { unstoppable: true, ignoreDef: false });
        return;
    }
  }

  // Reaction: flip a face-down stone (no extra cost — paid when set)
  function reactStone(state, defenderIdx, cardId) {
    if (!state.pending) return err(state, '沒有可反應的攻擊');
    if (state.pending.defenderIdx !== defenderIdx) return err(state, '不是你被攻擊');
    if (!state.pending.reactable) return err(state, '此次攻擊無法被反應');
    if (state.pending.stage) return err(state, '反應階段已結束');
    if (state.pendingChoice) return err(state, '等待對手選擇中');
    const p = state.players[defenderIdx]; const card = CARDS[cardId];
    if (!card || !card.types.includes('stone')) return err(state, '不是反應卡');
    const inSet = p.setArea.indexOf(cardId);
    if (inSet < 0) return err(state, '場上沒有蓋置此反應卡');
    // レスポンス(Z) 的符號必須對應行動的符號
    const pendSym = state.pending.kind;   // 'attack' | 'magic' | 'aid'（物理→魔法(2) 仍是◆物理）
    if (!(RESP_SYMBOLS[cardId] || ['attack', 'magic']).includes(pendSym))
      return err(state, `「${card.namecn}」不能反應${{ attack: '◆物理', magic: '◆魔法', aid: '◆補助' }[pendSym]}行動`);
    p.setArea.splice(inSet, 1);
    p.usedResponses.push(cardId);   // 處理完的反應卡：對手回合結束時才進棄牌
    log(state, `${p.name} 反應「${card.namecn}」`);

    const pend = state.pending;
    switch (cardId) {
      case 'No.17': p._reviveTo2 = true; break;
      case 'No.18': p.defBuff += 3; break;

      case 'No.19': pend.sealAfter = true; log(state, `🔒 封厄之瑪瑙：攻擊結束後封印該卡`); break;
      case 'No.20': case 'No.40': {
        if (cardId === 'No.40' && pend.kind === 'magic') { log(state, `靜寂之水晶無法反應魔法攻擊（無效果）`); break; }
        // 相手は1コストを支払っても良い。支払わなければ、その攻撃を無効化する。
        const ai = pend.attackerIdx;
        if (budgetOf(state.players[ai]) >= 1) {
          requirePick(state, { forIdx: ai, sourcePlayer: ai, type: 'pick_yesno', count: 1, cardId,
            prompt: `「${card.namecn}」：支付 1 cost 讓這個行動不被無效化？`, action: 'pay_or_invalidate', options: ['yes','no'] });
        } else pend.invalidated = true;
        break;
      }
      case 'No.80': {
        // その行動の本来のコストが3以上なら、相手は1コストを支払っても良い。支払わなければ無効化（配下の行動はコスト0扱い）
        const oc = pend.fromSub ? 0 : ((CARDS[pend.cardId] || {}).cost || 0);
        if (oc < 3) { log(state, `原本 cost ${oc} < 3，無效果`); break; }
        const ai = pend.attackerIdx;
        if (budgetOf(state.players[ai]) >= 1) requirePick(state, { forIdx: ai, sourcePlayer: ai, type: 'pick_yesno', count: 1, cardId,
          prompt: `「${card.namecn}」：支付 1 cost 讓行動不被無效化？`, action: 'pay_or_invalidate', options: ['yes','no'] });
        else pend.invalidated = true;
        break;
      }
      case 'No.37': state.dayNightFlipped = !state.dayNightFlipped; updateDayNight(state); log(state, `🌗 ターン終了時まで昼夜逆轉（現為${state.isNight ? '月' : '日'}）`); healPlayer(state, defenderIdx, 2); break;
      case 'No.38': {
        // 【昼】レスポンス(◆物理)／【夜】レスポンス(◆魔法)：その攻撃で最初に受けるダメージを0にする
        const ok = state.isNight ? pend.kind === 'magic' : pend.kind === 'attack';
        if (ok) pend.setDmg = 0; else log(state, `事象透過のアメジスト：${state.isNight ? '月' : '日'}只能反應${state.isNight ? '魔法' : '物理'}攻擊（無效果）`);
        break;
      }
      case 'No.39': {
        // 配下の「ドール」1枚を捨て札にしても良い。捨て札にした場合、ターン終了時まで受けるダメージ-3
        const dolls = p.subordinates.filter(x => x.isDoll).map(x => x.cardId);
        if (dolls.length) requirePick(state, { forIdx: defenderIdx, sourcePlayer: defenderIdx, type: 'pick_subordinate', count: 1, cardId,
          prompt: '身代わりのトルマリン：棄置 1 個人偶配下，本回合受到傷害 -3（可不選）', action: 'tourmaline', options: dolls });
        else log(state, `（沒有人偶配下，無效果）`);
        break;
      }
      case 'No.57': {
        // その行動が、このターンに1度でも使用されたシンボルを持つ行動なら無効化。ターン終了時まで同シンボルの行動は全て無効化
        if (pend.symbolUsedBefore) { pend.invalidated = true; state.players[pend.attackerIdx].lockedSymbols.add(pend.kind); }
        else log(state, `本回合首次使用此符號，迷い道のトパーズ無效果`);
        break;
      }
      case 'No.58': {
        // ターン終了時まで、相手の配下の攻撃と効果を全て無効化し、あなたの配下は捨て札にならない
        state.players[pend.attackerIdx].subsNullEOT = true; p.subsSafeEOT = true;
        if (pend.fromSub) pend.invalidated = true;
        log(state, `🛐 聖域のフローライト：本回合對手配下的攻擊與效果全部無效，你的配下不會被棄置`);
        break;
      }
      case 'No.98': pend.invalidated = true; p.defBase = Math.max(0, p.defBase - 1); log(state, `障壁編みのスピネル：${p.name} 防禦力 -1`); break;
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
          attackerP.frozenLocked.add(aid);
          log(state, `❄ 束縛之榍石：對手「${(CARDS[aid]||{}).namecn||aid}」被凍結`);
        }
        break;
      }
      case 'No.59': pend.zeroIfLE = 3; break;   // 最初に受けるダメージが3以下なら0（第10步判定）
      case 'No.60': pend.setDmg = 1; break;
      case 'No.78': p.dmgReduceEOT += 2; break;
      case 'No.79': healPlayer(state, defenderIdx, 3); break;
      case 'No.97': pend.previewDamage = Math.max(0, pend.previewDamage - 1); if (!pend.fromSub) pend.discardAfter = true; break;
      case 'No.99': state.players[1 - defenderIdx].atkBuff -= 2; state.players[1 - defenderIdx].subAtkDebuff += 2; break;
      case 'No.100': p.dmgReduceEOT += 1; p.jade += 1; break;
    }
  }

  function passReaction(state, defenderIdx) {
    if (!state.pending) return;
    if (state.pending.defenderIdx !== defenderIdx) return;
    if (state.pending.stage || state.pendingChoice) return;
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
    if (state.pendingChoice) return err(state, '等待選擇中');
    const i = p.frozen.indexOf(cardId);
    if (i < 0) return err(state, '此卡不在凍結區');
    if (p.frozenLocked.has(cardId)) return err(state, '本回合才被凍結，下回合起才能啟動');
    p.frozen.splice(i, 1);
    const card = CARDS[cardId];
    log(state, `❄→ ${p.name} 啟動凍結中的「${card.namecn}」(免費)`);
    // Push to used so end-of-turn handling routes it correctly
    p.used.push(cardId);
    p.activatedFromFrozen.add(cardId);
    const h = CARD_HANDLERS[cardId];
    const run = () => {
      if (h && h.resolve) h.resolve(state, idx, { ...(choice||{}), _fromFrozen: true });   // bypass freezeFirst
      else applyCardEffect(state, idx, cardId, 0, choice || {});
    };
    if (isAidAction(cardId, choice)) openAidWindow(state, idx, cardId, run); else run();
    checkVictory(state);
  }

  return { createRoom, activateFrozen, respondChoice, addPlayer, submitDeck, playCard, reactStone, passReaction, endTurn, rematch, publicView, log };
})();
