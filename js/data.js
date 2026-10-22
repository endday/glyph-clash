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
    maxLevel: 5,
    rerollCost: 2,
    offersBase: 4,
    incomeBase: 7,
    battleTime: 55,
    hpScale: 1.6,           // 血条基准：3.0 太肉（16 下才死人），1.0 又太快，取中间
    ultCharge: 14,
    lastStandAt: 0.30,
    lastStandBonus: 0.35,
    splashMul: [1, 0.5, 0.28],   // 溅射衰减：中心 → 邻格 → 再外一圈
    pierceMul: [1, 0.6, 0.38],   // 穿透衰减：本排 → 后一排 → 后两排
    splashCap: 3,               // 一次最多命中 3 格
    cellsStart: 4,              // 开局背包格（大巴扎也是 4 格起）
    cellsMax: 9,                // 最多 9 格（半场物理上有 22 格，剩下的永远锁着）
    // 解锁第 n 格的价格。曲线参考 TFT 升级 XP（6/10/20/36/48/76，约每级 ×1.6~1.8），
    // 按一局买 5 次的体量缩放：4 / 7 / 12 / 20 / 32
    expandPrices: [4, 7, 12, 20, 32],
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
      id: 'dao', ch: '刀', name: '刀客', size: 1, tier: 1, price: 3, role: 'melee',
      kind: 'unit',
      hp: 900, dmg: 170, atk: 4.0, range: 1,
      desc: '战斗单位。稳定制造「命中」事件——所有连锁的起点。'
    },
    qiang: {
      id: 'qiang', legacy: true, ch: '枪', name: '枪手', size: 2, tier: 1, price: 5, role: 'melee',
      hp: 1000, dmg: 230, atk: 5.0, range: 2, pierce: 1,
      desc: '长兵·穿透。够得着最前排，同列还能捅穿到后一排（六成伤害）。'
    },
    gong: {
      id: 'gong', ch: '弓', name: '弓手', size: 2, tier: 1, price: 5, role: 'arc',
      kind: 'unit',
      hp: 520, dmg: 150, atk: 4.5, range: 4, arc: true,
      desc: '战斗单位。越过前排打最后排，用来点名对面的引擎。'
    },
    qi: {
      id: 'qi', legacy: true, ch: '骑', name: '骑将', size: 3, tier: 2, price: 7, role: 'tank',
      hp: 1400, dmg: 310, atk: 5.5, range: 1, splash: 1,
      desc: '近战·横扫。一撞打到左右三格（外侧减伤），血最厚。'
    },
    jiang: {
      id: 'jiang', legacy: true, ch: '将', name: '将台', size: 3, tier: 3, price: 9, role: 'arc',
      hp: 1900, dmg: 440, atk: 4.0, range: 3, arc: true, splash: 1,
      desc: '抛射·溅射。砸中后排，落点周围一圈按距离衰减。'
    },
    yi: {
      id: 'yi', ch: '医', name: '医者', size: 1, tier: 1, price: 4, role: 'heal',
      kind: 'trigger',
      hp: 600, heal: 260, atk: 5.0, range: 3,
      // 每次治疗都算一次「触发」——风助靠它转起来
      emits: 'trigger',
      desc: '触发器。每 5 秒治疗一次，同时向全场广播「触发」事件。'
    },
    dun: {
      id: 'dun', ch: '盾', name: '盾卫', size: 2, tier: 1, price: 5, role: 'support',
      kind: 'unit',
      hp: 1150, shield: 380, atk: 6.0, range: 2,
      desc: '战斗单位。每 6 秒给射程内友军套护盾，负责把引擎护住。'
    },
    gu: {
      id: 'gu', legacy: true, ch: '鼓', name: '鼓手', size: 1, tier: 1, price: 4, role: 'support',
      hp: 640, haste: 0.35, atk: 6.0, range: 2,
      desc: '增益。每 6 秒让射程内友军攻速 +35%，持续 3 秒。'
    },
    shuang: {
      id: 'shuang', ch: '霜', name: '霜术师', size: 1, tier: 1, price: 5, role: 'mid',
      kind: 'convert',
      hp: 550, dmg: 150, atk: 5.0, range: 3,
      on: { hit: { scope: 'self', do: 'slow', v: 0.35, dur: 2.5 } },
      limits: { rate: 3 },
      desc: '转换器。命中即减速，把「命中」换成「拖节奏」。'
    },
    lei: {
      id: 'lei', ch: '雷', name: '雷术师', size: 2, tier: 2, price: 6, role: 'mid',
      kind: 'trigger',
      hp: 580, dmg: 200, atk: 5.0, range: 4,
      on: { hit: { scope: 'self', do: 'chain', v: 0.5, n: 2 } },
      limits: { rate: 3 },
      desc: '触发器。命中时把伤害连锁给旁边两个人。'
    },

    /* ---- 门派专属 ---- */
    huo: {
      id: 'huo', ch: '火', name: '火术师', size: 2, tier: 2, price: 6, role: 'arc', faction: 'dongwu',
      kind: 'convert',
      hp: 580, dmg: 200, atk: 6.0, range: 4, arc: true, splash: 1,
      // 相邻友军命中 → 给目标挂燃烧（燃烧循环的入口）
      on: { hit: { scope: 'adjacent', do: 'burn', v: 0.45, dur: 3.5 } },
      limits: { rate: 4 },
      desc: '转换器。相邻友军命中时，给目标附加燃烧。'
    },
    feng: {
      id: 'feng', ch: '风', name: '风助', size: 1, tier: 1, price: 5, role: 'flag', faction: 'dongwu',
      kind: 'engine',
      on: { trigger: { scope: 'team', do: 'haste', v: 0.5, dur: 2.5 } },
      limits: { rate: 3 },
      desc: '引擎。场上任何「触发」发生时，全队加速 2 秒——火借风势。'
    },
    jin: {
      id: 'jin', legacy: true, ch: '金', name: '金库', size: 1, tier: 1, price: 4, role: 'gold', faction: 'taozhu',
      hp: 450, gold: 2, atk: 8.0,
      desc: '经济。每 8 秒产 2 金。'
    },
    piao: {
      id: 'piao', legacy: true, ch: '票', name: '票号', size: 2, tier: 2, price: 6, role: 'gold', faction: 'taozhu',
      hp: 640, gold: 5, atk: 10.0,
      desc: '经济。每 10 秒产 5 金，占两格但印钞。'
    },
    ji: {
      id: 'ji', ch: '机', name: '机关人', size: 1, tier: 1, price: 5, role: 'flag', faction: 'mojia',
      kind: 'engine',
      // 燃烧跳伤 → 给相邻战斗单位减冷却（燃烧循环的回环）
      on: { burn_tick: { scope: 'team', do: 'charge', v: 1.5 } },
      limits: { rate: 3 },
      desc: '引擎。敌人每次被燃烧灼伤，就给相邻战斗单位减 1.5 秒冷却（每秒最多 3 次）。'
    },
    nu: {
      id: 'nu', ch: '弩', name: '连弩车', size: 1, tier: 2, price: 6, role: 'arc', faction: 'mojia',
      kind: 'trigger',
      hp: 720, dmg: 110, atk: 2.8, range: 3, arc: true,
      desc: '触发器。攻速极快，专门给引擎刷「命中次数」。'
    },
    du: {
      id: 'du', legacy: true, ch: '毒', name: '毒师', size: 1, tier: 1, price: 5, role: 'flag', faction: 'miaoyu',
      aura: 'poison', value: 0.25,
      desc: '光环：相邻棋子的攻击附带中毒。'
    },
    lu: {
      id: 'lu', legacy: true, ch: '庐', name: '药庐', size: 2, tier: 2, price: 6, role: 'heal', faction: 'miaoyu',
      hp: 720, heal: 170, atk: 4.0, range: 3,
      desc: '持续治疗。出手快但单次少，适合打消耗。'
    },
    lou: {
      id: 'lou', legacy: true, ch: '楼', name: '望楼', size: 2, tier: 1, price: 6, role: 'flag', faction: 'wolong',
      aura: 'range', value: 1,
      desc: '光环：相邻棋子射程 +1。'
    },
    liuma: {
      id: 'liuma', legacy: true, ch: '马', name: '流马', size: 3, tier: 2, price: 7, role: 'tank', faction: 'wolong',
      hp: 1200, dmg: 200, atk: 4.0, range: 3,
      desc: '中排。血不薄，却能隔空输出。'
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
      limits: { rate: 2 },
      desc: '引擎。全队每累计 2 次命中，出手者立刻再打一次（每秒最多 1.5 次）。'
    },
    flag_spd: { id: 'flag_spd', legacy: true, ch: '令', name: '令疾旗', size: 1, tier: 1, price: 5, role: 'flag', aura: 'spd', value: 0.15, desc: '光环：相邻棋子攻速 +15%。' },
    flag_hp: { id: 'flag_hp', legacy: true, ch: '壁', name: '铁壁旗', size: 1, tier: 1, price: 5, role: 'flag', aura: 'hp', value: 0.20, desc: '光环：相邻棋子血量上限 +20%。' },
    flag_burn: {
      id: 'flag_burn', ch: '烽', name: '火盆旗', size: 1, tier: 2, price: 5, role: 'flag',
      kind: 'engine',
      // 燃烧跳伤 → 把燃烧扩散给旁边的敌人
      on: { burn_tick: { scope: 'team', do: 'spread', v: 0.5 } },
      limits: { rate: 1 },
      desc: '引擎。敌人被燃烧灼伤时，把燃烧扩散给它旁边的敌人（每秒最多 1 次）。'
    },
    flag_slow: { id: 'flag_slow', legacy: true, ch: '冰', name: '冰鉴旗', size: 1, tier: 2, price: 5, role: 'flag', aura: 'slow', value: 0.30, desc: '光环：相邻棋子攻击附带减速。' },
    flag_gold: { id: 'flag_gold', legacy: true, ch: '鳞', name: '金鳞旗', size: 1, tier: 2, price: 5, role: 'flag', aura: 'gold', value: 1, desc: '光环：相邻棋子击杀掉 1 金。' }
  };

  /* ---------------- 门派 ---------------- */
  var FACTIONS = {
    dongwu: {
      id: 'dongwu', name: '江东火', hero: '周瑜', promise: '一把火，烧穿整条战线',
      desc: '灼烧伤害 +40%。', passive: 'burn', color: '#b03a2e',
      pieces: ['huo', 'feng'], start: ['dao', 'huo', 'flag_dmg']
    },
    taozhu: {
      id: 'taozhu', name: '陶朱商', hero: '范蠡', promise: '前三日最弱，后七日用钱买出一面阵',
      desc: '每场 +3 金，利息上限翻倍。', passive: 'gold', color: '#a9812f',
      pieces: ['jin', 'piao'], start: ['dao', 'jin', 'yi']
    },
    mojia: {
      id: 'mojia', name: '墨家机', hero: '墨子', promise: '机器互相喂养，越摆越强',
      desc: '所有光环效果 +25%。', passive: 'aura', color: '#3f6b57',
      pieces: ['ji', 'nu'], start: ['dao', 'ji', 'gong']
    },
    miaoyu: {
      id: 'miaoyu', name: '苗疆蛊', hero: '蛊师', promise: '先挨打，再让你慢慢烂掉',
      desc: '中毒可叠 3 层。', passive: 'poison', color: '#5d7a3a',
      pieces: ['du', 'lu'], start: ['dao', 'du', 'yi']
    },
    wolong: {
      id: 'wolong', name: '卧龙阵', hero: '诸葛亮', promise: '你够不着我，我却够得着你',
      desc: '所有抛物线棋子射程 +1。', passive: 'range', color: '#40546e',
      pieces: ['lou', 'liuma'], start: ['gong', 'lou', 'dao']
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
  var SKILLS = {
    tuntian: { id: 'tuntian', ch: '屯', name: '屯田', tier: 1, price: 6, desc: '每场结束 +5 金。', fx: { income: 5 } },
    jiejian: { id: 'jiejian', ch: '箭', name: '借箭', tier: 1, price: 5, desc: '每次合成 +2 金。', fx: { mergeGold: 2 } },
    wenjiu: { id: 'wenjiu', ch: '温', name: '温酒', tier: 1, price: 5, desc: '卖出返还全额。', fx: { sellFull: true } },
    cangbing: { id: 'cangbing', ch: '藏', name: '藏兵', tier: 1, price: 4, desc: '备战席 +2。', fx: { bench: 2 } },
    tianji: { id: 'tianji', ch: '机', name: '天机', tier: 2, price: 7, desc: '集市 +1 货位。', fx: { shopSlot: 1 } },
    caochuan: { id: 'caochuan', ch: '船', name: '草船', tier: 2, price: 7, desc: '刷新必出棋子。', fx: { alwaysUnit: true } },
    tiebi: { id: 'tiebi', ch: '壁', name: '铁壁', tier: 3, price: 10, desc: '全军血量 +12%。', fx: { hp: 0.12 } },
    jinlin: { id: 'jinlin', ch: '鳞', name: '金鳞', tier: 1, price: 6, desc: '击杀 +1 金（每场上限 15）。', fx: { killGold: 1, killCap: 15 } },
    poshu: { id: 'poshu', ch: '破', name: '势如破竹', tier: 2, price: 8, desc: '每个 5 级棋子，全军攻击 +6%。', fx: { rupture: 0.06 } },
    bingsu: { id: 'bingsu', ch: '速', name: '兵贵神速', tier: 1, price: 6, desc: '开局 15 秒攻速 +40%。', fx: { openingRush: 0.4 } },
    jifeng: { id: 'jifeng', ch: '疾', name: '疾风', tier: 2, price: 8, desc: '全军攻速 +10%。', fx: { spd: 0.10 } },
    changqu: { id: 'changqu', ch: '驱', name: '长驱', tier: 3, price: 9, desc: '全军攻击 +15%。', fx: { dmg: 0.15 } },
    kongcheng: { id: 'kongcheng', ch: '空', name: '空城', tier: 3, price: 9, desc: '前排受伤 −25%。', fx: { frontArmor: 0.25 } },
    lianu: { id: 'lianu', ch: '弩', name: '连弩', tier: 2, price: 7, desc: '抛物线棋子攻速 +25%。', fx: { arcSpd: 0.25 } },
    tieqi: { id: 'tieqi', ch: '骑', name: '铁骑', tier: 2, price: 7, desc: '前排棋子血量 +20%。', fx: { tankHp: 0.2 } },
    miaoshou: { id: 'miaoshou', ch: '妙', name: '妙手', tier: 2, price: 7, desc: '治疗效果 +50%。', fx: { healBoost: 0.5 } }
  };

  /* ---------------- 附魔 ---------------- */
  var ENCHANTS = {
    yan: { id: 'yan', ch: '焰', name: '附魔·焰', tier: 2, price: 5, desc: '该棋子攻击附带灼烧。', fx: { burn: 0.3 } },
    shuang: { id: 'shuang', ch: '霜', name: '附魔·霜', tier: 2, price: 5, desc: '该棋子攻击附带减速。', fx: { slow: 0.35 } },
    du: { id: 'du', ch: '毒', name: '附魔·毒', tier: 2, price: 6, desc: '该棋子攻击附带中毒。', fx: { poison: 0.25 } },
    lei: { id: 'lei', ch: '雷', name: '附魔·雷', tier: 3, price: 6, desc: '命中时 30% 概率连锁旁边一人。', fx: { chain: 0.3 } },
    jin: { id: 'jin', ch: '金', name: '附魔·金', tier: 1, price: 4, desc: '该棋子击杀掉 1 金。', fx: { killGold: 1 } },
    hu: { id: 'hu', ch: '护', name: '附魔·护', tier: 1, price: 4, desc: '该棋子受伤 −30%。', fx: { dmgTaken: 0.3 } }
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
    7: [],
    8: []
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

  GB.D = {
    CFG: CFG, LVL: LVL, ULTS: ULTS, ROLE_ULT: ROLE_ULT, PIECES: PIECES, FLAGS: FLAGS, FACTIONS: FACTIONS,
    HEROES: HEROES, SKILLS: SKILLS, ENCHANTS: ENCHANTS, UNLOCK: UNLOCK,
    pieceById: pieceById, poolFor: poolFor, heroByChar: heroByChar
  };
}(typeof window !== 'undefined' ? window : globalThis));
