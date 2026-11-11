// taskflow.ts — taskflow 的 pi 宿主适配器（源住技能仓 packs/host-adapters/pi/taskflow.ts，与 assets/guard/taskflow-guard.js 同源分宿主）
// 架构参照 obra/superpowers 的 .pi/extensions/superpowers.ts：一套技能内核，每宿主一个薄适配文件。
// 装配：用户级 `ln -sf <技能仓>/packs/host-adapters/pi/taskflow.ts ~/.pi/agent/extensions/taskflow.ts`
//       （或项目级放 <项目>/.pi/extensions/）；技能本体发现走既有路径（~/.pi/agent/skills 软链到技能仓根）。
//
// v2.63.0 范围（与 omp 版 assets/guard/taskflow-guard.js 逐条对照）：
//   【映射注入】宿主映射表——技能文件里的 omp 工具字样（omp Todo/task 子代理/@taskflow/--session）→ pi 等价物；
//     经 before_provider_request 前缀进 system，每请求静态注入（byte-identical 不破 prompt cache）。
//     通道实证：pi -p/print 模式下 context 事件的 messages 变更不生效（handler 触发、返回值被忽略，
//     2026-10-15 e2e），provider 层全模式必经。omp 版无此件（omp 是技能的原生宿主，无需翻译）。
//   【C 接力】压缩后把活任务接力线索附进注入块（一次性消费）。omp 版挂 session.compacting 返回 {context}；pi 的
//     SessionBeforeCompactResult 无 context 注入口（types.d.ts:1137 只有 cancel/compaction）→
//     改走 session_compact 置位、随下一请求的 system 注入块附加（一次性消费）。
//   【D 状态栏】活任务/等你验收/敞口——1:1 移植；ctx.ui.setStatus(key, text) 同名；任务清零时显式清除
//     （pi 文档明确 undefined=clear，omp 版不清是已知小尾巴，此处顺手收口）。
//   【B1 硬拦】tf.mjs commit --files 空格分隔多文件 → block。1:1 移植。
//   【A 部署墙】DEPLOY_SIG 分段判定 + tf.mjs deploy 入口放行 + TF_WALL 三档。判定 1:1 移植。
//   【G 编辑边界门】edit/write 路径对照声明清单（worktree 归属/兄弟 worktree/并集比对/簿记白名单）+
//     TF_BOUND 三档。判定 1:1 移植，白名单增 `.pi/`（pi 宿主簿记/扩展目录，对齐 omp 版的 `.omp/`）。
//   【H 领域提示门】v3.5.0 自 omp 版 v3.3.0 移植：edit/write 命中领域硬信号（扩展名/测试文件名）→ 提示附加到本次
//     写入的 tool_result content 末尾（toolCallId 精确关联——Claude PostToolUse「工具结果旁注入」的同位语义）。
//     通道实证（2026-11-10，pi 1.5.1 真机）：before_provider_request 的 system 前缀只在首个 provider 请求生效，
//     续请求（工具结果后的续答）追加内容不可达（会话转录实证：映射文本在、续请求追加的特征短语 0 命中）——
//     故弃用 bpr 通道改走 tool_result。检测/去重/.guard-log 流水与 omp 版同格式（detail 首段=领域名 + ses= 键——
//     tf.mjs hint-stats 解析契约；会话标识=ctx.sessionManager.getSessionId，回退 PI_SESSION_ID）。提示永不拦截，
//     fail-open 吞错静默；采纳闸同 guardOn；TF_HINT=off 关。映射技能清单运行时读
//     ~/.pi/agent/skills/taskflow/scripts/skills-registry.json（pi 适配器无渲染期，读失败降级空映射）；
//     在场检测 spawn node <技能仓>/scripts/tf.mjs skills <领域词>。
// 与 omp 版的明确差异（全部有据，升级 omp 版时同步对照）：
//   1. 警告档升级（v3.6.0）：pi 的 tool_call 可 await ctx.ui.confirm 交互确认（官方示例同款）——A/G 默认警告档、
//      J 显式 warn 档改走「确认框放行/拦截」，比 omp additionalContext 警告更强（人拍板）；非交互模式（print/无 UI）
//      confirm 不可得 → 回退「拦截+off 重试指引」旧形态。off/enforce 档与 omp 完全一致。
//   2. additionalContext 同位替代（v3.6.0）：omp 的 additionalContext（放行附注）在 pi 统一改走 tool_result
//      content 末尾附加（H 门 v3.5.0 已实证的送达通道，callId 精确关联）——K 验收期提醒（交互模式确认框、
//      非交互回退附注）、B2 web-only 提醒、F 派发门未引用 spec 提醒均此通道；时机差异=附注在执行后送达（omp 在执行前）。
//   3. F 派发门（v3.6.0）：tool_call input 原地改写（pi 文档明示 tool_call.input 可变）——Agent 工具（pi 原生与
//      pi-subagents 同名同参 prompt:string，SUBAGENT_TOOL_NAMES.AGENT 实证）派发词引用 spec 路径 → 校验必填节后
//      spec 全文机械写回 prompt；引用缺失/空节=硬拦。omp 的 tasks[] 批量派发形态与 SubagentWorkflow 脚本改写
//      不适用（脚本注入风险），不移植。
//   4. E 输出规范+实况行 + I 词表反馈沉淀（v3.6.0）：走 before_provider_request 注入块（与映射注入同通道同界
//      =.taskflow 在场；内容随词表/实况变化即破 prompt cache，omp 版 v2.56.0 起同款接受）；I 检测在 bpr 消息面
//      （pi 无 omp context 事件），压缩兜底复用 C 接力置位机制；I 清零=词表文件被 edit/write。
//   5. T 技能埋点（v3.6.0）：omp 的 skill:// 协议路径 pi 无——改认 /skills/<名>/ 路径形态（pi 技能发现以绝对
//      路径读取 SKILL.md/references），计数落 TF_SKILL_USAGE 或 ~/.pi/agent/skill-usage.jsonl
//      （host-adapter.mjs usagePath 已补 pi 分支，tf.mjs skills --usage 报表可读）。
//   6. 命令前缀 env 豁免自解析（v3.6.0 活体实证补）：pi 下「命令前加 TF_*=off」的 shell env 前缀进不了宿主进程
//      （拦截读的是 pi 进程的 process.env）——bash 通道改为宿主自解析命令头部 TF_* 赋值作为本调用生效档
//      （cmdEnvOverride；edit 通道无命令串，豁免话术改为「warn 档确认框放行 / 会话级启动环境 off」）。
//   7. 仍未移植（留后续版本）：V 档案删除告警、DP deployment 落档校验、W 牵连排查+数据边界、RENDER 渲染证据墙、
//      U 状态引导注入、J01 多假设排序弹脸（omp v2.71~v3.x 增量；通道均可达，纯工作量）。
//   3. 采纳闸：同 project.json.mechanisms.TASKFLOW_GUARD——B/A/G/D 与 omp 版共用同一登记，双宿主一闸；
//      映射注入与 C 接力不受闸控（不是强制力，是技能可读性，零干扰边界=项目内有 .taskflow）。
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const MAPPING_MARKER = "taskflow:pi-host-mapping";

// tool_result 附注队列（v3.6.0）：omp additionalContext 的 pi 同位通道——armNote 入队（callId 关联），
// tool_result 出队送达（content 末尾附加）。K/B2/F提醒/H/class-sweep 全走此通道；turn_end 清残（未送达即弃）。
let pendingNotes = [];
function armNote(callId, text, kind) { if (typeof callId === 'string') pendingNotes.push({ callId, text, kind }); }

