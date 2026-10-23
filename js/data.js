/* data.js — 棋子即人物：血量/攻击/法术/治疗，六边形布阵自走棋 */
(function (root) {
  'use strict';
  var GB = root.GB = root.GB || {};

  var CFG = {
    prestigeMax: 20,
    winsToFinish: 6,
    maxDays: 10,
    startGold: 15,          // 对齐大巴扎：15 金开局、7 收入/天
    benchBase: 4,          // 备战席（开局只有 4 格，藏兵 +2）
    // 兵书＝遗物：槽位少、稀有度高、靠里程碑三选一（见 ITERATION.md 计划 v2）
    skillSlots: [2, 4, 6],      // 第 2 / 4 / 6 天各开一个构筑位
    skillPrice: [12, 20, 32],   // 铜 / 银 / 金 的商店价（贵过任何同格数棋子）
    skillTierDay: [1, 3, 6],    // 铜随时 / 银第 3 天 / 金第 6 天
    enchMax: 3,                 // 一局最多附魔 3 次（大巴扎里附魔是事件给的，不是货架商品）
    maxLevel: 5,
    rerollCost: 2,
    offersBase: 4,
    incomeBase: 7,
    battleTime: 45,           // 大件血池更厚，缩短上限避免「拖到超时比血」
    hpScale: 1.6,           // 血条基准：3.0 太肉（16 下才死人），1.0 又太快，取中间
    ultCharge: 14,
    lastStandAt: 0.30,
    lastStandBonus: 0.35,
    splashMul: [1, 0.5, 0.28],   // 溅射衰减：中心 → 邻格 → 再外一圈
    pierceMul: [1, 0.6, 0.38],   // 穿透衰减：本排 → 后一排 → 后两排
    splashCap: 3,               // 一次最多命中 3 格
    cellsStart: 12,             // 开局背包格（前排中央 4×3 方块）
    cellsMax: 22,               // 最多 22 格（半场物理上有 32 格，最外圈永远锁着）
    // 解锁第 n 格的价格。曲线参考 TFT 升级 XP（6/10/20/36/48/76，约每级 ×1.6~1.8），
    // 按一局买 5 次的体量缩放：4 / 7 / 12 / 20 / 32
    expandPrices: [6, 9, 13, 18, 24],   // 5 次扩建 ×2 格，合计 70 金
    // 事件总线（见 ITERATION.md）：防无限循环
    events: {
      maxDepth: 3,        // 连锁深度上限
      queueMax: 240,      // 单帧最多处理多少条事件
      traceMax: 24,       // 战斗面板显示的触发链长度
      rateWindow: 1.0     // 限频窗口（秒）
    },
  };

  // 升级只给小幅属性（ITERATION.md §6）：每级 ×1.35，规则变化交给「进化」而不是数值
  var LVL = [0, 1, 1.35, 1.82, 2.46, 3.32];

  // kind = unit / trigger / convert / engine（见 ITERATION.md）
  //   unit    战斗单位：有血、会打、会被消灭
  //   trigger 触发器：出手时制造事件（命中/治疗）
  //   convert 转换器：把命中换成燃烧、减速等
  //   engine  引擎：累积事件、改冷却、复制触发（多为无血挂件）
  // on = 事件钩子 { 事件类型: { scope: self|adjacent|team, do, v, dur, need } }
  // limits.rate = 每秒最多触发几次
  // legacy = 暂时退出商店（保留数值，验证完再决定去留）
  //
  // 一个棋子就是一个人物。
  // role: tank / melee / mid / ranged / arc / heal / support / spell / gold / flag
  // atk   = 出手间隔（秒）
  // range = 能打到「最前排之后」几排；1 = 只够得着最前排（近战），2 = 还能戳到第二排
  //         近战不受距离限制：敌人再远，只要是最前排就打得到
  // arc   = 抛射：越过前排直接打最后排，不限距离
  // pierce= 穿透：命中最前排后，同列再往后排 1~2 格（有衰减）
  // splash= 溅射：命中后向周围扩散，最多 3 格，按距离衰减
  var PIECES = {
    dao: {
      id: 'dao', ch: '刀', name: '刀客', size: 4, tier: 1, price: 10, role: 'melee',
      kind: 'unit',
      hp: 3600, dmg: 680, atk: 4.0, range: 1,
      desc: '2×2 近战。'
    },
    qiang: {
      id: 'qiang', legacy: true, ch: '枪', name: '枪手', size: 2, tier: 1, price: 5, role: 'melee',
      hp: 1000, dmg: 230, atk: 5.0, range: 2, pierce: 1,
      desc: '1×2 长兵。同列可捅穿到后一排。'
    },
    gong: {
      id: 'gong', ch: '弓', name: '弓手', size: 4, tier: 1, price: 10, role: 'arc',
      kind: 'unit',
      hp: 2080, dmg: 600, atk: 4.5, range: 4, arc: true,
      desc: '2×2 抛射。越过前排打最后排。'
    },
    qi: {
      id: 'qi', ch: '骑', name: '骑将', size: 6, tier: 2, price: 15, role: 'tank', kind: 'unit',
      hp: 5400, dmg: 1240, atk: 5.5, range: 1, splash: 1,
      desc: '2×3 近战·横扫。'
    },
    jiang: {
      id: 'jiang', ch: '将', name: '将台', size: 9, tier: 3, price: 22, role: 'arc', kind: 'unit',
      hp: 8100, dmg: 1860, atk: 4.0, range: 3, arc: true, splash: 1,
      desc: '3×3 抛射·溅射。'
    },
    yi: {
      id: 'yi', ch: '医', name: '医者', size: 1, tier: 1, price: 4, role: 'heal',
      kind: 'trigger',
      hp: 600, heal: 260, atk: 5.0, range: 3,
      // 每次治疗都算一次「触发」——风助靠它转起来
      emits: 'trigger',
      desc: '1×1。每 5 秒治疗射程内血最少的友军。'
    },
    dun: {
      id: 'dun', ch: '盾', name: '盾卫', size: 2, tier: 1, price: 7, role: 'support',
      kind: 'unit',
      hp: 2300, shield: 760, atk: 6.0, range: 2,
      desc: '1×2。每 6 秒给射程内友军套 760 护盾。'
    },
    gu: {
      id: 'gu', legacy: true, ch: '鼓', name: '鼓手', size: 1, tier: 1, price: 4, role: 'support',
      hp: 640, haste: 0.35, atk: 6.0, range: 2,
      desc: '1×1。每 6 秒给射程内友军 +35% 攻速。'
    },
    shuang: {
      id: 'shuang', ch: '霜', name: '霜术师', size: 1, tier: 1, price: 5, role: 'mid',
      kind: 'convert',
      hp: 550, dmg: 150, atk: 5.0, range: 3,
      on: { hit: { scope: 'self', do: 'slow', v: 0.35, dur: 2.5 } },
      limits: { rate: 3 },
      desc: '1×1。命中减速 35%。'
    },
    lei: {
      id: 'lei', ch: '雷', name: '雷术师', size: 2, tier: 2, price: 7, role: 'mid',
      kind: 'trigger',
      hp: 1160, dmg: 400, atk: 5.0, range: 4,
      on: { hit: { scope: 'self', do: 'chain', v: 0.5, n: 2 } },
      limits: { rate: 3 },
      desc: '1×2。命中时连锁旁边两人。'
    },

    /* ---- 门派专属 ---- */
    huo: {
      id: 'huo', ch: '火', name: '火术师', size: 2, tier: 2, price: 7, role: 'arc', faction: 'dongwu',
      kind: 'convert',
      hp: 1160, dmg: 400, atk: 6.0, range: 4, arc: true, splash: 1,
      // 相邻友军命中 → 给目标挂燃烧（燃烧循环的入口）
      on: { hit: { scope: 'adjacent', do: 'burn', v: 0.55, dur: 3.5 } },
      limits: { rate: 4 },
      desc: '1×2 抛射·溅射。相邻友军命中时附加燃烧。'
    },
    feng: {
      id: 'feng', ch: '风', name: '风助', size: 1, tier: 1, price: 5, role: 'flag', faction: 'dongwu',
      kind: 'engine',
      on: { trigger: { scope: 'team', do: 'haste', v: 0.5, dur: 2.5 } },
      limits: { rate: 3 },
      desc: '1×1。触发发生时，全队加速。'
    },
    jin: {
      id: 'jin', legacy: true, ch: '金', name: '金库', size: 1, tier: 1, price: 4, role: 'gold', faction: 'taozhu',
      hp: 450, gold: 2, atk: 8.0,
      desc: '1×1。每 8 秒产 2 金。'
    },
    piao: {
      id: 'piao', legacy: true, ch: '票', name: '票号', size: 2, tier: 2, price: 6, role: 'gold', faction: 'taozhu',
      hp: 640, gold: 5, atk: 10.0,
      desc: '1×2。每 10 秒产 5 金。'
    },
    ji: {
      id: 'ji', ch: '机', name: '机关人', size: 1, tier: 1, price: 5, role: 'flag', faction: 'mojia',
      kind: 'engine',
      // 燃烧跳伤 → 给相邻战斗单位减冷却（燃烧循环的回环）
      on: { burn_tick: { scope: 'team', do: 'charge', v: 1.5 } },
      limits: { rate: 3 },
      desc: '1×1。敌人被燃烧灼伤时，相邻单位冷却 −1.5 秒。'
    },
    nu: {
      id: 'nu', ch: '弩', name: '连弩车', size: 1, tier: 2, price: 6, role: 'arc', faction: 'mojia',
      kind: 'trigger',
      hp: 720, dmg: 110, atk: 2.8, range: 3, arc: true,
      desc: '1×1 抛射。攻速极快。'
    },
    du: {
      id: 'du', legacy: true, ch: '毒', name: '毒师', size: 1, tier: 1, price: 5, role: 'flag', faction: 'miaoyu',
      aura: 'poison', value: 0.25,
      desc: '1×1。相邻友军攻击附带中毒。'
    },
    lu: {
      id: 'lu', legacy: true, ch: '庐', name: '药庐', size: 2, tier: 2, price: 6, role: 'heal', faction: 'miaoyu',
      hp: 720, heal: 170, atk: 4.0, range: 3,
      desc: '1×2。每 4 秒治疗一次。'
    },
    lou: {
      id: 'lou', legacy: true, ch: '楼', name: '望楼', size: 2, tier: 1, price: 6, role: 'flag', faction: 'wolong',
      aura: 'range', value: 1,
      desc: '1×2。相邻友军射程 +1。'
    },
    liuma: {
      id: 'liuma', legacy: true, ch: '马', name: '流马', size: 4, tier: 2, price: 11, role: 'tank', faction: 'wolong',
      hp: 2600, dmg: 460, atk: 4.0, range: 3,
      desc: '2×2。射程 3。'
    }
  };


  /* ---------------- 大招（每个棋子一个，自动释放） ---------------- */
  var ULTS = {
    dao: { name: '破军', kind: 'nuke', v: 2.6, n: 3, cd: 11 },
    qiang: { name: '贯日', kind: 'nuke', v: 3.2, n: 2, cd: 12 },
    gong: { name: '落星', kind: 'rear', v: 2.2, cd: 12 },
    qi: { name: '冲阵', kind: 'nuke', v: 3.0, n: 3, stun: 1.2, cd: 14 },
    jiang: { name: '龙胆', kind: 'rear', v: 2.6, cd: 13 },
    yi: { name: '回春', kind: 'heal', v: 0.45, cd: 14 },
    dun: { name: '铁壁', kind: 'shield', v: 0.50, cd: 15 },
    gu: { name: '战意', kind: 'haste', v: 0.80, dur: 5, cd: 15 },
    shuang: { name: '冰封', kind: 'slow', v: 0.60, dur: 2.6, cd: 13 },
    lei: { name: '天罚', kind: 'nuke', v: 3.2, n: 4, cd: 14 },
    huo: { name: '燎原', kind: 'rear', v: 2.0, burn: true, cd: 15 },
    jin: { name: '开市', kind: 'gold', v: 12, cd: 12 },
    piao: { name: '银号', kind: 'gold', v: 20, cd: 14 },
    feng: { name: '风起', kind: 'haste', v: 0.40, dur: 4, cd: 13 },
    ji: { name: '机巧', kind: 'shield', v: 0.30, cd: 15 },
    nu: { name: '箭雨', kind: 'rear', v: 1.6, cd: 12 },
    du: { name: '蛊毒', kind: 'slow', v: 0.30, dur: 4, cd: 13 },
    lu: { name: '药王', kind: 'heal', v: 0.35, cd: 12 },
    lou: { name: '瞭望', kind: 'haste', v: 0.35, dur: 6, cd: 14 },
    liuma: { name: '疾驰', kind: 'haste', v: 0.45, dur: 5, cd: 13 }
  };

  /* ---------------- 大招（仅 3 级及以上，可按类型） ---------------- */
  var ROLE_ULT = {
    melee: { name: '破阵', kind: 'nuke', v: 3.5, n: 3, cd: 13 },
    tank: { name: '不动如山', kind: 'shield', v: 0.60, cd: 14 },
    mid: { name: '天火', kind: 'rear', v: 3.0, cd: 13 },
    arc: { name: '星陨', kind: 'rear', v: 2.8, cd: 13 },
    heal: { name: '起死回生', kind: 'heal', v: 0.60, cd: 15 },
    support: { name: '军令如山', kind: 'haste', v: 1.0, dur: 6, cd: 15 },
    gold: { name: '点石成金', kind: 'gold', v: 25, cd: 12 }
  };

  /* ---------------- 共享阵旗 ---------------- */
  var FLAGS = {
    flag_dmg: {
      id: 'flag_dmg', ch: '麾', name: '战鼓旗', size: 1, tier: 1, price: 5, role: 'flag',
      kind: 'engine',
      // 累计命中 → 每 3 次给出手者一次额外攻击（连击循环）
      on: { hit: { scope: 'team', do: 'combo', need: 2 } },
      limits: { rate: 3 },
      desc: '1×1。全队每 2 次命中，出手者补一刀。'
    },
    flag_spd: { id: 'flag_spd', legacy: true, ch: '令', name: '令疾旗', size: 1, tier: 1, price: 5, role: 'flag', aura: 'spd', value: 0.15, desc: '1×1。相邻友军攻速 +15%。' },
    flag_hp: { id: 'flag_hp', legacy: true, ch: '壁', name: '铁壁旗', size: 1, tier: 1, price: 5, role: 'flag', aura: 'hp', value: 0.20, desc: '1×1。相邻友军血量 +20%。' },
    flag_burn: {
      id: 'flag_burn', ch: '烽', name: '火盆旗', size: 1, tier: 2, price: 5, role: 'flag',
      kind: 'engine',
      // 燃烧跳伤 → 把燃烧扩散给旁边的敌人
      on: { burn_tick: { scope: 'team', do: 'spread', v: 0.7 } },
      limits: { rate: 1 },
      desc: '1×1。敌人被灼伤时，把燃烧扩散给旁边。'
    },
    flag_slow: { id: 'flag_slow', legacy: true, ch: '冰', name: '冰鉴旗', size: 1, tier: 2, price: 5, role: 'flag', aura: 'slow', value: 0.30, desc: '1×1。相邻友军攻击附带减速。' },
    flag_gold: { id: 'flag_gold', legacy: true, ch: '鳞', name: '金鳞旗', size: 1, tier: 2, price: 5, role: 'flag', aura: 'gold', value: 1, desc: '1×1。相邻友军击杀 +1 金。' }
  };

  /* ---------------- 规则进化（2 级二选一，见 ITERATION.md §6） ----------------
     每项可以带：stats（atkMul/hpMul/dmgMul/rangeAdd）、on（覆盖或新增事件钩子）、limits（限频加减） */
  var EVOLVE = {
    /* 战斗单位 */
    dao: [
      { id: 'fast', name: '快刀', desc: '攻击间隔 −25%，出手更密', stats: { atkMul: 0.75 } },
      { id: 'heavy', name: '重刀', desc: '攻击间隔 +30%，命中附带 25% 燃烧', stats: { atkMul: 1.3 },
        on: { hit: { scope: 'self', do: 'burn', v: 0.25, dur: 3 } } }
    ],
    dun: [
      { id: 'wall', name: '厚壁', desc: '血量上限 +30%', stats: { hpMul: 1.3 } },
      { id: 'swift', name: '疾盾', desc: '出手间隔 −25%，护盾更勤', stats: { atkMul: 0.75 } }
    ],
    gong: [
      { id: 'rapid', name: '连射', desc: '攻击间隔 −20%', stats: { atkMul: 0.8 } },
      { id: 'pierce', name: '穿云', desc: '伤害 +35%，射程 +1', stats: { dmgMul: 1.35, rangeAdd: 1 } }
    ],
    /* 触发器 / 转换器 */
    huo: [
      { id: 'blaze', name: '烈焰', desc: '燃烧强度 45% → 65%', on: { hit: { v: 0.65 } } },
      { id: 'rain', name: '火雨', desc: '溅射范围 +1，但伤害 −15%', stats: { dmgMul: 0.85, splashAdd: 1 } }
    ],
    shuang: [
      { id: 'deep', name: '深寒', desc: '减速 35% → 55%', on: { hit: { v: 0.55 } } },
      { id: 'armor', name: '霜甲', desc: '血量上限 +30%', stats: { hpMul: 1.3 } }
    ],
    lei: [
      { id: 'fork', name: '分叉', desc: '连锁目标 +1', on: { hit: { n: 3 } } },
      { id: 'storm', name: '雷暴', desc: '伤害 +30%', stats: { dmgMul: 1.3 } }
    ],
    nu: [
      { id: 'rapid', name: '速射', desc: '攻击间隔 −30%', stats: { atkMul: 0.7 } },
      { id: 'sunder', name: '破甲', desc: '伤害 +40%', stats: { dmgMul: 1.4 } }
    ],
    yi: [
      { id: 'firstaid', name: '急救', desc: '治疗量 +40%', stats: { healMul: 1.4 } },
      { id: 'wide', name: '广域', desc: '射程 +1，出手 −15%', stats: { rangeAdd: 1, atkMul: 0.85 } }
    ],
    /* 引擎 */
    flag_dmg: [
      { id: 'urgent', name: '急鼓', desc: '每 1 次命中就触发（每秒上限不变）', on: { hit: { need: 1 } }, limits: { rate: -1 } },
      { id: 'loud', name: '战鼓', desc: '连击补刀伤害 1.3 → 1.8 倍', on: { hit: { mul: 1.8 } } }
    ],
    flag_burn: [
      { id: 'wildfire', name: '燎原', desc: '扩散强度 50% → 85%', on: { burn_tick: { v: 0.85 } } },
      { id: 'control', name: '控火', desc: '每秒可扩散 1 → 2 次', limits: { rate: 1 } }
    ],
    feng: [
      { id: 'long', name: '长风', desc: '加速 50% → 75%', on: { trigger: { v: 0.75 } } },
      { id: 'gale', name: '疾风', desc: '每秒可触发 3 → 5 次', limits: { rate: 2 } }
    ],
    ji: [
      { id: 'precise', name: '精密', desc: '每次减冷却 1.5 → 2.5 秒', on: { burn_tick: { v: 2.5 } } },
      { id: 'link', name: '连动', desc: '每秒可充能 3 → 5 次', limits: { rate: 2 } }
    ]
  };

  /* ---------------- 门派 ---------------- */
  var FACTIONS = {
    dongwu: {
      id: 'dongwu', name: '江东火', hero: '周瑜', promise: '一把火，烧穿整条战线',
      desc: '灼烧伤害 +40%。', passive: 'burn', color: '#b03a2e',
      pieces: ['huo', 'feng'], start: ['dao']
    },
    taozhu: {
      id: 'taozhu', name: '陶朱商', hero: '范蠡', promise: '前三日最弱，后七日用钱买出一面阵',
      desc: '每场 +3 金，利息上限翻倍。', passive: 'gold', color: '#a9812f',
      pieces: ['jin', 'piao'], start: ['dao']
    },
    mojia: {
      id: 'mojia', name: '墨家机', hero: '墨子', promise: '机器互相喂养，越摆越强',
      desc: '所有光环效果 +25%。', passive: 'aura', color: '#3f6b57',
      pieces: ['ji', 'nu'], start: ['dao']
    },
    miaoyu: {
      id: 'miaoyu', name: '苗疆蛊', hero: '蛊师', promise: '先挨打，再让你慢慢烂掉',
      desc: '中毒可叠 3 层。', passive: 'poison', color: '#5d7a3a',
      pieces: ['du', 'lu'], start: ['dao']
    },
    wolong: {
      id: 'wolong', name: '卧龙阵', hero: '诸葛亮', promise: '你够不着我，我却够得着你',
      desc: '所有抛物线棋子射程 +1。', passive: 'range', color: '#40546e',
      pieces: ['lou', 'liuma'], start: ['dao']
    }
  };

  /* ---------------- 名将 ---------------- */
  var HEROES = {
    zhaoyun: { id: 'zhaoyun', chars: ['赵', '云'], name: '赵云', sub: '龙胆', desc: '贯穿：一次打 3 人' },
    guanyu: { id: 'guanyu', chars: ['关', '羽'], name: '关羽', sub: '武圣', desc: '斩将：每 6 秒 5 倍重击' },
    zhangfei: { id: 'zhangfei', chars: ['张', '飞'], name: '张飞', sub: '燕人', desc: '怒吼：眩晕周围' },
    huangzhong: { id: 'huangzhong', chars: ['黄', '忠'], name: '黄忠', sub: '神射', desc: '神射：全场最远' },
    machao: { id: 'machao', chars: ['马', '超'], name: '马超', sub: '铁骑', desc: '突击：巨幅溅射' }
  };

  (function () {
    for (var hid in HEROES) {
      if (!HEROES.hasOwnProperty(hid)) continue;
      var h = HEROES[hid];
      for (var i = 0; i < 2; i++) {
        var ch = h.chars[i];
        PIECES['shard_' + ch] = {
          id: 'shard_' + ch, ch: ch, name: '碎片·' + ch, size: 1, tier: 3, price: 4,
          role: 'shard', hp: 120, dmg: 10, atk: 1.6, range: 2, heroId: hid,
          desc: '拼齐「' + h.chars.join('') + '」即觉醒' + h.name + '。'
        };
      }
    }
  }());

  /* ---------------- 兵书 ---------------- */
  // 兵书 = 遗物：一条效果改变一条规则，value 按 [铜, 银, 金] 三档缩放
  //   when  = 触发条件（battle 里判定）
  //   give  = 效果（数组 = 按档位取值）
  //   on    = 事件钩子（走事件总线）
  var SKILLS = {
    /* ---- 构筑条件类 ---- */
    beishui: {
      id: 'beishui', ch: '水', name: '背水', tier: 1, when: { maxUnits: 4 },
      give: { spdMul: [0.20, 0.30, 0.40] },
      desc: '棋子数 ≤4 时，全队攻速 +20/30/40%'
    },
    changqu: {
      id: 'changqu', ch: '驱', name: '长驱', tier: 1, when: { perBig: true },
      give: { atkMul: [0.06, 0.09, 0.12] },
      desc: '每有一枚 4 格以上的棋子，全队攻击 +6/9/12%'
    },
    poshu: {
      id: 'poshu', ch: '破', name: '势如破竹', tier: 2, when: { perLevel3: true },
      give: { atkMul: [0.08, 0.12, 0.16] },
      desc: '每有一枚 3 级以上的棋子，全队攻击 +8/12/16%'
    },
    kongcheng: {
      id: 'kongcheng', ch: '空', name: '空城', tier: 2, when: { perEmpty: true, cap: 6 },
      give: { atkMul: [0.04, 0.06, 0.08] },
      desc: '每 1 格空位，全队攻击 +4/6/8%（最多算 6 格）'
    },
    /* ---- 位置类 ---- */
    tiebi: {
      id: 'tiebi', ch: '壁', name: '铁壁', tier: 1, when: { frontRow: true },
      give: { armor: [0.15, 0.22, 0.30] },
      desc: '最前排受到的伤害 −15/22/30%'
    },
    zuofeng: {
      id: 'zuofeng', ch: '锋', name: '左锋', tier: 2, when: { leftmost: true },
      give: { atkMul: [0.30, 0.45, 0.60] },
      desc: '最左列的棋子攻击 +30/45/60%'
    },
    /* ---- 事件规则类 ---- */
    lianu: {
      id: 'lianu', ch: '弩', name: '连弩', tier: 2,
      on: { hit: { scope: 'team', do: 'rerollHit', v: [0.30, 0.45, 0.60], arcOnly: true } },
      limits: { rate: 3 },
      desc: '抛射棋子命中时，有 30/45/60% 概率再打一次'
    },
    jifeng: {
      id: 'jifeng', ch: '疾', name: '疾风', tier: 1,
      on: { trigger: { scope: 'team', do: 'haste', v: [0.15, 0.22, 0.30], dur: 2 } },
      limits: { rate: 3 },
      desc: '触发发生时，全队加速 15/22/30% 持续 2 秒'
    },
    liaoyuan: {
      id: 'liaoyuan', ch: '燎', name: '燎原', tier: 3,
      on: { burn_tick: { scope: 'team', do: 'spread', v: [0.25, 0.35, 0.45] } },
      limits: { rate: 2 },
      desc: '敌人被灼伤时，以 25/35/45% 的强度再扩散一次'
    },
    miaoshou: {
      id: 'miaoshou', ch: '妙', name: '妙手', tier: 2, when: { healOverflow: true },
      give: { healToShield: [0.40, 0.60, 0.80] },
      desc: '治疗溢出转化为 40/60/80% 的护盾'
    },
    jiejian: {
      id: 'jiejian', ch: '箭', name: '借箭', tier: 2, when: { onMerge: true },
      give: { mergeMulticast: [1, 1, 2], mergeGold: [1, 2, 3] },
      desc: '每次合成：该棋子永久 +1 层多重释放，并 +1/2/3 金'
    },
    /* ---- 经济 / 全局类（不进战斗，走 run.mods） ---- */
    tuntian: {
      id: 'tuntian', ch: '屯', name: '屯田', tier: 1, when: { battleEnd: true },
      give: { goldPerBig: [3, 4, 5] },
      desc: '每场结束，每枚 4 格以上的棋子 +3/4/5 金'
    },
    wenjiu: {
      id: 'wenjiu', ch: '温', name: '温酒', tier: 1,
      give: { sellFull: [1, 1, 1] },
      desc: '卖出返还全额'
    },
    cangbing: {
      id: 'cangbing', ch: '藏', name: '藏兵', tier: 1,
      give: { bench: [2, 3, 4] },
      desc: '备战席 +2/3/4'
    },
    tianji: {
      id: 'tianji', ch: '机', name: '天机', tier: 2,
      give: { shopSlot: [1, 1, 2], freeReroll: [1, 1, 2] },
      desc: '集市 +1 货位，每天前 1/1/2 次刷新免费'
    },
    caochuan: {
      id: 'caochuan', ch: '船', name: '草船', tier: 3,
      give: { alwaysUnit: [1, 1, 1], shopDiscount: [1, 2, 3] },
      desc: '刷新必出棋子，且棋子便宜 1/2/3 金'
    }
  };

  /* ---------------- 附魔 ---------------- */
  // 附魔：一次性改造一枚棋子。大巴扎里附魔是「事件随机给、不能撤销」，
  // 所以这里同样限量（CFG.enchMax）+ 贵（8/12/16），不再是可以随便买的货架小卡。
  var ENCHANTS = {
    jin: { id: 'jin', ch: '金', name: '附魔·金', tier: 1, price: 8, desc: '该棋子击杀掉 1 金。', fx: { killGold: 1 } },
    hu: { id: 'hu', ch: '护', name: '附魔·护', tier: 1, price: 8, desc: '该棋子受到的伤害 −18%。', fx: { dmgTaken: 0.18 } },
    yan: { id: 'yan', ch: '焰', name: '附魔·焰', tier: 2, price: 12, desc: '该棋子攻击附带灼烧（每秒 15% 攻击）。', fx: { burn: 0.15 } },
    shuang: { id: 'shuang', ch: '霜', name: '附魔·霜', tier: 2, price: 12, desc: '该棋子命中减速 25%。', fx: { slow: 0.25 } },
    du: { id: 'du', ch: '毒', name: '附魔·毒', tier: 2, price: 12, desc: '该棋子攻击附带中毒（每秒 12% 攻击）。', fx: { poison: 0.12 } },
    lei: { id: 'lei', ch: '雷', name: '附魔·雷', tier: 3, price: 16, desc: '该棋子命中时 20% 概率连锁旁边一人。', fx: { chain: 0.2 } }
  };

  /* ---------------- 解锁 ---------------- */
  // 每天解锁哪些棋子（只列通用棋子；门派专属见 FACTIONS[].pieces）
  // 设计意图：连击循环第 1 天就能起（战鼓旗），燃烧循环第 3~4 天成形（机关人 + 火术师）
  var UNLOCK = {
    1: ['dao', 'yi', 'flag_dmg'],
    2: ['gong', 'shuang'],
    3: ['ji', 'flag_burn'],
    4: ['huo'],
    5: ['dun', 'nu'],
    6: ['feng', 'lei'],
    7: ['qi'],
    8: ['jiang']
  };

  function pieceById(id) { return PIECES[id] || FLAGS[id] || null; }

  function poolFor(faction, day) {
    var out = [], i, j, own = {};
    for (i = 1; i <= day; i++) {
      var list = UNLOCK[i] || [];
      for (j = 0; j < list.length; j++) out.push(list[j]);
    }
    var fac = FACTIONS[faction];
    if (fac) {
      // 门派专属棋子不受 legacy 限制：它们就是这个门派的脸
      for (i = 0; i < fac.pieces.length; i++) {
        var p = PIECES[fac.pieces[i]];
        var tmax = day >= 6 ? 3 : day >= 3 ? 2 : 1;
        if (p && p.tier <= tmax) { out.push(p.id); own[p.id] = 1; }
      }
    }
    var seen = {}, uniq = [];
    for (i = 0; i < out.length; i++) {
      var def = pieceById(out[i]);
      if (!def) continue;
      if (def.legacy && !own[out[i]]) continue;   // legacy 棋子不进通用池
      if (seen[out[i]]) continue;
      seen[out[i]] = 1; uniq.push(out[i]);
    }
    return uniq;
  }

  var heroByChar = (function () {
    var m = {};
    for (var k in HEROES) if (HEROES.hasOwnProperty(k)) {
      m[HEROES[k].chars[0]] = k;
      m[HEROES[k].chars[1]] = k;
    }
    return m;
  }());

  // 兵书按档位取值：value 可能是数字或 [铜,银,金]
  function skillValue(v, tier) {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'number') return v;
    return v[Math.max(0, Math.min(2, (tier || 1) - 1))];
  }

  function skillById(id) { return SKILLS[id] || null; }

  function evoOptions(id) { return EVOLVE[id] || null; }
  function evoDef(id, evoId) {
    var list = EVOLVE[id];
    if (!list) return null;
    for (var i = 0; i < list.length; i++) if (list[i].id === evoId) return list[i];
    return null;
  }

  GB.D = {
    CFG: CFG, LVL: LVL, ULTS: ULTS, ROLE_ULT: ROLE_ULT, PIECES: PIECES, FLAGS: FLAGS, FACTIONS: FACTIONS,
    HEROES: HEROES, SKILLS: SKILLS, ENCHANTS: ENCHANTS, UNLOCK: UNLOCK,
    pieceById: pieceById, poolFor: poolFor, heroByChar: heroByChar,
    EVOLVE: EVOLVE, evoOptions: evoOptions, evoDef: evoDef,
    skillById: skillById, skillValue: skillValue
  };
}(typeof window !== 'undefined' ? window : globalThis));
