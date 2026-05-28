// Card data extracted from https://sdrice.name/br.html
// 來源：旭翼文化 / Domina Game 《Blade Rondo 劍之輪舞曲》系列
// 此檔僅供學習與研究用途，所有素材版權歸原作者所有。
window.RAW_CARD_DATA = [
  {
    id: "common", name: "COMMON", list: [
      { id: "BC.1", user: "Swordia", namecn: "加熱法", types: ["breath"], cost: 1, restrict: "",  descsp: "", desc: "你的物理攻擊傷害+1。" },
      { id: "BC.2", user: "Swordia", namecn: "加護法", types: ["breath"], cost: 1, restrict: "",  descsp: "", desc: "本回合你的防禦力+X（X=花費）。" },
      { id: "BC.3", user: "Swordia", namecn: "鼓動法", types: ["breath"], cost: 0, restrict: "L", descsp: "", desc: "你獲得1點魔力。" }
    ]
  },
  {
    id: "br", name: "Blade Rondo", namecn: "劍之輪舞曲", list: [
      { id: "No.01", namecn: "斬擊劍", restrict: "",  cost: 1, types: ["attack"], user: "Cremier",     descsp: "物理攻擊",          desc: "" },
      { id: "No.02", namecn: "舞踏劍", restrict: "",  cost: 2, types: ["attack"], user: "Shannui",     descsp: "物理攻擊",          desc: "可支付1費用立刻再用一次。" },
      { id: "No.03", namecn: "暗黑劍", restrict: "",  cost: 2, types: ["attack"], user: "Umi",         descsp: "物理攻擊",          desc: "這次攻擊無法被反應。" },
      { id: "No.04", namecn: "憐憫之刃", restrict: "L", cost: 3, types: ["attack"], user: "Viera",     descsp: "物理攻擊",          desc: "追加：對手中毒，回合開始失1生命。" },
      { id: "No.05", namecn: "粉碎意志之鉈刀", restrict: "L", cost: 3, types: ["attack"], user: "Daisy Daisy", descsp: "物理攻擊", desc: "追加：對手隨機棄1張手牌。" },
      { id: "No.06", namecn: "絕對劍", restrict: "",  cost: 5, types: ["attack"], user: "Hideleine",   descsp: "物理攻擊",          desc: "這次攻擊無視防禦力。" },
      { id: "No.07", namecn: "星火之秋櫻", restrict: "",  cost: 1, types: ["magic"], user: "Meltia",   descsp: "魔法攻擊（1）",      desc: "" },
      { id: "No.08", namecn: "白蝶草之瘴氣", restrict: "", cost: 2, types: ["magic"], user: "Freesia", descsp: "魔法攻擊（3）",      desc: "代價：你受到3點傷害。" },
      { id: "No.09", namecn: "爆炎之木槿花", restrict: "", cost: 4, types: ["magic"], user: "Prodia",  descsp: "魔法攻擊（3）",      desc: "若你手牌為0則變為魔法攻擊（6）。" },
      { id: "No.10", namecn: "魔湧之魯冰花", restrict: "L", cost: 4, types: ["magic"], user: "Mizel",  descsp: "魔法攻擊（X）",      desc: "X = 對手當前生命的一半（向上取整）。" },
      { id: "No.11", namecn: "獻祭之百合花", restrict: "L", cost: 8, types: ["magic"], user: "Gerda",  descsp: "魔法攻擊（X）",      desc: "X = 對手當前生命。" },
      { id: "No.12", namecn: "燐火之練習曲", restrict: "L", cost: 1, types: ["aid"], user: "Follinte", descsp: "",                desc: "（簡化）下一次你受到的傷害-1。" },
      { id: "No.13", namecn: "憐愛之低語",   restrict: "L", cost: 2, types: ["aid"], user: "Lillanne", descsp: "",                desc: "你獲得4點生命。" },
      { id: "No.14", namecn: "引暉之康塔塔", restrict: "L", cost: 2, types: ["aid"], user: "Gaunilletica", descsp: "",            desc: "本回合你的攻擊力+2。" },
      { id: "No.15", namecn: "加速之輪舞曲", restrict: "L", cost: 3, types: ["aid"], user: "Starry",   descsp: "",                desc: "回合結束時你的魔力+1。" },
      { id: "No.16", namecn: "狂亂之華彩",   restrict: "L", cost: 6, types: ["aid"], user: "Rijeka&Fuscus", descsp: "召喚（牛人）", desc: "你的回合開始時：物理攻擊（10）。" },
      { id: "No.17", namecn: "拒卻死亡之鑽石", restrict: "L", cost: 1, types: ["stone"], user: "Veronica",   descsp: "反應", desc: "若這次攻擊將令你生命=0，則改以2生命復活。" },
      { id: "No.18", namecn: "皎潔月光之紅金石", restrict: "L", cost: 1, types: ["stone"], user: "Gaunieriee", descsp: "反應", desc: "本回合你的防禦力+3。" },
      { id: "No.19", namecn: "封印災厄之瑪瑙",   restrict: "L", cost: 1, types: ["stone"], user: "Dodona",   descsp: "反應", desc: "（簡化）使這次攻擊傷害-2。" },
      { id: "No.20", namecn: "編制迷霧之珍珠",   restrict: "L", cost: 1, types: ["stone"], user: "Yunilia",  descsp: "反應", desc: "對手可支付1COST，否則攻擊無效化。" }
    ]
  },
  {
    id: "nt", name: "Night Theater", namecn: "暗夜劇場", list: [
      { id: "No.21", namecn: "夜想劍", restrict: "",  cost: 2, types: ["attack"], user: "Cremier",    descsp: "物理攻擊", desc: "[月]時：傷害+2。" },
      { id: "No.22", namecn: "黑之劍", restrict: "",  cost: 2, types: ["attack"], user: "Umi",        descsp: "物理攻擊", desc: "可支付0COST立刻再用一次（每局限1次）。" },
      { id: "No.23", namecn: "直搗牙城之槍", restrict: "", cost: 3, types: ["attack"], user: "Hideleine", descsp: "物理攻擊", desc: "攻擊前使對手防禦力-1。" },
      { id: "No.24", namecn: "指揮劍", restrict: "L", cost: 4, types: ["attack"], user: "Lagrange",   descsp: "物理攻擊", desc: "追加：傷害+2。" },
      { id: "No.25", namecn: "逢魔時之大斧", restrict: "", cost: 5, types: ["attack"], user: "Chiffon", descsp: "物理攻擊", desc: "[日]：攻擊力視為2倍。" },
      { id: "No.26", namecn: "薔薇之魔彈", restrict: "L", cost: 3, types: ["magic"], user: "Norbis",  descsp: "魔法攻擊（3）", desc: "追加：對手【刻印】，無法回復生命。" },
      { id: "No.27", namecn: "淒冷之輪峰菊", restrict: "", cost: 4, types: ["magic"], user: "Brigitte", descsp: "魔法攻擊（4）", desc: "" },
      { id: "No.28", namecn: "鮮血之大麗菊", restrict: "L", cost: 5, types: ["magic"], user: "Mildred",  descsp: "[月]魔法攻擊（5）", desc: "你獲得X點生命（X=造成傷害）。" },
      { id: "No.29", namecn: "終曲之彩雀花", restrict: "", cost: 9, types: ["magic"], user: "Sheol",    descsp: "魔法攻擊（10）", desc: "" },
      { id: "No.30", namecn: "包裹之波萊羅", restrict: "", cost: 1, types: ["aid"], user: "Zetti Follinte", descsp: "[外套]", desc: "本回合防禦力+2。代價：本回合攻擊力變為0。" },
      { id: "No.31", namecn: "激昂之卡農", restrict: "", cost: 3, types: ["aid"], user: "Gainilletica", descsp: "", desc: "本回合攻擊力+1。代價：受2傷。" },
      { id: "No.32", namecn: "綻放之詼諧曲", restrict: "L", cost: 4, types: ["aid"], user: "Starry",    descsp: "", desc: "回合結束時魔力+1。" },
      { id: "No.33", namecn: "佇窗之音樂劇", restrict: "L", cost: 3, types: ["aid"], user: "Lalafina",  descsp: "召喚（人偶）", desc: "[日]防禦力+1；[月]攻擊力+1（本回合）。" },
      { id: "No.34", namecn: "凌遲之閒角", restrict: "L", cost: 2, types: ["aid"], user: "Pieta&Rosalia", descsp: "召喚", desc: "立即物理攻擊：[日]1[月]5。" },
      { id: "No.35", namecn: "飛奔之滑稽劇", restrict: "L", cost: 3, types: ["aid"], user: "Magrina",  descsp: "召喚", desc: "[日]獲1生命；[月]魔法攻擊（2）。" },
      { id: "No.36", namecn: "嘲諷之無賴傳", restrict: "L", cost: 3, types: ["aid"], user: "Lesette",  descsp: "召喚", desc: "立即物理攻擊（[日]2[月]5）。" },
      { id: "No.37", namecn: "閃爍之紫翠玉", restrict: "L", cost: 1, types: ["stone"], user: "Rulia", descsp: "反應", desc: "切換日夜。你獲得2點生命。" },
      { id: "No.38", namecn: "洞悉萬物之紫水晶", restrict: "L", cost: 1, types: ["stone"], user: "Bellefeuille", descsp: "反應", desc: "使這次攻擊對你的傷害變為0。" },
      { id: "No.39", namecn: "替身之碧璽", restrict: "L", cost: 1, types: ["stone"], user: "Carlotte", descsp: "反應", desc: "本回合你受到的傷害-3。" },
      { id: "No.40", namecn: "靜寂之水晶", restrict: "L", cost: 1, types: ["stone"], user: "Selene", descsp: "反應", desc: "對手可支付1COST，否則行動無效化。" }
    ]
  },
  {
    id: "gg", name: "Grim Garden", namecn: "恐怖花園", list: [
      { id: "No.41", namecn: "徵稅劍", restrict: "L", cost: 1, types: ["attack"], user: "Mevy-Eliara", descsp: "物理攻擊", desc: "（簡化）傷害+1。" },
      { id: "No.42", namecn: "絢爛劍", restrict: "",  cost: 2, types: ["attack"], user: "Shannul",    descsp: "物理攻擊", desc: "可支付0COST立即再用（每局1次）。" },
      { id: "No.43", namecn: "紋章劍", restrict: "",  cost: 2, types: ["attack"], user: "Felsea",     descsp: "物理攻擊", desc: "追加：本回合所有反應卡cost-1。" },
      { id: "No.44", namecn: "魔導劍", restrict: "",  cost: 3, types: ["attack"], user: "Kanalis",    descsp: "物理攻擊", desc: "追加：立即魔法攻擊（3）。" },
      { id: "No.45", namecn: "響骨之鉈刀", restrict: "", cost: 3, types: ["attack"], user: "Daisy Daisy", descsp: "物理攻擊", desc: "追加：對手隨機棄1張手牌。" },
      { id: "No.46", namecn: "重擊劍", restrict: "", cost: 6, types: ["attack"], user: "Brioche", descsp: "物理攻擊", desc: "攻擊力視為2倍。" },
      { id: "No.47", namecn: "輝光之花束", restrict: "",  cost: 1, types: ["magic"], user: "Meltia",  descsp: "魔法攻擊（1）", desc: "" },
      { id: "No.48", namecn: "暗鴉之白芨", restrict: "",  cost: 2, types: ["magic"], user: "Noire",   descsp: "魔法攻擊（1）", desc: "追加：你下一張物理攻擊傷害+1。" },
      { id: "No.49", namecn: "消散之雪絨花", restrict: "L", cost: 4, types: ["magic"], user: "Sylveinne", descsp: "魔法攻擊（4）", desc: "" },
      { id: "No.50", namecn: "烈焰之花冠", restrict: "", cost: 6, types: ["magic"], user: "Prodia", descsp: "魔法攻擊（X）", desc: "X = 你已棄置牌數的2倍。" },
      { id: "No.51", namecn: "滿溢之聖誕頌歌", restrict: "L", cost: 4, types: ["special"], user: "Syphelvati", descsp: "", desc: "選1：獲5生命/本回合攻+1/本回合防+1/回合末魔力+1。" },
      { id: "No.52", namecn: "驅散之進行曲", restrict: "L", cost: 2, types: ["aid"], user: "Nadie",  descsp: "召喚", desc: "本回合你的物理攻擊+1。" },
      { id: "No.53", namecn: "喧嚷之假音", restrict: "L", cost: 2, types: ["aid"], user: "Lunya",   descsp: "召喚", desc: "立即魔法攻擊（1）。代價：受1傷。" },
      { id: "No.54", namecn: "殘響之夜曲", restrict: "L", cost: 3, types: ["aid"], user: "Chiffon&Shade", descsp: "召喚", desc: "立即物理攻擊（依當前攻擊力）。" },
      { id: "No.55", namecn: "散布之狂想曲", restrict: "L", cost: 4, types: ["aid"], user: "Feuille", descsp: "召喚", desc: "本回合你的魔法傷害+1。" },
      { id: "No.56", namecn: "穿透存在之悲鳴", restrict: "L", cost: 7, types: ["aid"], user: "Gopha", descsp: "召喚", desc: "立即魔法攻擊（4），且本回合攻+2。" },
      { id: "No.57", namecn: "迷途之黃玉", restrict: "L", cost: 1, types: ["stone"], user: "Annette",  descsp: "反應", desc: "使這次攻擊無效化。" },
      { id: "No.58", namecn: "聖域之螢石", restrict: "L", cost: 1, types: ["stone"], user: "Selene",   descsp: "反應", desc: "（簡化）本回合你受到的傷害-2。" },
      { id: "No.59", namecn: "斷絕之青金石", restrict: "L", cost: 1, types: ["stone"], user: "Pieta&Rosalia", descsp: "反應", desc: "若這次傷害≤3，變為0。" },
      { id: "No.60", namecn: "觀測因果之藍寶石", restrict: "L", cost: 1, types: ["stone"], user: "Ethica", descsp: "反應", desc: "使這次攻擊對你的傷害變為1。" }
    ]
  },
  {
    id: "fv", name: "Frost Veil", namecn: "寒霜面紗", list: [
      { id: "No.61", namecn: "凍刃劍", restrict: "", cost: 1, types: ["attack"], user: "Cynthia", descsp: "物理攻擊", desc: "" },
      { id: "No.62", namecn: "灰之劍", restrict: "", cost: 2, types: ["attack"], user: "Zephel", descsp: "物理攻擊", desc: "傷害+2。" },
      { id: "No.63", namecn: "銀嶺槍", restrict: "", cost: 3, types: ["attack"], user: "Nadia", descsp: "物理攻擊", desc: "" },
      { id: "No.64", namecn: "先導之白刃", restrict: "L", cost: 4, types: ["attack"], user: "Sylveinne", descsp: "物理攻擊", desc: "傷害+1。" },
      { id: "No.65", namecn: "壓壞劍", restrict: "L", cost: 5, types: ["attack"], user: "Brioche", descsp: "物理攻擊", desc: "傷害x2。" },
      { id: "No.66", namecn: "冰錐之雪鈴花", restrict: "", cost: 1, types: ["magic"], user: "Cozette", descsp: "魔法攻擊（1）", desc: "" },
      { id: "No.67", namecn: "漩渦之蝴蝶花", restrict: "", cost: 3, types: ["magic"], user: "Gerda", descsp: "魔法攻擊（2）", desc: "本回合魔法傷害+1。" },
      { id: "No.68", namecn: "螺旋之洋蘇草", restrict: "L", cost: 3, types: ["magic"], user: "Mizel", descsp: "魔法攻擊（3）", desc: "" },
      { id: "No.69", namecn: "風暴之菖蒲", restrict: "L", cost: 7, types: ["magic"], user: "The Tempest", descsp: "魔法攻擊（8）", desc: "若本回合已魔法攻擊，無法被反應。" },
      { id: "No.70", namecn: "紫陽花之魔劍", restrict: "", cost: 2, types: ["special"], user: "Folin", descsp: "", desc: "選1：物理攻擊或魔法攻擊（1）。" },
      { id: "No.71", namecn: "結果之柔和音", restrict: "L", cost: 2, types: ["special"], user: "Viera", descsp: "", desc: "選1：本回合攻+1或魔力+1。" },
      { id: "No.72", namecn: "凍結之嘯鳴", restrict: "L", cost: 0, types: ["aid"], user: "Solfried", descsp: "", desc: "你獲得2點生命。" },
      { id: "No.73", namecn: "調停之《鐘》", restrict: "L", cost: 4, types: ["aid"], user: "Mevy", descsp: "", desc: "使你或對手的生命變為8（取對自己有利者）。" },
      { id: "No.74", namecn: "遠吠之漸強音", restrict: "L", cost: 2, types: ["aid"], user: "Erin&Roddy", descsp: "召喚", desc: "立即物理攻擊。" },
      { id: "No.75", namecn: "循環之副歌", restrict: "L", cost: 3, types: ["aid"], user: "Seine", descsp: "召喚", desc: "立即魔法攻擊（1）。" },
      { id: "No.76", namecn: "刻印之輓歌", restrict: "L", cost: 6, types: ["aid"], user: "Doriana", descsp: "召喚", desc: "若你生命比對手多，立即獲得勝利。" },
      { id: "No.77", namecn: "束縛之榍石", restrict: "L", cost: 1, types: ["stone"], user: "Dodona", descsp: "反應", desc: "使這次攻擊無效化。" },
      { id: "No.78", namecn: "清冽之月光石", restrict: "L", cost: 1, types: ["stone"], user: "Gaunieriee", descsp: "反應", desc: "本回合你受到的傷害-2。" },
      { id: "No.79", namecn: "溫暖之琥珀", restrict: "L", cost: 1, types: ["stone"], user: "Lillianne", descsp: "反應", desc: "你獲得3點生命。" },
      { id: "No.80", namecn: "極光天空之歐泊", restrict: "L", cost: 1, types: ["stone"], user: "Aurora", descsp: "反應", desc: "若行動原COST≥3，使其無效化。" }
    ]
  },
  {
    id: "ld", name: "Lost Dream", namecn: "失落夢境", list: [
      { id: "No.81", namecn: "偽典斬擊劍", restrict: "", cost: 1, types: ["attack"], user: "Diva", descsp: "物理攻擊", desc: "ATK≥7：傷害+1。" },
      { id: "No.82", namecn: "碧光劍", restrict: "", cost: 2, types: ["attack"], user: "Lislina", descsp: "物理攻擊", desc: "" },
      { id: "No.83", namecn: "正中側腹之椿", restrict: "", cost: 2, types: ["attack"], user: "Erin&Roddy", descsp: "物理攻擊", desc: "追加：對手隨機棄1張手牌。" },
      { id: "No.84", namecn: "天翔之刃", restrict: "", cost: 2, types: ["attack"], user: "Freesia", descsp: "物理攻擊", desc: "" },
      { id: "No.85", namecn: "金剛劍", restrict: "L", cost: 2, types: ["attack"], user: "Veronica", descsp: "物理攻擊", desc: "無視防禦。" },
      { id: "No.86", namecn: "怒濤槍", restrict: "", cost: 3, types: ["attack"], user: "Remonica", descsp: "物理攻擊", desc: "追加：給予對手2點傷害。" },
      { id: "No.87", namecn: "聖禮劍", restrict: "L", cost: 3, types: ["attack"], user: "Mildred", descsp: "物理攻擊", desc: "追加：你獲得X生命（X=這次傷害）。" },
      { id: "No.88", namecn: "突襲之鉈刀", restrict: "L", cost: 3, types: ["attack"], user: "Casmia", descsp: "物理攻擊", desc: "追加：對手下回合開始失1COST。" },
      { id: "No.89", namecn: "赤熱劍", restrict: "L", cost: 4, types: ["attack"], user: "Scarlet", descsp: "物理攻擊", desc: "攻擊前你的攻擊力+1。" },
      { id: "No.90", namecn: "縛鎖豪腕", restrict: "", cost: 5, types: ["attack"], user: "Fuscus", descsp: "物理攻擊", desc: "傷害+3，手牌為0則再+3。" },
      { id: "No.91", namecn: "通往彩虹之彼端", restrict: "L", cost: 1, types: ["special"], user: "Natalie", descsp: "", desc: "選1：物理攻擊／魔法攻擊（2）／獲2生命。" },
      { id: "No.92", namecn: "背叛天聖之人皆無", restrict: "", cost: 9, types: ["special"], user: "Sylphy", descsp: "", desc: "選1：物理（攻擊力x3）或魔法攻擊（9）。無法被反應。" },
      { id: "No.93", namecn: "湧現之賦格曲", restrict: "L", cost: 2, types: ["aid"], user: "Syphelvati", descsp: "", desc: "你獲得2生命。" },
      { id: "No.94", namecn: "迸發之新年音樂會", restrict: "L", cost: 3, types: ["aid"], user: "Virginie", descsp: "", desc: "你的攻擊力變為當前魔力值。" },
      { id: "No.95", namecn: "夢見之唱名", restrict: "L", cost: 3, types: ["aid"], user: "Nesticore", descsp: "召喚", desc: "立即魔法攻擊（2）。" },
      { id: "No.96", namecn: "號令之詠嘆調", restrict: "L", cost: 5, types: ["aid"], user: "Rijeka", descsp: "召喚", desc: "立即魔法攻擊（2），本回合魔法傷害+1。" },
      { id: "No.97", namecn: "泥濘之金綠柱石", restrict: "L", cost: 1, types: ["stone"], user: "Lalafina", descsp: "反應", desc: "使這次傷害-1。" },
      { id: "No.98", namecn: "編織屏障之尖晶石", restrict: "L", cost: 1, types: ["stone"], user: "Noire", descsp: "反應", desc: "使這次攻擊無效化。之後你防禦力-1。" },
      { id: "No.99", namecn: "鏽蝕之摩根石", restrict: "L", cost: 1, types: ["stone"], user: "Agatha", descsp: "反應", desc: "本回合對手攻擊力-2。" },
      { id: "No.100", namecn: "拒絕干涉之翡翠", restrict: "L", cost: 1, types: ["stone"], user: "Daphne", descsp: "反應", desc: "本回合你受到的傷害-1。" }
    ]
  }
];

window.ALL_CARDS = (() => {
  const arr = [];
  for (const pack of window.RAW_CARD_DATA) {
    if (pack.id === "common") continue;
    for (const c of pack.list) arr.push({ ...c, pack: pack.id, packName: pack.namecn || pack.name });
  }
  return arr;
})();

window.CARD_BY_ID = (() => {
  const m = {};
  for (const pack of window.RAW_CARD_DATA) for (const c of pack.list) m[c.id] = { ...c, pack: pack.id, packName: pack.namecn || pack.name };
  return m;
})();

window.COMMON_CARDS = window.RAW_CARD_DATA[0].list.map(c => ({ ...c, pack: "common", packName: "COMMON" }));