// ---- 通用定位（1:1 移植自 assets/guard/taskflow-guard.js）----
function locateTasksDir(cwd) {
  try {
    const common = execFileSync('git', ['-C', cwd ?? process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const dir = path.join(path.dirname(common), '.taskflow');
    if (fs.existsSync(dir)) return dir;
  } catch { /* 非 git 目录 */ }
  return null;
}

function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

// 路径基归一：git rev-parse 返回真实路径，path.resolve 保留符号链接——两端基不一致时比对恒错（omp 版 v2.49.1 实证）
const realPath = (p) => { let cur = p; const suffix = []; for (;;) { try { return path.join(fs.realpathSync(cur), ...suffix); } catch { /* 该层不存在，上爬 */ } suffix.unshift(path.basename(cur)); const parent = path.dirname(cur); if (parent === cur) return p; cur = parent; } };

// ---- J：状态翻转墙（v2.69.0 自 omp 版 1:1 同步）----
// 机器快照与 scripts/taskflow-state-machine.mjs TRANSITIONS、assets/guard/taskflow-guard.js STATE_SNAPSHOT
// 三处同源——改状态机必同步；版本漂移由 mech check 兜底。
const STATE_SNAPSHOT = {
  states: ['active', 'verifying', 'parked', 'merged', 'archived'],
  legal: [ // [from, to] 白名单（from null=建档前）；archive 是物理归层无 status 翻转，不入本表
    [null, 'active'], ['active', 'verifying'], ['active', 'merged'],
    ['active', 'parked'], ['parked', 'active'], ['verifying', 'merged'],
  ],
};
// 判定与 omp 版逐字同源：旧不存在（新建档案）仅 status=active 放行；坏 JSON 视同违规；
// 顶层 status 或 deploy.status 任一变化即翻转。返回 null=放行，否则违规原因串。
function judgeStatusFlip(abs, event) {
  const oldJ = readJsonSafe(abs);
  const toText = () => {
    if (event.toolName === 'write') return typeof event.input?.content === 'string' ? event.input.content : null;
    const disk = (() => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } })();
    if (disk === null) return null;
    const os = event.input?.old_string; const ns = event.input?.new_string;
    if (typeof os !== 'string' || typeof ns !== 'string') return null;
    return disk.split(os).join(ns); // edit 语义模拟：字面替换（替换不命中=新内容=旧内容=放行）
  };
  let newJ = null;
  try { newJ = JSON.parse(toText()); } catch { /* 坏 JSON */ }
  const show = (v) => (v === undefined || v === null ? '（无）' : String(v));
  const tail = `违规（data.md 状态机表：翻转唯一写路径 commit --deployed / accept --pass / park / unpark / archive；档案修复走 node tf.mjs reconcile --fix）。豁免：TF_STATUS=warn 档用户确认放行；bash 通道支持命令前缀 TF_STATUS=off（宿主自解析，v3.6.0）；会话级=启动 pi 的环境设 TF_STATUS=off`;
  if (!newJ || typeof newJ !== 'object') {
    return `TASKFLOW_GUARD J 状态翻转墙：${abs} 新内容解析失败（坏档案）——${tail}`;
  }
  const fromS = oldJ?.status; const toS = newJ.status;
  const fromD = oldJ?.deploy?.status; const toD = newJ.deploy?.status;
  if (!oldJ) {
    if (toS === 'active' && toD !== 'verifying') return null;
    return `TASKFLOW_GUARD J 状态翻转墙：${abs} 新建档案 status ${show(toS)} 非法（仅 active 可建档）——${tail}`;
  }
  if (fromS === toS && fromD === toD) return null;
  const flips = [];
  if (fromS !== toS) flips.push(`status ${show(fromS)}→${show(toS)}`);
  if (fromD !== toD) flips.push(`deploy.status ${show(fromD)}→${show(toD)}`);
  const legal = STATE_SNAPSHOT.legal.some(([f, t]) => f === fromS && t === toS);
  return `TASKFLOW_GUARD J 状态翻转墙：${abs} ${flips.join(' + ')} ${legal ? '' : '（该翻转亦不在状态机白名单）'}——${tail}`;
}

// 采纳闸：mechanisms.TASKFLOW_GUARD 登记（双宿主一闸；卸载=删文件或清登记皆可）
function guardOn(cwd) {
  try {
    const d = locateTasksDir(cwd);
    if (!d) return false;
    const j = JSON.parse(fs.readFileSync(path.join(d, 'project.json'), 'utf8'));
    return !!j?.mechanisms?.TASKFLOW_GUARD;
  } catch { return false; }
}

// ---- D：状态栏（1:1 移植；任务清零时显式清除）----
function statusLine(tasksDir) {
  const idx = readJsonSafe(path.join(tasksDir, 'index.json'))?.tasks ?? [];
  const active = idx.filter((t) => t?.status === 'active').length;
  const verifying = idx.filter((t) => t?.status === 'verifying');
  if (!active && !verifying.length) return '';
  let s = `tf:进行中${active}`;
  if (verifying.length) {
    let exposure = 0;
    for (const t of verifying) {
      const tj = readJsonSafe(path.join(tasksDir, t.id, 'task.json'));
      const at = tj?.deploy?.deployedAt;
      if (at && Date.now() - Date.parse(at) > 86400000) exposure++; // I16 口径：已部署未合并超 24h
    }
    s += ` 等你验收${verifying.length}${exposure ? ` ⚠${exposure}个已上线超24小时未合并` : ''}`;
  }
  return s;
}

function refreshStatus(ctx) {
  const dir = locateTasksDir(ctx?.cwd);
  if (!dir) return;
  const s = statusLine(dir);
  ctx.ui?.setStatus?.('tf', s || undefined); // pi：undefined=清除（空态不留陈旧残影）
}

// ---- B1：--files 空格分隔检测（1:1 移植）----
function spaceSeparatedFiles(cmd) {
  const at = cmd.indexOf('--files');
  if (at === -1) return false;
  const toks = cmd.slice(at + '--files'.length).trim().split(/\s+/);
  const files = [];
  for (const t of toks) { if (t.startsWith('-')) break; files.push(t); }
  return files.length > 1;
}

// ---- A：部署特征（1:1 移植）----
const DEPLOY_SIG = /\brsync\b[^\n|;&]*(\/opt\/|\.jar\b|\/web\/)|\bscp\b[^\n|;&]*(\/opt\/|\.jar\b|\/web\/)|\bssh\b[^\n|;&]*systemctl[^\n|;&]*(restart|stop|reload)/;

// ---- v3.6.0 移植常量（omp 版 assets/guard/taskflow-guard.js 同源）----
const FEEDBACK_SIG = /看不懂|没看懂|看不明白|读不懂|没明白|不明白|什么意思|说人话|讲人话|太术语/; // 「人话」单词不单列——问原理也命中（omp 2026-10-11 实证误报）
const SPEC_REF_RE = /\.taskflow\/[^\s'"`()[\]（）]*spec\.md/g; // 派发词里引用的 spec 路径
const SUBSPEC_REQUIRED = [['背景', /^背景(\s|$|（)/], ['目标', /^目标(\s|$|（)/], ['验收', /^验收(\s|$|（)/], ['涉及文件', /^涉及文件(\s|$|（)/], ['约束与禁止', /^约束与禁止(\s|$|（)/]];
const TASKSPEC_REQUIRED = [['目标', /^目标(\s|$|（)/], ['验收标准', /^验收标准(\s|$|（)/]];
const BLOCKER_RE = /block(?:er|ing|ed)s?|阻塞|卡点|卡住/i; // 报告内否定语境（如「无 blockers」）仍会提醒=已知边界（omp v2.61.1 同款）
const SUBAGENT_TOOLS = new Set(['Agent', 'SubagentWorkflow', 'get_subagent_result', 'steer_subagent']); // pi 原生 + pi-subagents 同名（SUBAGENT_TOOL_NAMES 实证）
const feedback = { seen: new Set(), pending: 0 }; // I 词表反馈计数（模块级：跨事件存活）
let compactionExtras = []; // I 压缩兜底行（session_compact 置位，bpr 一次性消费）

// 非交互回退注记（confirmOr 不可用时附在拦截 reason 尾）
const nonInteractiveNote = (door) => `\n（pi 适配器：当前无交互确认框（print/无 UI 模式），默认档以拦截+本指引代替 omp 版警告放行——确要执行加 ${door}=off 重试同一条操作。）`;

// 命令前缀 env 豁免（v3.6.0 活体实证补）：pi 下「命令前加 TF_*=off」的 env 前缀进不了宿主进程（拦截读的是 pi
// 进程的 process.env，shell 前缀赋值到不了）——宿主自解析命令头部 TF_* 赋值作为本调用生效档，豁免指引才是真的。
function cmdEnvOverride(cmd) {
  const out = {};
  let rest = cmd;
  for (;;) {
    const m = /^([A-Z_][A-Z0-9_]*)=(\S+)\s+/.exec(rest);
    if (!m || !m[1].startsWith('TF_')) break;
    out[m[1]] = m[2];
    rest = rest.slice(m[0].length);
  }
  return out;
}

// 警告档交互确认（v3.6.0）：官方示例同款 await ctx.ui.confirm——「确认」放行/「取消」拦截；
// 非交互模式（print/无 UI）抛错或不可得 → 回退「拦截+off 重试指引」旧形态（保守不更松）。
async function confirmOr(ctx, why, door, gate, cwd) {
  try {
    const ok = await ctx?.ui?.confirm?.(`TASKFLOW_GUARD 警告（${door} 可调档）`, `${why}\n\n「确认」= 放行本次操作；「取消」= 拦截。重试时前缀 ${door}=off 可免弹框。`);
    if (ok === true) { guardLog(cwd, gate, 'allow', `${door} 默认档用户确认放行`); return undefined; }
    if (ok === false) return { block: true, reason: `${why}\n（确认框选了「取消」= 已拦下。确要执行：重试命令前加 ${door}=off。）` };
  } catch { /* 非交互模式 → 回退 */ }
  return { block: true, reason: why + nonInteractiveNote(door) };
}

function resolveSpecRef(ref, cwd, mainRoot) { // spec 引用落盘解析（omp 版 1:1）：.taskflow 住主仓库，worktree 内回主仓库找
  const cands = path.isAbsolute(ref)
    ? [ref]
    : [mainRoot ? path.join(mainRoot, ref) : null, cwd ? path.join(cwd, ref) : null].filter(Boolean);
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* 候选不存在 */ } }
  return null;
}

function validateSpecRequired(text, isSubtask) { // 必填节校验（omp 版 1:1）：占位不算内容
  const missing = [];
  for (const [name, re] of isSubtask ? SUBSPEC_REQUIRED : TASKSPEC_REQUIRED) {
    const body = extractSectionBody(text, re);
    const solid = body.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*[-*]\s*<[^>]*>.*$/gm, '').replace(/（暂无）/g, '').trim();
    if (!solid) missing.push(body.trim() ? `${name}（仅占位）` : name);
  }
  return missing;
}

function readGlossary(p) { // 词表活读（omp 版 1:1）：markdown 表格 行话|白话
  const text = (() => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } })();
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    if (!cells[1] || !cells[2] || /^[-: ]+$/.test(cells[1]) || cells[1] === '行话') continue;
    rows.push({ term: cells[1], plain: cells[2] });
  }
  return rows;
}

function buildSpecInject(dir) { // E 输出规范注入（v3.6.0 自 omp 版移植）：双层规范+词表活读+实况行+I 逐轮指令。
  // 与映射注入同界（.taskflow 在场）；内容随词表/实况变化即破 prompt cache——omp 版 v2.56.0 起同款接受。
  const lines = [
    '[面向用户输出规范（TASKFLOW_GUARD 注入）]',
    '- 给用户看的内容：完整因果句（谁、对谁、做了什么、所以怎样）、结论先行；术语/代号/缩写首次出现后面直接跟括号大白话（白话从下方词表抄，词表没有的词当场补录；用户说看不懂 → 当场改写词表，下一轮生效）',
    '- 多个并列/对比先给骨架（表格/编号清单/矩阵），格子内用叙事句展开；禁名词定语堆栈、禁未解释的代号；一段一个中心 ≤4 句',
  ];
  const glossary = readGlossary(path.join(dir, 'glossary.md'));
  if (glossary.length) {
    lines.push('- 行话对照（写作时先对表说人话，词表可迭代——用户说看不懂就改写白话）：');
    for (const g of glossary) lines.push(`  ${g.term}=${g.plain}`);
  }
  if (feedback.pending > 0) lines.push(`- 词表反馈待清（TASKFLOW_GUARD 词表反馈沉淀）：还有 ${feedback.pending} 处「看不懂」类反馈未处理——先判断是否真属术语问题（可能猜错，不拦操作）；确是就当场把涉事术语的大白话改写/补录进 .taskflow/glossary.md（词表活读下一轮生效）。`);
  // E 实况状态行（omp v2.69.0）：活/等验收（部署短格式）/挂起
  const idx = readJsonSafe(path.join(dir, 'index.json'))?.tasks ?? [];
  const shortTs = (iso) => (typeof iso === 'string' && !Number.isNaN(Date.parse(iso)) ? iso.slice(5, 16).replace('T', ' ') : null);
  const parts = [];
  const active = idx.filter((t) => t?.status === 'active').map((t) => t.id);
  if (active.length) parts.push(`活 ${active.join('、')}`);
  const vIds = [];
  for (const t of idx) {
    if (t?.status !== 'verifying') continue;
    const s = shortTs(readJsonSafe(path.join(dir, t.id, 'task.json'))?.deploy?.deployedAt);
    vIds.push(s ? `${t.id}（部署 ${s}）` : String(t.id ?? '?'));
  }
  if (vIds.length) parts.push(`等验收 ${vIds.join('、')}`);
  const parked = idx.filter((t) => t?.status === 'parked').map((t) => t.id);
  if (parked.length) parts.push(`挂起 ${parked.join('、')}`);
  if (parts.length) lines.push(`taskflow 实况：${parts.join('；')}`);
  return lines.join('\n');
}

function detectFeedback(messages, ctx) { // I 检测（v3.6.0）：pi 无 omp context 事件——在 provider 请求消息面数 user 强信号。
  // 只计数不追加（提醒走 E 通道逐轮指令）；Set 去重防重放重复计数；自家注入（含 TASKFLOW_GUARD）不数。
  try {
    if (!guardOn(ctx?.cwd)) return; // omp 版 I 通道同款采纳闸
    const msgs = Array.isArray(messages) ? messages : null;
    if (!msgs?.length) return;
    for (const m of msgs) {
      if (m?.role !== 'user') continue;
      const text = typeof m?.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join(' ') : '';
      if (!text || text.includes('TASKFLOW_GUARD') || !FEEDBACK_SIG.test(text)) continue;
      if (feedback.seen.has(text)) continue;
      feedback.seen.add(text);
      feedback.pending += 1;
      guardLog(ctx?.cwd, 'glossary', 'inject', `「看不懂」类反馈待沉淀计数 ${feedback.pending} 处`);
    }
  } catch { /* 检测失败静默 */ }
}

function trackSkillRead(event, ctx) { // T 技能埋点（v3.6.0 自 omp v2.69.0 移植）：不受采纳闸控，零内容仅计数，整体吞错。
  // omp 认 skill:// 协议路径；pi 无该协议——改认 /skills/<名>/ 绝对路径形态（pi 技能发现实证）。
  try {
    if (event?.toolName !== 'read') return;
    const p = String(event.input?.path ?? '');
    if (!p) return;
    const m = p.match(/^skill:\/\/([^/]+)/) ?? p.match(/\/skills\/([^/]+)\//);
    if (!m?.[1]) return;
    const file = process.env.TF_SKILL_USAGE || path.join(os.homedir(), '.pi', 'agent', 'skill-usage.jsonl');
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), skill: m[1], project: path.basename(ctx?.cwd ?? process.cwd()) }) + '\n');
  } catch { /* 埋点失败静默——绝不拦主流程 */ }
}

function dispatchGate(event, ctx) { // F 派发门（v3.6.0 自 omp 版移植）：通道=tool_call input 原地改写（pi 文档明示可变）。
  // Agent 工具（pi 原生与 pi-subagents 同名同参）；SubagentWorkflow 脚本改写有注入风险，不适用（见头差异 3）。
  const prompt = typeof event.input?.prompt === 'string' ? event.input.prompt : '';
  if (!prompt) return undefined;
  const dir = locateTasksDir(ctx?.cwd);
  if (!dir) return undefined; // 零干扰边界
  const refs = [...new Set([...prompt.matchAll(SPEC_REF_RE)].map((m) => m[0]))];
  if (!refs.length) {
    // 未引用 spec：有活任务时提醒不拦（调研/审查类合法，三场景管制②③）——附注随执行结果送达（pi 无 additionalContext）
    const idx = readJsonSafe(path.join(dir, 'index.json'))?.tasks ?? [];
    if (idx.some((x) => x?.status === 'active' || x?.status === 'verifying')) {
      armNote(event.toolCallId, '⚠ TASKFLOW_GUARD 派发门（自动检查脚本的派发检查）提醒，不拦截：实现类子代理派发应先写好任务说明书（spec：.taskflow/<任务id>/subtasks/<编号>/spec.md，含背景/目标/验收/涉及文件/约束五节），并在派发词里引用它的路径——宿主会校验五节是否齐全，再把说明书全文原样塞给子代理，防止凭记忆转述、细节走样（本提醒随执行结果送达，下次派发生效）。调研/审查类派发不受此约束，可忽略本提醒。');
    }
    return undefined;
  }
  const mainRoot = path.dirname(dir);
  let firstAbs = null;
  for (const ref of refs) {
    const abs = resolveSpecRef(ref, ctx?.cwd, mainRoot);
    if (!abs) return { block: true, reason: `TASKFLOW_GUARD 派发门：派发词引用的 spec 不存在（${ref}）——先按 templates/subtask-spec.md 落规格再派发（split.md：spec 必须自包含，执行者只认文档不认会话记忆）` };
    const missing = validateSpecRequired(fs.readFileSync(abs, 'utf8'), ref.includes('/subtasks/'));
    if (missing.length) return { block: true, reason: `TASKFLOW_GUARD 派发门：${ref} 必填节缺失或为空——${missing.join('、')}；补齐后再派发（subtask spec 节名：背景/目标/验收/涉及文件/约束与禁止；任务级 spec 节名：目标/验收标准）` };
    firstAbs ??= abs;
  }
  const specText = fs.readFileSync(firstAbs, 'utf8');
  const taskId = firstAbs.match(/\.taskflow[^/]*\/([^/]+)\//)?.[1] ?? null;
  const tj = taskId ? readJsonSafe(path.join(dir, taskId, 'task.json')) : null;
  const wt = tj?.worktree ? `\n工作目录（worktree）：${tj.worktree}\n` : '';
  event.input.prompt = `[TASKFLOW_GUARD 派发门——以下 spec 全文机械读取自 ${refs[0]}（split.md 自包含纪律的宿主落地，编排层凭记忆转述=违规）]\n\n${specText}\n${wt}\n——范围纪律：只做本子任务范围内的事，不顺手改其他代码；完成后报告：改动文件清单、验收命令运行结果、遗留问题。\n——编排层原始派发词（原样保留备查）：\n${prompt}`;
  return undefined; // input 原地变更即生效
}

const CLASS_SWEEP_TEXT = '⚠ TASKFLOW_GUARD 同类排查提醒：这是宿主的同类排查提醒（taskflow 的 pi 适配器发的），可能猜错，不拦任何操作——子代理报告里出现了「阻塞 / blocker / 卡点」字样，猜测你可能在处理一个被卡住的问题。如果确实要修 bug，动手前先答三个问题（同类排查，CLASS_SWEEP_GATE：修一处之前先查清影响范围的规矩）：① 上游——坏结果的输入/前提从哪来，源头干净吗；② 下游——修好的东西被谁在用，要不要同步改；③ 同类——同样的写法还有几处（用 grep 搜同模式），多处就逐处修或逐处注记。排查结论记到 findings（.taskflow/<任务id>/findings.md），修复代码要附这份清单。如果报告说的其实是「无阻塞」、或只是在讨论「阻塞」这个词本身，忽略本条。\n受影响面定位可跑 tf.mjs impact 或挂 impact-analysis 技能。';

async function bashGate(event, ctx) {
  const cmd = String(event.input?.command ?? '');
  if (!cmd) return undefined;
  const envOv = cmdEnvOverride(cmd); // 命令前缀 TF_* 赋值 = 本调用生效档（v3.6.0）
  // A 部署墙：分段判定+入口形态锚定（omp 版 v2.52.0 对抗审查语义，原样移植）
  const segs = cmd.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter(Boolean);
  const entryCall = (s) => /(^|[\/\s;&])tf\.mjs\s+deploy\b/.test(s);
  const badSeg = segs.find((s) => DEPLOY_SIG.test(s) && !entryCall(s));
  if (badSeg) {
    const mode = envOv.TF_WALL ?? process.env.TF_WALL;
    if (mode === 'off') return undefined;
    const why = '这条命令像是在绕过统一部署入口直接部署（往服务器拷文件 / 重启服务）。TASKFLOW_GUARD 部署墙（pi 适配器，判定逻辑同 omp 版）提醒：本项目所有部署必须走唯一入口「node tf.mjs deploy」（DEPLOY_ENTRY：统一部署入口）。入口会自动做三件事——部署前预检（防止把别人刚上线的版本盖掉）、检查有没有任务正在线上等验收（有就先让位不部署）、把这次部署登记进档案。绕过入口直接部署 = 档案里缺这笔账，之后跑对账检查（doctor I17：把部署记录和服务器上的实际文件逐项比对）一定亮红灯。若确属人工回滚或特殊运维：与用户确认后，在命令前加 TF_WALL=off（本适配器自解析命令前缀，v3.6.0）执行，并在 progress.md（任务进度文件）里记一行原因。';
    return mode === 'enforce' ? { block: true, reason: why } : confirmOr(ctx, why, 'TF_WALL', 'deploy-wall', ctx?.cwd); // v3.6.0 警告档→确认框
  }
  // J bash 通道（v2.69.0 自 omp 版同步）：重定向/tee/sed -i 触及任务档案且非 tf.mjs 命令 = 疑似手改 status。
  // bash 写入整文件覆盖无法做翻转前后比对；缺省 enforce；TF_STATUS=warn 走确认框（v3.6.0）；off 单次豁免。
  if (!cmd.includes('tf.mjs') && /(>|>>|\btee\s|\bsed\s+-i)[^|;&]*(task\.json|index\.json)/.test(cmd)) {
    const modeJ = envOv.TF_STATUS ?? process.env.TF_STATUS;
    if (modeJ === 'off') return undefined;
    if (locateTasksDir(ctx?.cwd)) {
      const why = 'TASKFLOW_GUARD J 状态翻转墙：bash 重定向/tee/sed 触及任务档案（task.json/index.json）——手改 status = 违规（data.md 状态机表：翻转唯一写路径 commit --deployed / accept --pass / park / unpark / archive；档案修复走 node tf.mjs reconcile --fix）。单次豁免：命令前加 TF_STATUS=off';
      return modeJ === 'warn' ? confirmOr(ctx, why, 'TF_STATUS', 'status-wall', ctx?.cwd) : { block: true, reason: why };
    }
  }
  // K 验收期 git 提醒（v3.6.0 自 omp v2.69.0 移植）：等验收任务在档时 git push/merge → 交互确认（人拍板，>omp
  // additionalContext）；非交互模式回退 tool_result 附注提醒（必达不拦）。TF_VERIFY_WARN=off 关。
  if (/\bgit (push|merge)\b/.test(cmd) && (envOv.TF_VERIFY_WARN ?? process.env.TF_VERIFY_WARN) !== 'off') {
    const dirK = locateTasksDir(ctx?.cwd);
    const vt = dirK ? (readJsonSafe(path.join(dirK, 'index.json'))?.tasks ?? []).filter((t) => t?.status === 'verifying').map((t) => t.id) : [];
    if (vt.length) {
      const whyK = `TASKFLOW_GUARD 验收期提醒：任务 ${vt.join('、')} 正在等验收——push/merge 前先核对 conventions.md 合并时序（默认先合并后部署验收；验收先行项目 verifying 悬置更长属正常）。确无涉任务或已核对时序：直接确认放行。`;
      try {
        const ok = await ctx?.ui?.confirm?.('TASKFLOW_GUARD 验收期提醒（可能猜错）', `${whyK}\n\n「确认」= 放行本次 git 操作；「取消」= 拦下先核对时序。TF_VERIFY_WARN=off 可关闭本提醒。`);
        if (ok === true) { guardLog(ctx?.cwd, 'verify-remind', 'allow', `任务 ${vt.join('、')} 等验收，用户确认放行 git 操作`); return undefined; }
        if (ok === false) return { block: true, reason: `${whyK}\n（确认框选了「取消」= 本次 git 操作已拦下。核对合并时序后重跑，或 TF_VERIFY_WARN=off 关闭本提醒。）` };
      } catch { /* 非交互模式 → 回退 tool_result 附注 */ }
      guardLog(ctx?.cwd, 'verify-remind', 'inject', `任务 ${vt.join('、')} 等验收，git push/merge 时序提醒（tool_result 附注送达）`);
      armNote(event.toolCallId, `⚠ TASKFLOW_GUARD 验收期提醒：${whyK}\n（TF_VERIFY_WARN=off 关闭本提醒。）`);
      return undefined;
    }
  }
  if (cmd.includes('tf.mjs')) {
    // B1 --files 空格分隔 = 调用即红（无警告档，双宿主一致）
    if (spaceSeparatedFiles(cmd)) {
      return { block: true, reason: '命令已拦下，格式错了：tf.mjs commit --files 的多个文件要用逗号分隔（正确写法：--files a.md,b.md），用空格分隔时只有第一个文件会被登记进档案（历史上多次踩过这个坑）。把空格改成逗号后重试。' };
    }
    // B2 deploy 缺 --web-only 提醒（v3.6.0 移植；不拦：jar-only 部署合法；项目有 webCommands 时才提醒）——
    // pi 通道=tool_result 附注（omp additionalContext 同位；附注在执行后送达=时机差异，见头差异 2）
    if (entryCall(cmd) && !cmd.includes('--web-only') && !cmd.includes('--dry-run')) {
      const dir = locateTasksDir(ctx?.cwd);
      const web = dir ? readJsonSafe(path.join(dir, 'project.json'))?.deploy?.webCommands : null;
      if (Array.isArray(web) && web.length) {
        armNote(event.toolCallId, '⚠ 提醒（不拦执行）：tf.mjs deploy 默认只更新后端程序包（jar：服务器上运行的程序文件）；本项目还配置了前端更新命令（webCommands），这次部署不会带上前端——需要再跑一次 node tf.mjs deploy --web-only 单独更新前端，并核对服务器上的前端文件确实是新版本（历史事故：后端更新了、前端没跟上）。');
      }
    }
  }
  return undefined;
}

// ---- G：编辑边界门（声明清单收集，1:1 移植）----
function extractSectionBody(md, nameRe) {
  // 从 '## <名>' 节取正文到下一个 '## '（'###' 子节留在正文内）；节不存在返回 ''
  const lines = md.split('\n');
  let inSec = false;
  const body = [];
  for (const ln of lines) {
    if (/^##\s/.test(ln)) {
      if (inSec) break;
      inSec = nameRe.test(ln.replace(/^##\s+/, '')); // 节名测试剥掉 '## ' 前缀（锚定 ^ 的节名正则才对得上）
      continue;
    }
    if (inSec) body.push(ln);
  }
  return body.join('\n');
}

// v2.55.2 花括号展开：spec 清单常写 `docs/prd/{a,b,c}/functional.md` 缩写——不展开=清单内文件全误报（21 次误报实证）
const expandBraces = (p) => {
  const m = p.match(/^(.*?)\{([^{}]*)\}(.*)$/s);
  if (!m) return [p];
  return m[2].split(',').flatMap((alt) => expandBraces(m[1] + alt.trim() + m[3]));
};

function collectDeclaredFiles(taskDir) {
  const out = new Set();
  const addFromSection = (md, secRe) => {
    for (const lnRaw of extractSectionBody(md, secRe).split('\n')) {
      if (/明确不做|禁止|不含|不涉及|负面/.test(lnRaw)) continue; // 负面清单行排除（入清单=放行禁改文件）
      for (const ln of expandBraces(lnRaw)) {
        const m = ln.match(/^\s*[-*]\s+`?([^\s`（(，,：:]+)/);
        if (m) {
          const p = m[1].replace(/^\.\//, '').replace(/\/+$/, '');
          // bold 标签（**xxx**）= 模板小节标签非路径（v2.49.1 活体实证）
          if (p && !p.startsWith('<') && !/^\*\*.*\*\*$/.test(p)) out.add(p);
        }
        // 冒号后反引号路径（治截断）——仅声明语义行收集，禁止/负面清单行不入清单
        if (/改动文件|涉及文件|正向清单|文件集合|声明/.test(ln)) {
          for (const q of ln.matchAll(/`([^`\s]+)`/g)) {
            const p = q[1].replace(/^\.\//, '').replace(/\/+$/, '');
            if (p.includes('/') || /\.[A-Za-z0-9]+$/.test(p)) out.add(p);
          }
        }
      }
    }
  };
  const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const specMd = readSafe(path.join(taskDir, 'spec.md'));
  if (specMd) {
    addFromSection(specMd, /^边界与影响面(\s|$|（)/);
    addFromSection(specMd, /^涉及文件(\s|$|（)/);
  }
  const subRoot = path.join(taskDir, 'subtasks');
  let subs = [];
  try { subs = fs.readdirSync(subRoot, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { /* 无子任务 */ }
  for (const d of subs) addFromSection(readSafe(path.join(subRoot, d.name, 'spec.md')), /^涉及文件(\s|$|（)/);
  return [...out];
}

async function editGate(event, ctx) {
  const raw = event.input?.path;
  if (!raw || typeof raw !== 'string') return undefined;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(raw)) return undefined; // 协议地址过滤（agent:// 等非文件系统路径；≥2 字符不误伤 Windows 单字母盘符）
  const rawN = (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) ? path.join(os.homedir(), raw.slice(1)) : raw; // 波浪号展开：与编辑工具展开时机对齐（v2.54.1 实证）
  const cwd = ctx?.cwd;
  const dir = locateTasksDir(cwd);
  if (!dir) return undefined; // 零干扰边界
  const mainRoot = realPath(path.dirname(dir));
  const abs = realPath(path.resolve(cwd ?? process.cwd(), rawN)); // realpath 失败（新文件不存在）保 resolve 原值
  // J 状态翻转墙（v2.69.0 自 omp 版同步）：先于 G 边界门——G 的簿记白名单会放行 .taskflow 内编辑，status 手改必须先在这里拦
  const bname = path.basename(abs);
  if ((bname === 'task.json' || bname === 'index.json') && abs.startsWith(dir + path.sep)) {
    const whyJ = judgeStatusFlip(abs, event);
    if (whyJ) {
      const modeJ = process.env.TF_STATUS;
      if (modeJ === 'off') return undefined; // off=单次豁免
      if (modeJ === 'warn') return confirmOr(ctx, whyJ, 'TF_STATUS', 'status-wall', cwd); // v3.6.0 警告档→确认框
      return { block: true, reason: whyJ }; // 缺省/enforce=硬拦
    }
  }
  const idx = readJsonSafe(path.join(dir, 'index.json'))?.tasks ?? [];
  const live = idx.filter((t) => t?.status === 'active' || t?.status === 'verifying');
  if (!live.length) return undefined;
  // 归属判定：worktree 前缀（含兄弟子任务 worktree 命名 <task-worktree>-<n>-<slug>）；主仓库内编辑且仅一个活任务 → 归它
  let owner = null; let base = null;
  for (const t of live) {
    // 幽灵 worktree 防御（v2.61.1 F-01）：空/缺失跳过，绝不让空串进 realPath
    const rawW = typeof t.worktree === 'string' && t.worktree ? t.worktree : readJsonSafe(path.join(dir, t.id, 'task.json'))?.worktree;
    if (typeof rawW !== 'string' || !rawW) continue;
    const w = realPath(rawW); // 双向路径归一（realPath 失败保原值=worktree 已删场景）
    if (abs === w || abs.startsWith(w + path.sep)) { owner = t; base = w; break; }
    // 兄弟子任务 worktree：base 取子 worktree 根；数字段收紧防 `-backup` 类同名误归因（审查 blocker 1）
    const sib = abs.startsWith(w + '-') ? abs.slice(w.length + 1) : '';
    if (sib && /^\d+-/.test(sib)) {
      const cut = abs.indexOf(path.sep, w.length + 1);
      owner = t; base = cut === -1 ? abs : abs.slice(0, cut);
      break;
    }
  }
  if (!owner) {
    if (abs !== mainRoot && !abs.startsWith(mainRoot + path.sep)) return undefined; // 主仓库与任何 worktree 之外 → 零干扰
    // 多活任务 × 主仓库编辑：并集比对（v2.49.1 活体实证修订——归属不明放行会让主路径永久静默）
    const union = new Set();
    for (const t of live) for (const p of collectDeclaredFiles(path.join(dir, t.id))) union.add(p);
    if (!union.size) return undefined; // 全部活任务都无清单 → 零干扰
    const relU = path.relative(mainRoot, abs);
    if (!relU || relU.startsWith('..')) return undefined;
    if (relU === '.taskflow' || relU.startsWith('.taskflow/') || relU.startsWith('.omp/') || relU.startsWith('.pi/') || path.basename(relU) === '.owner.json') return undefined; // 簿记白名单（.pi/=pi 宿主簿记目录）
    if ([...union].some((d) => relU === d || relU.startsWith(d.endsWith('/') ? d : d + '/'))) return undefined;
    const whyU = `TASKFLOW_GUARD G 编辑边界门（自动检查脚本的编辑范围检查）警告：${relU} 不在任何进行中任务（${live.map((t) => t.id).join('、')}）声明的改动清单里（各任务清单 = 任务说明书 spec 的「边界与影响面」+ 各子任务「涉及文件」的合计）。主仓库检出区应保持干净、只作合并落点——任务都在各自的 worktree（独立工作副本）里改代码。请先确定这个文件归属哪个任务：到对应 worktree 里开工，或把路径加进该任务 spec 清单并跑 node tf.mjs req-confirm（范围变更登记命令）留痕。确属例外情况：警告档由用户在确认框放行；硬性豁免由用户在启动 pi 的环境设 TF_BOUND=off（会话级，v3.6.0 口径）执行，并在 progress.md（任务进度文件）里记一行原因。`;
    const modeU = process.env.TF_BOUND;
    if (modeU === 'off') return undefined;
    return modeU === 'enforce' ? { block: true, reason: whyU } : confirmOr(ctx, whyU, 'TF_BOUND', 'boundary', cwd); // v3.6.0 警告档→确认框
  }
  const rel = path.relative(base, abs);
  if (!rel || rel.startsWith('..')) return undefined;
  if (rel === '.taskflow' || rel.startsWith('.taskflow/') || rel.startsWith('.omp/') || rel.startsWith('.pi/') || path.basename(rel) === '.owner.json') return undefined; // 簿记白名单
  const declared = collectDeclaredFiles(path.join(dir, owner.id));
  if (!declared.length) return undefined; // 无清单可对照（未落 spec 的旧任务）→ 零干扰
  const hit = declared.some((d) => rel === d || rel.startsWith(d.endsWith('/') ? d : d + '/'));
  if (hit) return undefined;
  const why = `TASKFLOW_GUARD G 编辑边界门（自动检查脚本的编辑范围检查）警告：${rel} 不在任务 ${owner.id} 开工时声明的改动清单里（清单 = 任务说明书 spec 的「边界与影响面」一节 + 各子任务「涉及文件」的合计）——这条纪律是为了让一个任务只做一件事、出问题好回滚。确实需要改这个文件：先把它的路径加进 spec 对应清单，再跑 node tf.mjs req-confirm（范围变更登记命令）登记这次范围变更，然后继续。确属例外情况：警告档由用户在确认框放行；硬性豁免由用户在启动 pi 的环境设 TF_BOUND=off（会话级，v3.6.0 口径）执行，并在 progress.md（任务进度文件）里记一行原因。`;
  const mode = process.env.TF_BOUND;
  if (mode === 'off') return undefined;
  return mode === 'enforce' ? { block: true, reason: why } : confirmOr(ctx, why, 'TF_BOUND', 'boundary', cwd); // v3.6.0 警告档→确认框
}

// ---- 映射注入 + C 接力（omp 版无对应件；pi 技能可读性层，不受采纳闸控）----
const MAPPING_TEXT = [
    '[taskflow 宿主映射表（pi 适配器注入，marker: ' + MAPPING_MARKER + '）]',
    '本会话可用 taskflow 技能。技能文件按 omp 宿主撰写，遇到以下字样按本表翻译成 pi 等价物：',
    '- 「omp Todo」「init 成 omp Todo」「挂 Todo」→ 用 pi 的 todo 工具（rpiv-todo）登记；todo 工具不可用就逐项写进任务 progress.md。Todo 勾选永远不是状态写入口，账本以 tf.mjs 为准',
    '- 「用 subagent 能力（实现用 general、调研用 explore）」→ 用 pi-subagents 扩展的 subagent 工具；不可用就在本会话顺序自做并在进度里注明，禁止发明不存在的工具调用',
    '- 「会话开头 @taskflow」→ 直接说「用 taskflow …」即可（pi 按技能描述自动触发，无需 @ 语法）',
    '- 「宿主提醒 TASKFLOW_GUARD」→ 本机装了 pi 适配器时 B/A/G 拦截与 D 状态栏照常生效；未装适配器的项目按 references 流程门与 validate-* 脚本自觉执行',
    '- tf.mjs 写命令（commit/takeover/lock）的 --session <会话ID> → 传环境变量 PI_SESSION_ID 的值（pi 的会话标识）',
].join('\n');

function handoffText(tasksDir) {
  const live = (readJsonSafe(path.join(tasksDir, 'index.json'))?.tasks ?? [])
    .filter((t) => t?.status === 'active' || t?.status === 'verifying');
  if (!live.length) return null;
  return [
    '[taskflow 接力线索（TASKFLOW_GUARD C，压缩后重注入）]',
    ...live.slice(0, 5).map((t) => `- 任务 ${t.id}（${t.status}）：${t.title ?? ''}｜分支 ${t.branch ?? '?'}`),
    '恢复入口：直接 node tf.mjs ls；下一步与未决风险以各任务 handoff.md 为准（摘要不准替代档案）',
  ].join('\n');
}

// ---- H 领域提示门（v3.5.0 自 omp 版 v3.3.0 移植）----
const EXT_DOMAIN = { '.tsx': '前端UI', '.jsx': '前端UI', '.vue': '前端UI', '.svelte': '前端UI', '.css': '前端UI', '.scss': '前端UI', '.html': '前端UI', '.java': 'Java', '.kt': 'Kotlin', '.py': 'Python', '.js': 'Node', '.ts': 'Node', '.mjs': 'Node' };
const isTestFile = (b) => /Test\.java$/.test(b) || /Tests?\.kt$/.test(b) || /(^|[._-])(test|spec)([._-]|$)/i.test(b);
const SKILL_ROOT = (() => { try { return fs.realpathSync(path.join(os.homedir(), '.pi', 'agent', 'skills', 'taskflow')); } catch { return null; } })();
const SKILL_CLI = SKILL_ROOT ? path.join(SKILL_ROOT, 'scripts', 'tf.mjs') : '';
function domainSkills() { // 运行时读注册表（pi 适配器无渲染期占位，单源=skills-registry.json；读失败降级空映射）
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT ?? '', 'scripts', 'skills-registry.json'), 'utf8'));
    const map = {};
    for (const s of Array.isArray(reg?.skills) ? reg.skills : []) for (const d of Array.isArray(s?.domains) ? s.domains : []) (map[d] = map[d] ?? []).push(s.id);
    return map;
  } catch { return {}; }
}
function guardLog(cwd, gate, action, detail) { // 与 omp 版同格式（hint-stats 解析契约）
  try {
    if (process.env.TF_GUARD_LOG === 'off') return;
    const dir = locateTasksDir(cwd ?? process.cwd());
    if (!dir) return;
    fs.appendFileSync(path.join(dir, '.guard-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), gate, action, detail: String(detail ?? '') }) + '\n');
  } catch { /* 日志失败静默 */ }
}
function hintSeen(dir, ses, d) { try { return !!(JSON.parse(fs.readFileSync(path.join(dir, '.hint-state.json'), 'utf8'))?.sessions?.[ses]?.domains?.[d]); } catch { return false; } }
function hintMark(dir, ses, d) {
  try {
    const hp = path.join(dir, '.hint-state.json');
    const now = Date.now();
    let st = {};
    try { st = JSON.parse(fs.readFileSync(hp, 'utf8')); } catch { /* 首次 */ }
    st.sessions = st.sessions ?? {};
    for (const k of Object.keys(st.sessions)) if (now - (st.sessions[k]?.ts ?? 0) > 86400000) delete st.sessions[k];
    const e = st.sessions[ses] = st.sessions[ses] ?? { ts: now, domains: {} };
    e.ts = now; e.domains[d] = true;
    fs.writeFileSync(hp, JSON.stringify(st));
  } catch { /* 状态失败静默=下次可能重复注入一次 */ }
}
function sessionIdOf(ctx) {
  try { const s = ctx?.sessionManager?.getSessionId?.(); if (s) return String(s); } catch { /* 生命周期早期不可得 */ }
  return String(process.env.PI_SESSION_ID ?? 'default');
}

export default function taskflowPi(pi) {
  let armHandoff = false; // 压缩完成后置位；下一次 provider 请求附带接力线索（一次性消费）

  // H 检测面（tool_call edit/write 调用；不拦不返——与硬门分界，入队后由 tool_result 送达）
  const hintDetect = (event, ctx) => {
    try {
      if (process.env.TF_HINT === 'off') return;
      const raw = event.input?.path;
      if (!raw || typeof raw !== 'string') return;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(raw)) return; // 协议地址过滤（与编辑边界门同款）
      const dir = locateTasksDir(ctx?.cwd);
      if (!dir) return; // 零干扰边界
      const abs = realPath(path.resolve(ctx?.cwd ?? process.cwd(), raw));
      const base = path.basename(abs);
      let domain = null;
      if (isTestFile(base)) domain = '测试';
      else for (const [ext, d] of Object.entries(EXT_DOMAIN)) if (base.endsWith(ext)) { domain = d; break; }
      if (!domain) return;
      const ses = sessionIdOf(ctx);
      if (hintSeen(dir, ses, domain)) return;
      hintMark(dir, ses, domain);
      let presence = '';
      if (SKILL_CLI && fs.existsSync(SKILL_CLI)) {
        try { presence = execFileSync('node', [SKILL_CLI, 'skills', domain], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim().split('\n').slice(-3).join('｜'); } catch { /* 在场检测失败降级=只给映射清单 */ }
      }
      const ids = (domainSkills()[domain] ?? []).join('、') || '（注册表未登记——跑 node <技能仓>/scripts/tf.mjs skills <领域词> 按需补）';
      armNote(event.toolCallId, `ℹ TASKFLOW_GUARD 领域提示门（每会话每领域一次）：刚写入的 ${base} 命中「${domain}」领域硬信号——映射技能：${ids}${presence ? `\n在场检测（tf.mjs skills ${domain}）：${presence}` : ''}\n语义确认归你按 domain.md 领域检测执行（本提醒=机械粗筛非判定，缺失技能按 DEP_ASK_GATE 呈用户选装）；TF_HINT=off 关闭本提醒。`, 'domain-hint');
    } catch { /* 提醒失败静默——hook fail-open，绝不拦主流程 */ }
  };

  pi.on('session_start', async (_e, ctx) => {
    if (guardOn(ctx?.cwd)) refreshStatus(ctx);
  });

  // C 接力：压缩完成置位 → 下一次 provider 请求把活任务线索附进注入块（一次性消费）；
  // I 压缩兜底（v3.6.0）：有未沉淀「看不懂」反馈时附一行（omp session.compacting 通道的 pi 同位）
  pi.on('session_compact', async (_e, ctx) => {
    armHandoff = true;
    compactionExtras = feedback.pending > 0
      ? [`[taskflow 词表反馈兜底（压缩前未清）] 还有 ${feedback.pending} 处「看不懂」类反馈待沉淀——压缩会丢反馈上下文，继续前先把涉事术语的大白话改写/补录进 .taskflow/glossary.md（词表活读下一轮生效）。`]
      : [];
    if (guardOn(ctx?.cwd)) refreshStatus(ctx);
  });

  pi.on('turn_end', async (_e, ctx) => {
    pendingNotes = []; // 未送达即弃（写入/命令被阻断等残附注不跨回合误投）——送达在 tool_result
    if (guardOn(ctx?.cwd)) refreshStatus(ctx);
  });

  // 附注送达（v3.6.0 队列化）：pendingNotes 按 callId 出队 + class-sweep（子代理工具结果命中阻塞特征）——
  // 附加到该次调用的 tool_result content 末尾（同位注入；callId 精确关联防误投他人结果）
  pi.on('tool_result', async (event, ctx) => {
    try {
      const deliver = pendingNotes.filter((n) => n.callId === event.toolCallId);
      if (deliver.length) pendingNotes = pendingNotes.filter((n) => n.callId !== event.toolCallId);
      let sweep = false;
      if (SUBAGENT_TOOLS.has(event.toolName)) {
        const text = Array.isArray(event.content) ? event.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join(' ') : (typeof event.content === 'string' ? event.content : '');
        if (text && BLOCKER_RE.test(text) && !text.includes('TASKFLOW_GUARD 同类排查提醒：')) {
          sweep = true;
          guardLog(ctx?.cwd, 'class-sweep', 'inject', '子代理报告命中阻塞特征，同类排查三问提醒随 tool_result 附注');
        }
      }
      if (!deliver.length && !sweep) return undefined;
      const texts = [...deliver.map((n) => n.text), ...(sweep ? [CLASS_SWEEP_TEXT] : [])];
      if (!Array.isArray(event.content)) return undefined; // 非数组 content 形态不识别 → 弃（宁缺勿错投）
      for (const t of texts) event.content.push({ type: 'text', text: t });
      const dh = deliver.find((n) => n.kind === 'domain-hint');
      if (dh) guardLog(ctx?.cwd, 'domain-hint', 'inject', `${(dh.text.match(/刚写入的 (\S+) 命中「([^」]+)」/) ?? [])[2] ?? '?'}（${(dh.text.match(/刚写入的 (\S+)/) ?? [])[1] ?? '?'} 写入触发）｜ses=${sessionIdOf(ctx)}`);
      return { content: event.content };
    } catch { return undefined; } // 送达失败静默——宁缺勿错投
  });

  // 映射注入走 provider 层（before_provider_request 前置进 messages 首条 system）：print 模式实测 context 事件
  // 的 messages 变更不生效（handler 触发、返回值被忽略，2026-10-15 e2e）；且 pi 的 provider payload 没有
  // payload.system 字段（OpenAI 风格，system 在 messages[0]，e2e 日志实证）——注入点=messages[0].content 前缀。
  // MAPPING_TEXT 静态 → 每请求 byte-identical，prompt cache 不破；handoff 只在压缩后附加一次（允许破一次缓存）。
  // v3.6.0 追加：E 输出规范+词表+实况行（随词表/实况变化破缓存，omp v2.56.0 同款接受）+ I 反馈检测/逐轮指令 +
  // I 压缩兜底行消费。
  pi.on('before_provider_request', async (event, ctx) => {
    const dir = locateTasksDir(ctx?.cwd);
    if (!dir) return undefined; // 零干扰边界：非 taskflow 项目不注入
    let inject = MAPPING_TEXT;
    if (armHandoff) {
      const handoff = handoffText(dir);
      if (handoff) inject += `\n\n${handoff}`;
      armHandoff = false; // 一次性消费（无活任务时保留武装，建档后下一请求补上）
    }
    for (const x of compactionExtras) inject += `\n\n${x}`; // I 压缩兜底（一次性消费）
    compactionExtras = [];
    detectFeedback(event?.payload?.messages, ctx); // I 检测：只计数（提醒在 E 块逐轮注入）
    inject += `\n\n${buildSpecInject(dir)}`; // E 输出规范+词表活读+实况行+I 逐轮指令
    // （H 提示门不在此注入：pi 1.5.1 真机实证 bpr 的 system 追加只在首个 provider 请求可达，续请求追加丢失——
    //   通道改走 tool_result，见文件头。）
    const p = event.payload;
    const msgs = Array.isArray(p?.messages) ? p.messages : null;
    if (!msgs) return undefined;
    const m0 = msgs[0];
    if (m0?.role === 'system') {
      if (typeof m0.content === 'string') m0.content = `${inject}\n\n${m0.content}`;
      else if (Array.isArray(m0.content)) m0.content = [{ type: 'text', text: inject }, ...m0.content];
      // 其余 content 形态不识别 → 不动（零干扰）
    } else {
      msgs.unshift({ role: 'system', content: inject }); // 无 system 首条 → 前插一条
    }
    return p; // 原地变更+返回 payload（handlers chain；omp 版 E 通道同式）
  });

  // T 埋点（不受采纳闸控）+ B1/A/J/K（bash）+ F（Agent）+ G/J/I清零（edit/write）共用 tool_call 挂点，按 toolName 分流
  pi.on('tool_call', async (event, ctx) => {
    trackSkillRead(event, ctx); // T 技能埋点（v3.6.0）：全局计数，整体吞错，绝不拦
    if (!guardOn(ctx?.cwd)) return undefined; // 采纳闸：未登记项目全静默（含本适配器的 B/A/G/D/H/F/K/I）
    // I 词表反馈清零（v3.6.0）：词表改写落盘即清（omp 版 tool_call 通道同款）
    if ((event.toolName === 'edit' || event.toolName === 'write') && feedback.pending > 0) {
      const gp = String(event.input?.path ?? '');
      if (gp.includes('.taskflow') && gp.endsWith('glossary.md')) { feedback.pending = 0; feedback.seen.clear(); }
    }
    if (event.toolName === 'bash') return await bashGate(event, ctx);
    if (event.toolName === 'Agent') return dispatchGate(event, ctx); // F 派发门（v3.6.0）
    if (event.toolName === 'edit' || event.toolName === 'write') {
      const g = await editGate(event, ctx);
      if (g) return g;
      hintDetect(event, ctx); // H 领域提示门：入队随 tool_result 送达（永不拦不返——与硬门分界）
      return undefined;
    }
    return undefined;
  });
}
