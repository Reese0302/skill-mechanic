---
name: skill-mechanic
description: |
  检查并优化 claude skill 的 SKILL.md 文件，基于 9 类维度自动排查并生成三段式报告。
  ALWAYS use when: 用户说"检查skill"、"优化skill"、"skill质量分析"、"skill体检"
  Do NOT use when: 用户只是阅读/使用某个skill；目标没有SKILL.md
  Output format: 三段式报告（已自动修复 / 需要你决策的 / 建议补充的）
triggers:
  - 排查skill
  - 检查skill
  - skill体检
  - review skill
  - 帮我看看skill
  - skill mechanic
---

本 skill 用于检查并优化其他 skill 的 SKILL.md 文件。
输入：skill 目录路径（默认当前目录）
输出：三段式报告（已自动修复 / 需要你决策的 / 建议补充的）
依赖：被检查 skill 必须有 SKILL.md；大型 skill 需先加载 MISTAKES.md；依赖 resources/skill-md-lint/（机械层脚本，不可用时退化为全量排查）
失败：SKILL.md 不存在 → 报告错误并停止；误报/漏报 → 记录到 MISTAKES.md 并修正规则

🛑 STOP：修改 SKILL.md 前，必须先展示修改方案并获得确认
🛑 STOP：auto-fix 预算用尽时，必须停止修改并报告剩余问题

## 模型分层策略

**硬约束**：复杂任务用 Opus，其余用 Sonnet，不用 Haiku。

| 层 | 模型 | 理由 |
|---|---|---|
| 机械层 | Node.js 脚本（0 token） | 确定性检查，不涉及 LLM |
| 混合层 | Sonnet | 结构化二元判定（hit true/false），输入已压缩，与 Opus 差距 < 2% |
| 判断层 | Opus（Pass 1 审稿人 / Pass 2 四态裁决 / Final） | 唯一需要跨段语义推理 + self-consistency 多视角博弈的层；四态输出（keep/soften/escalate/drop）替代旧二态 |
| 验证器 | Sonnet | 输入 ~1k、决策空间 3 项（keep/revise/drop），上游已过 Opus 过滤 |

**混合层 fallback 规则**：

混合层 Sonnet 输出后，按以下 rubric 校验，不通过则用 Opus 版重跑该组：
- evidence.quote 必须在原文片段中精确匹配
- lineno 必须与 quote 所在行一致
- 同一条件在多组 prompt 中结论必须一致

触发上限：每次执行最多 fallback 1 组，超过则该组标记为 `uncertain` 透传到判断层。

**判断层 self-consistency 不可拆模型**：Pass 1 和 Pass 2 必须同为 Opus。非对称模型会破坏对抗平衡。

---

## DO NOT

- NEVER 修改用户未提及的文件
- NEVER 在修复时超过预算（≤5 处）而不报告溢出
- NEVER 在排查期间读取 SKILL.md 超过 2 次（MUST 一次性提取关键信息）
- NEVER 在报告中使用"建议""可以考虑"（MUST 给出明确结论：修复/跳过/需决策）
- NEVER 跳过验证器直接输出 findings

---

## 一、分类规则

先判断目标 skill 类型，再决定排查范围。

| 类型 | 判断条件 | 排查类别 |
|------|---------|---------|
| 小而美 | 只有 SKILL.md 一个文件，**且**不满足下方「升格条件」 | A、B、C |
| 大型 | SKILL.md + 其他文件（resources/、子模块等） | A-I, R 全部 |
| 升格为大型 | 只有 SKILL.md，但满足任一条件：① SKILL.md 超过 200 行；② 引用其他 skill ≥ 3 处 | A-I, R 全部 |

「引用」计数规则：在 SKILL.md 正文中（不含代码块、不含 frontmatter）提到其他 skill 的目录名或名称，每次计 1 处。自引用不计入。

**外部依赖定义：** 一个 skill 目录内的文件 = 无外部依赖。MCP 调用不算外部依赖。

---

## 二、执行流程

### 步骤 0：输入路由

用户触发 skill-mechanic 后，根据输入确定目标路径：

- if 用户说「排查skill X」（带具体名称）→ 先项目 `.claude/skills/` 再全局 `~/.claude/skills/`，查找名为 X 的目录（大小写不敏感）
  - 找到 → 继续步骤 1
  - 未找到 → 报告「未找到 skill：X，已搜索项目和全局 .claude/skills/」，终止
🔴 CHECKPOINT：用户确认目标 skill 后才能继续步骤 1。
- if 用户说「排查」但没指定名称 → 先从当前对话上下文中提取已出现过的 skill 名称（匹配项目和全局 `.claude/skills/` 下的目录名，大小写不敏感）
  - 找到 1 个 → 直接作为目标，继续步骤 1
  - 找到多个 → 列出这些 skill，让用户选择
  - 上下文中无任何 skill 出现 → 询问用户「要排查哪个 skill？」，等用户回答后继续步骤 1
  - 用户不回答 → 终止
  - 用户回答的不是 skill 名称（如"我不知道"、问句等）→ 再次询问，最多 2 次，仍无法识别 → 终止
  - 用户回答多个名称 → 列出让用户选择
- if 用户给了绝对路径（如 `C:\Users\lenovo\.claude\skills\xxx`）→ 直接用该路径
  - 继续步骤 1

### 步骤 1：定位目标 skill

读取目标 skill 目录。

- if 目标路径不存在 → 报告「目标 skill 不存在：{路径}」，终止
- if 目录存在但为空 → 报告「目录为空：{路径}」，终止
- if 目录存在但无 SKILL.md → 报告「未找到 SKILL.md」，终止
- else → 继续

### 步骤 2：判断 skill 类型

- if 只有 SKILL.md → 小而美，执行步骤 3-5（仅 ABC 类别）
- if 只有 SKILL.md，但行数 > 200 或引用其他 skill ≥ 3 处 → 升格为大型，执行步骤 3-7（全部类别）
- if 有 SKILL.md + 其他文件 → 大型，执行步骤 3-7（全部类别）

### 步骤 3：读取 SKILL.md + 机械层

读取 SKILL.md 全文。

调用 resources/skill-md-lint：
```
node resources/skill-md-lint/lint.mjs {SKILL.md 路径}
```

if 脚本执行失败 → 退化为原有流程（主 agent 全量排查），报告标注「skill-md-lint 不可用」
if 成功 → 继续

记录：
- mechanical_findings = lint 输出的 findings 数组
- suspect_ranges = lint 输出的嫌疑区段
- skill_metrics = lint 输出的 metrics

### 步骤 3.5：读取历史教训 + 跳过记录过滤

读取目标 skill 目录下的 MISTAKES.md（如有），执行两个任务：教训归类 + 跳过记录提取。

if 目标 skill 目录下存在 MISTAKES.md：
  → 读取每条记录
  → **教训归类**：将每条记录的「下次规则」归入最匹配的排查类别（A-I, R），作为该类别的额外 if-then 检查项
  → 如果某条规则不匹配任何已有类别，跳过并注明
  → 优先级：SKILL.md 明确指令 > 下次规则 > 通用排查规则
  → **跳过记录提取**：识别所有「下次规则」段落中含 `decision: skip` 标记的条目
    - 从每条 skip 记录中提取：`condition_id`（如有）、`quote`（如有）、`timestamp`（从标题日期提取）
    - 保存为 `skip_records` 数组，供步骤 5 过滤使用
  → 在报告中注明「本次排查受 {N} 条历史教训约束」
  → if skip_records 非空 → 在报告中注明「本次跳过 {K} 条用户不修复项」
if 不存在：
  → 跳过，不影响排查
  → skip_records 为空数组

**跳过记录匹配算法**（在步骤 5 findings 合并后执行）：

调用 `node resources/skip-record.mjs filter --findings <findings-json路径或stdin> --skip-records <skip-records-json路径或stdin>`。

脚本按双向子串匹配算法过滤，输出 filtered_findings / removed / invalid_skips。

**skip 记录有效性**：condition_id 和 quote 都缺失的 skip 记录不参与过滤，在报告中标注「MISTAKES.md 有无效 skip 记录（缺少 condition_id 和 quote），未参与过滤」。

### 步骤 4a-0：机械校验（V0，脚本）

在混合层调用前，用确定性脚本过滤形式错误的 findings。

调用 `resources/mechanical-validator.mjs`：
```
node resources/mechanical-validator.mjs <目标SKILL.md路径> <findings-json路径>
```

脚本检查：
- `evidence.quote` 是否在 SKILL.md 第 `evidence.lineno` 行存在（子串匹配）
- `condition_id`、`severity`、`confidence` 字段是否完整
- `severity` 是否在允许枚举中（high/medium/low）
- `confidence` 是否在 0-1 范围内
- 同一 quote + 同一 condition_id 是否重复

脚本输出：
- `valid_findings`：通过机械校验的 findings，继续进入后续流程
- `invalid_findings`：形式错误的 findings，直接写入 verifier-log.md，不进入后续流程
- `stats`：校验统计

脚本输出：

### 步骤 4a：混合层（Sonnet）

将 11 项混合层条件分为 2 组，每组一个结构化 prompt：

**分组方案：**

| 组 | 条件 | 输入 |
|---|------|------|
| boundary-wording | B「未覆盖边界」分支 / B「模糊措辞」分支 / B.7 序列结构 / B.8 动作指令 / C「缺失败分支」分支 / C「加约束」分支 / C「改措辞」分支 | 嫌疑区段对应的原文片段 + 前后文 |
| spec-interaction | E「歧义」分支 / E.7 存在性 / E.7 格式 / E.7 触发机制 / E.7 回流机制 / E.13 内容密度 / I「未校验输入」分支 / I「需交互步骤」分支 | 嫌疑区段 + 机械层 metrics |

**每组 prompt 结构：**

```
你是 skill 质量检查员。只检查以下条件：{条件列表}

规则：
{每个条件的 if-then 判定规则}

输入片段：
{从 SKILL.md 中提取的候选片段，每个片段带行号}

对每个条件，输出：
{"condition_id": "B-模糊措辞", "hit": true/false, "evidence": {"lineno": 47, "quote": "should generally try to avoid"}, "reason": "一句话"}

如果无法确定，hit=false。
如果无法提供 lineno 和 verbatim quote，hit=false。
```

**候选片段提取规则**：

对每个嫌疑区段 `[start, end]`，提取扩展片段：取 `[max(1, start-3), min(line_count, end+3)]`，即前后各扩展 3 行上下文。每个片段附带行号前缀。

如果嫌疑区段落在代码块（` ``` `）内，该片段标注 `in_code_block: true`，供 LLM 判断是否跳过。

**后置校验**：对每个 hit=true 的 finding，脚本验证 SKILL.md 第 lineno 行是否包含 quote 子串。不通过 → 直接 drop（不送验证器）。

**步骤 4a 边界情况**：
- if 嫌疑区段全部落在代码块内 → 该区段标注 `in_code_block: true`，LLM 跳过自然语言检查
- if SKILL.md 全文 < 50 行且嫌疑区段为空 → 混合层改为全文输入
- if 某组 prompt 的所有条件均 hit=false → 无 finding，视为该组无问题

### 步骤 4b：判断层（Opus，self-consistency）

**输入**：skill_map（1-3k token）：

```
Skill Map:
- Name: {name}
- Purpose: {前 200 字}
- Main workflow: {步骤编号列表 + 每步一句话摘要}
- Inputs/Outputs: {摘录}
- Failure handling: {摘录}
- Constraints: {摘录}
- Referenced skills: {列表}
- High-risk spans: {机械层标注的嫌疑区段}
```

**self-consistency 实现**：

**Pass 1 prompt 模板**（审稿人）：
```
你是一个挑剔的审稿人。你的职责是找出 skill 规格中的质量问题。

检查以下条件（引用原 SKILL.md 编号）：
- A.1 核心指令歧义：指令有 ≥ 2 种合理解读
- A.2 指令被淹没：关键指令混在大段叙述中
- F「简单问题用复杂架构」分支
- F「复杂问题缺结构支撑」分支
- G「职责重叠」分支
- G「循环依赖」分支
- E「歧义」分支（跨段冲突：两段内容互相矛盾）

Skill Map：
{此处插入 skill_map}

对每个发现的问题，输出 JSON：
{"finding_id": "F1", "condition_id": "A.1", "lineno": 45, "quote": "原文摘录", "reason": "一句话说明问题"}

如果未发现任何问题，输出空数组：[]
每条 finding 必须有 lineno 和 verbatim quote，否则不输出。
```

**Pass 2 prompt 模板**（作者辩护 + 四态裁决）：
```
你是该 skill 的作者。审稿人提出了以下 findings，请逐条反驳并裁决。

Findings：
{此处插入 Pass 1 的 findings JSON}

对每条 finding，输出：
{
  "finding_id": "F1",
  "rebuttal": "你的反驳理由",
  "decision": "keep|soften|escalate|drop",
  "soften_to": "decision=soften 时填写降级后的 severity 和范围；否则为空",
  "drop_evidence": "decision=drop 时填写反证 quote；否则为空"
}

裁决规则：
1. keep：审稿人的批评成立，你无法反驳。
2. soften：问题方向成立，但标题、严重度、范围、原因或修复建议需要收窄。
3. escalate：问题成立，且应升级 severity。
4. drop：仅在以下情况允许：
   - 原文上下文明确反驳该 finding；
   - finding 的 quote 无法支持其核心结论；
   - finding 完全依赖猜测，无法通过 soften 修正。
5. 不确定时，不得 drop；应选择 soften。
6. 如果 finding 属于 A/F/G 类或 severity=high，drop 必须给出明确反证 quote（drop_evidence 字段必填）；没有反证 quote 则不得 drop。

最小代价原则：
- keep 的代价 = 用户多看一条非问题（成本低）
- drop 的代价 = 真问题被掩盖（成本高）
- 不对称的代价应反映在你的判断倾向中。
```

**Final**：
- `keep` → 保留原样
- `soften` → 保留但降级（severity 降一级，更新 reason）
- `escalate` → 保留但升级（severity 升一级）
- `drop` → 移除，写入 verifier-log.md（记录 drop_evidence）

### 步骤 4b-drop：V2 drop 反驳轮

对 Pass 2 判定为 `drop` 的条目，增加一轮结构化反驳审查，防止误 drop。

**触发条件**：Pass 2 输出中有 `decision: drop` 的条目。无 drop 条目则跳过。

**反驳轮 prompt**：
```
你是 drop decision challenger。下面是判断层准备 drop 的 findings。

你的默认立场是：如果 finding 的问题方向仍有合理成立空间，就不应 drop，而应恢复为 soften 或 keep。

只检查 drop 是否过度。不要重新审查已 keep/soften/escalate 的条目。

允许维持 drop 的条件（满足任一）：
1. 原文上下文明确反驳 finding
2. finding 的 quote 无法支持其核心结论
3. finding 完全不可修正，无法通过降低严重度、收窄范围或改写标题保留

输出 JSON：
{
  "finding_id": "...",
  "decision": "uphold_drop|restore_as_soften|restore_as_keep",
  "reason": "一句话说明",
  "restored_finding": {
    "title": "...",
    "severity": "...",
    "confidence": 0.0,
    "reason": "..."
  }
}
```

**裁决**：
- `uphold_drop` → 最终 drop，写入 verifier-log.md
- `restore_as_soften` → 恢复为 soften（severity 降一级）
- `restore_as_keep` → 恢复为 keep（原样保留）

**边界情况**：
- if Pass 2 无 drop 条目 → 跳过本步骤
- if 反驳轮全部 uphold_drop → drop 生效，写入 verifier-log.md
- if 反驳轮全部 restore → Pass 2 判定过于激进，恢复的条目按 restore_as_soften/restore_as_keep 分别处理

### 步骤 4c：轻量验证器（Sonnet）

**触发条件**（满足任一即触发）：
- finding 来自判断层（layer = judgment）
- confidence < 0.75
- severity = high
- rule_id ∈ {A.1, A.2, F, G}（高风险类别：核心指令 + 架构）
- 缺少直接机械证据
- 修复建议涉及架构变更

**验证方式**：单轮 prompt，不 spawn 子 agent

```
你是 findings verifier。你的职责不是减少 findings 数量，而是防止证据不足或表述过度的 finding 误导用户。

裁决规则：
1. keep：finding 的核心问题成立，证据足够，结论没有明显超出证据。
2. revise：finding 的问题方向成立，但标题、严重度、范围、原因或修复建议需要收窄。
3. drop：只有在以下情况允许：
   - quote/lineno 与原文不匹配（已被 V0 过滤，此处兜底）；
   - 原文上下文明显反驳该 finding；
   - finding 的核心问题不成立；
   - finding 完全依赖猜测，且无法通过 revise 修正。
4. 不确定时，不得 drop；应选择 revise，并说明需要收窄到什么范围。
5. 如果 finding 属于 A/F/G 类或 severity=high，drop 必须给出明确反证 quote；没有反证 quote 则不得 drop。
6. 如果 finding 部分成立，必须 revise，不得 drop。

最小代价原则：
- keep 的代价 = 用户多看一条非问题（成本低）
- drop 的代价 = 真问题被掩盖（成本高）
- 不对称的代价应反映在你的判断倾向中。

输出 JSON：
{
  "finding_id": "...",
  "decision": "keep|revise|drop",
  "reason": "一句话说明",
  "required_change": "decision=revise 时填写如何收窄；否则为空",
  "drop_evidence": "decision=drop 时填写反证 quote；否则为空"
}
```

输入：仅包含需验证的 findings + 对应证据片段，不传完整 SKILL.md。

**触发量约束**：每次排查预计 0-2 条，输入 ≤ 3k token。

### 步骤 4d：漏报抽样

在步骤 4c 之后、步骤 5 之前执行：

获取 SKILL.md 的章节列表（按 `##` 标题切分，`###` 子标题不独立计为章节）。
如果单个 `##` 章节 > 200 行且含 ≥ 3 个 `###` 子标题 → 按 `###` 拆分为子章节分别抽样。
筛选：排除已产出 findings 的章节，排除行数 < 20 的短章节。
从剩余章节中随机抽取 10%（高风险文件抽取 20%）。

对每个抽样章节，spawn 轻量 prompt：

```
以下章节是否存在 A（核心指令歧义/被淹没）、F（复杂度匹配）、G（职责重叠/循环依赖）、E（跨段冲突）类高严重度问题？

章节标题：{heading}
章节内容：
{该章节的原始 Markdown 文本，含行号前缀}

只输出 JSON：{"found": true/false, "finding": "..."}
```

if 抽样发现新 finding → 追加到 findings 列表，标注「抽样发现」
if 抽样未发现 → 无新 finding，不标注

**高风险文件定义**：line_count > 500 或 judgment_layer_findings ≥ 3。

**边界情况**：
- if SKILL.md 无 ## 标题 → 跳过漏报抽样
- if 所有章节都已产出 findings → 跳过漏报抽样
- if 抽样 prompt 调用失败 → 跳过，报告标注「漏报抽样不可用」
- if 筛选后候选章节为空 → 跳过漏报抽样

### 步骤 5：合并 findings + 计算健康度 + 生成报告

🛑 STOP — 排查完成，生成报告前读取目标 skill 目录下的 verifier-log.md，确认 drop 条目已持久化。

**Git 脏工作区警告**（前置）：

执行 `git -C {目标skill目录} status --porcelain`，如有未输出改动，在报告结构健康度前插入警告行：
```
⚠️ 目标 skill 有未提交改动，建议先 commit 再执行修复（不阻断后续流程）
```
非 git 仓库或无未提交改动 → 跳过警告，不报错。

**三层 findings 合并**：
```
最终 findings = mechanical_findings
              + mixed_layer_findings（已通过 quote 校验）
              + judgment_layer_findings（已通过 self-consistency）
              - 被验证器 drop 的 findings
              - 被 skip 记录匹配的 findings（见步骤 3.5 跳过记录过滤）
```

每条 finding 必须包含：condition_id / title / severity / confidence / lineno / quote / reason。
无 lineno 或 quote 的 finding 不进入最终报告。

**计算结构健康度分数**（见下方），将分数写入报告顶部。

按「报告格式」章节生成报告。报告中只含保留的 findings；drop 条目从 verifier-log.md 读取（单一事实来源）；skip 条目列入「已跳过」章节。

**决策表与用户交互**：

「需要你决策的」章节末尾附决策表：

```markdown
| # | 类别 | 问题 | 方案A | 方案B | 不修复 |
|---|------|------|-------|-------|--------|
| 1 | {类别} | {标题} | {方案A描述} | {方案B描述} | 跳过 |
```

决策表后追加：`回复格式：1A, 2不修, 3ok 或直接说「全不修」「1用A，其余跳过」`

🔴 CHECKPOINT：必须等用户回复决策表后才能进入步骤 8 优化循环。未收到回复 → 不执行任何修复。

**用户回复解析**：

```
解析用户回复，提取 {编号}{决策} 对：
- 数字 = 需要你决策的项序号
- A/方案A/a = 选择方案 A
- B/方案B/b = 选择方案 B
- ok/Auto/自动 = 留给 agent 自动处理（选择推荐方案）
- 不修/skip/跳过 = 不修复，写入 skip 记录
- 「全不修」= 所有项标记为不修复
- 「N用A，其余跳过」= 指定项选方案，其余不修复
```

**回复无法解析**：如果用户回复格式无法识别（如「不知道」「随便」）→ 再次展示决策表，最多重问 2 次，仍无法识别 → 将未决策项标记为「跳过」。

**跳过记录写入**：用户选「不修复」的 finding → 调用 `node resources/skip-record.mjs write --skill-dir <目标skill目录> --finding-id <id> --title <text> --condition-id <cid> --quote <text> --reason <text>`。

写入失败 → 报告末尾追加「⚠️ MISTAKES.md 写入失败，skip 记录未持久化」，不终止排查。

### 步骤 6：大型 skill 额外检查（仅大型）

在步骤 5 生成的报告基础上，追加第三部分「建议补充的」：

- 检查是否有 test-prompts.json → 按可测性判断：
  - if skill 有确定性可断言的行为（输入校验、兜底分支、状态转换）→ 列入「建议补充的」，覆盖这些行为，提醒用户「冒烟测试需自行设计」
  - if skill 行为几乎全部依赖上下文/交互 → 标记为「test-prompts 不适用」，不标为缺失
  - else → 列入「建议补充的」，提醒用户「冒烟测试需自行设计」
- 检查是否有 MISTAKES.md：
  - if 缺失 → 自动创建，写入五段式空模板（含「下次规则」字段），列入「已自动修复」
  - if 已有 → 不动

### 步骤 6a：确保 test-prompts.json 存在

调用 `node resources/test-prompt-gen.mjs generate --skill-md <目标SKILL.md路径> --skill-dir <目标skill目录>`。
- action=`"skipped"` → 已有正常文件，跳到步骤 6b
- action=`"generated"` → 已生成，跳到步骤 6b
- 退出码 != 0 → 报告标注「test-prompt-gen.mjs 不可用」

#### 二元 check 算子

| 算子 | 含义 | 判定方式 |
|------|------|---------|
| `must_include` | 输出必须包含指定文本 | 字符串包含 |
| `must_exclude` | 输出不得包含指定文本 | 字符串不包含 |
| `format` | 输出必须匹配指定格式 | 正则匹配 |
| `branch` | 根据条件走不同分支 | condition 和 negate_condition 二选一判定 |
| `count` | 输出中某模式出现次数 | 正则计数后比较 |

### 步骤 6b：执行验证

读取 test-prompts.json。

for each prompt:
  1. spawn 子 agent，携带目标 skill 的 SKILL.md
  2. 将 prompt 字段作为用户输入传入子 agent
  3. 收集子 agent 输出
  4. 逐条执行 checks 数组中的每个 check
  5. 判定：全部 checks 通过 → pass；任一失败 → fail
  6. 记录结果：prompt_id / status / 失败 check 描述

将结果汇总写入报告第四部分「实测验证」。

**截断策略**：若 SKILL.md 全文 > 8k token，截取前 8k token + `...（文件过长，已截断）`。

**步骤 6b 边界情况**：
- if 子 agent spawn 失败 → 该 prompt 标记为 `⚠️ error`，继续下一个
- if 子 agent 超时（>60s）→ 该 prompt 标记为 `⚠️ timeout`，继续下一个
- if 小而美 skill → 跳过自动生成，已有则执行
- if 全部 prompt 均为 fail/error/timeout → 报告显示「实测验证（0/{Y} 通过）」，不终止

### 步骤 7：记录踩坑（排查结束后）

以下触发条件适用于 **mechanic 自身** 的 MISTAKES.md（非目标 skill）。

排查过程中如果命中以下条件，必须将教训写入 skill-mechanic 自己的 MISTAKES.md：

**文件去向硬性区分**：
- **skill-mechanic 的 MISTAKES.md**：mechanic 自身的踩坑教训（误报、用户纠正、判断逻辑变更）
- **目标 skill 的 verifier-log.md**：被验证器 drop 的 finding（排查废弃产物）
- **目标 skill 的 MISTAKES.md**：**禁止写入**。目标 skill 的 MISTAKES.md 只记录该 skill 自身使用中的踩坑，不是 mechanic 排查的输出

| 触发条件 | 强度 | 说明 |
|----------|------|------|
| SKILL.md 被修改了 | 必须写 | 改动本身就是教训的证据 |
| 判断逻辑变了 | 必须写 | 如 test-prompts 判断从按类型改为按可测性 |
| 误报了 | 应该写 | 标记为问题但实际不是 |
| 用户纠正了 agent 的判断 | 必须写 | 用户纠正 = 最高价值信号，下次大概率还会犯 |

有触发条件命中 → 写 MISTAKES.md；无触发条件命中 → 不写。禁止 agent 自行判断"值不值得记录"。

MISTAKES.md 每条记录使用五段式：

```markdown
## 📌 Issue: [一句话标题] (YYYY-MM-DD)
### 1. The Error
### 2. Root Cause
### 3. Fix（SKILL.md 里改了什么）
### 4. Lesson（一句话可迁移原则）
### 5. 下次规则（if-then 可执行约束）
```

**回流阈值：** 本 skill 回流阈值 N=3。MISTAKES.md 积累 ≥3 条时，触发回流。

### 步骤 7b：历史追踪

排查结束后，将本次结果追加到 mechanic-log.tsv（经 `log-writer.mjs tsv` 子命令）。

**mechanic-log.tsv 格式**：

文件位置：`~/.claude/skills/skill-mechanic/mechanic-log.tsv`（11 字段固定顺序：timestamp / skill / health_score / auto_fixed / need_decision / suggest_add / mechanical_dropped / drop_challenged / drop_restored / test_pass_rate / note）

**边界情况**：
- if 写入失败（权限不足）→ 在报告末尾追加一行「⚠️ mechanic-log.tsv 写入失败」，不终止
- if TSV 字段值含制表符或换行符 → 替换为空格，保持 TSV 格式完整

### 步骤 7c：结构化日志

每次排查结束后，保存日志到 `~/.claude/skills/skill-mechanic/logs/{timestamp}.json`（经 `log-writer.mjs json` 子命令写入，data-json 含 18 个必填字段：timestamp、file_metrics、mechanical_findings、v0_mechanical_dropped、mixed_findings、judgment_pass1_findings、judgment_pass2_keep/soften/escalate/drop、v2_drop_challenged/restored、verifier_triggered/dropped、omission_sampled_sections/new_findings、final_findings、health_score）。

**边界情况**：
- if 日志目录不存在 → 自动创建
- if 日志写入失败 → 不终止排查，报告末尾追加「⚠️ 日志写入失败」
- if 同一时间戳的多次排查 → 文件名追加序号：`{timestamp}.json` → `{timestamp}_2.json`

### 步骤 8：优化循环（用户确认后执行）

if 用户在决策表中选择了 ≥1 项需执行的修复（选了方案 A 或方案 B 或 ok）：
  → 进入 Step 8 执行
if 用户所有项都选择「不修复」或「需要你决策的」为空：
  → 跳过 Step 8，排查结束

**修复队列构建**：
对决策表中每项：
  if 用户选方案 A → 修复方案 = 方案A描述，风险级别 = 该项定义
  if 用户选方案 B → 修复方案 = 方案B描述，风险级别 = 该项定义
  if 用户选 ok → 修复方案 = 方案A描述（推荐方案），风险级别 = 该项定义
  → 加入修复队列，保持原始顺序

**不修复项处理**：用户选「不修复」的项 → 写入目标 skill 的 MISTAKES.md skip 记录（格式见步骤 5 跳过记录写入段），不进入修复队列。

**Step 8 收尾**：
  1. 重新生成报告（已自动修复/已跳过/建议补充的 三项更新）
  2. 记录到 mechanic-log.tsv
  3. 保存结构化日志
  4. 展示优化后结构健康度

#### 步骤 8.1：回滚机制初始化

执行：`node resources/fix-loop.mjs init --skill-dir {目标skill目录}`
如果退出码 != 0 → 终止优化循环，报告「回滚初始化失败：{stderr}，修复未执行」。
如果退出码 == 0 → 读取 stdout 的 mode/base_sha/snapshot_path/branch，作为本次修复的回滚句柄（4 字段整体传递给后续 rollback 调用）。

#### 步骤 8.2：修复循环

修复优先级排序：调用 `node resources/fix-loop.mjs rank --items <待修复项json>`，按脚本输出的 queue 执行。
风险分级：low_risk_batch = 仅新增文字项；high_risk = 修改/删除已有文字项。

**批量确认**：将 low_risk_batch 合并为一批，展示清单。
🔴 CHECKPOINT：必须询问用户「以下 {N} 项低风险修复，全部执行 / 逐项确认 / 跳过」，等用户回复后才能执行。
高风险项始终逐项确认。

for each 待修复项：
  1. 记录修复前 SHA（git 模式）或确认快照存在（snapshot 模式）
  2. 展示该项的现状、风险、修复方案、风险级别
  3. if 低风险且用户选择「全部执行」→ 执行修复，跳到步骤 5
  4. if 高风险或用户选择「逐项确认」→ 询问用户选择方案（A / B / 不修复）
  5. if test-prompts.json 不存在 → 调用步骤 6a 自动生成
  5b. **修复后语义自检**（见下方步骤 8.2b）
  6. 重新执行步骤 6b（重跑全部 prompt）
  7. if 验证通过 → 保留修复，更新报告第一部分，继续下一项
  8. if 验证失败 → 进入重试循环（最多 3 轮），仍失败则回滚
  9. 更新结构健康度分数
  10. 🔴 CHECKPOINT：if 新分数 < 循环起点分数 → 必须暂停，展示分数对比，等用户选择回滚/保留/终止后才能继续。

#### 步骤 8.2b：修复后语义自检

每次修改 SKILL.md 后，在执行步骤 6b 验证前，必须对改动前后的相关片段做语义自检。

**版本选择规则**（硬规则，无需判断）：
- if 改动涉及 STOP / DO NOT / 输出格式 / 失败分支 / 依赖声明 → 使用详细版
- else → 使用精简版

**详细版（4 问）**：
1. LLM 读到改动后的这段，会如何理解并执行？
2. 是否存在两种以上合理解读？
3. 改动是否与现有 STOP、DO NOT、输出格式、失败分支或依赖声明产生新矛盾？
4. 改动是否引入新的交互步骤、依赖、权限要求或行为副作用？

**精简版（3 问）**：
1. LLM 读到改动后的这段，会如何理解并执行？
2. 是否存在两种以上合理解读？
3. 改动是否与现有 STOP、DO NOT、输出格式、失败分支或依赖声明产生新矛盾？

**执行约束**：
- 只读取改动前后的相关片段（前后各 ±5 行），不读取完整 SKILL.md
- 同一段落修复多次时，只对最终态做一次回读（缓存策略）

**判定**：
```
if 发现新增歧义、新矛盾或未声明的行为变化：
  → 停止当前修复
  → 将该项移入「需要你决策的」
  → 说明新增风险和可选修复方案

if 未发现问题：
  → 继续执行步骤 6b 验证
```

**与步骤 6b 的仲裁规则**：
- if 语义自检通过但步骤 6b 验证失败 → 以步骤 6b 为准，进入重试循环
- if 语义自检不通过 → 不执行步骤 6b，直接移入「需要你决策的」
- 原则：行为层验证（test-prompts）优先于语义层判断

#### 步骤 8.2a：回滚执行

```
调用：node resources/fix-loop.mjs rollback --mode {回滚句柄.mode} --skill-dir {目标skill目录} --base-sha {回滚句柄.base_sha} --snapshot-path {回滚句柄.snapshot_path} --branch {回滚句柄.branch}
如果退出码 != 0 且 stdout 含 rolled_back=false（checksum 失败）→ 终止优化循环，提示用户手动恢复。
如果退出码 == 0 → 读取 stdout 的 verified 字段，确认回滚成功。
```

回滚后自检：读取目标 SKILL.md，确认内容与修复前一致。

#### 步骤 8.3：循环结束

结束条件（满足任一即停）：
  - 所有待修复项均已处理（修复/跳过/回滚）
  - 用户说「停」「够了」「结束」
  - 已处理 ≥ 10 项（硬上限）

循环结束后：
  1. 输出更新后的报告（含新的结构健康度分数）
  2. if 有未处理项 → 在报告末尾列出未处理项清单
  3. if 有回滚项 → 将回滚经验写入 mechanic 的 MISTAKES.md
  4. 提示用户清理快照/分支

**步骤 8 边界情况**：
- if 报告中「需要你决策的」为 0 项 → 不进入优化循环，提示「无需决策项，排查已完成」
- if 修复导致 test-prompts 验证失败 → 进入重试循环（最多 3 轮），仍失败才回滚
- if 用户在循环中途说「停」→ 立即停止，输出当前已处理项的汇总
- if 健康度分数下降 → 提示用户，可选回滚/保留/终止
- if 低风险项全部执行后验证失败 → 逐个回滚低风险项（从最后一个开始），直到验证通过

---

## 三、排查类别定义

### A. 核心价值保护

检查 SKILL.md 的核心指令是否清晰、无歧义。

- if 核心指令存在多种解读方式 → 列入「需要你决策的」，描述歧义点和可能的解读
- if 核心指令被冗余内容淹没 → 列入「需要你决策的」，给出精简方向
- else → 通过

**「核心指令」识别方法：** SKILL.md 中的 DO NOT 列表、🛑 STOP 指令、输出格式定义、触发条件 = 核心指令。其余为辅助说明。
**「多种解读」判定：** 同一条 if-then 规则，能合理推出 ≥ 2 种不同执行路径 = 多种解读。
**「淹没」判定：** 核心指令字符数 < 非核心内容字符数 = 被淹没。

### B. 边界情况

检查是否有未覆盖的边界。

- if 存在用户可能输入但未处理的情况 → 自动修复：新增边界处理说明（仅新增文字，不修改已有）
- if 存在「应该」「建议」「最好」等模糊措辞 → 自动修复：改为 if-then 具体指令
- else → 通过

#### B.7 序列结构

检查执行流程是否有明确的步骤编号和过渡词。

**检测逻辑（参考实现，agent 用等价自然语言判断）：**
```python
# 编号步骤
re.findall(r"(?m)^\s*\d+\.\s+\w", content)       # "1. Do this"
re.findall(r"(?i)step\s*\d+", content)             # "Step 1"

# 序列词
re.findall(r"(?i)\b(first|then|next|finally|after that|完成后|然后|接着)\b", content)
```

**计数规则**：编号步骤按匹配次数计，不去重。序列词按匹配次数计，不去重。嵌套编号（`1.1`）不计入。

**判定**：
- if 有 ≥3 个编号步骤 **且** ≥2 个序列词 → 通过
- if 有 ≥3 个编号步骤但序列词 < 2 → 列入「需要你决策的」，不自动修复（序列词缺失的判定规则置信度不足，误修风险高）
- if 有编号步骤但 < 3 个 → 通过
- if 无编号步骤且 instructions > 500 字 → 报告，不自动修复
- if 无编号步骤且 instructions ≤ 500 字 → 通过

注：B.7 的「instructions > 500 字」分支对小而美 skill 同样适用。小而美 skill 的 instructions 通常 ≤ 500 字，该分支不会触发。

#### B.8 动作指令明确性（仅大型）

检查是否使用明确的动作指令词，而非抽象描述。

**检测逻辑（参考实现，agent 用等价自然语言判断）：**
```python
# 英文动作词
ACTION_EN = re.findall(
    r"(?i)\b(run|execute|invoke|call|create|configure|set up|install|deploy|start|stop|build|"
    r"read|write|delete|update|check|validate|parse|extract|generate|output|send|fetch|load|save)\b",
    content
)

# 中文动作词
ACTION_ZH = re.findall(
    r"(读取|写入|删除|更新|检查|验证|解析|提取|生成|输出|发送|获取|加载|保存|调用|执行|创建|配置|安装|部署|启动|停止)",
    content
)
```

**计数规则**：去重计数（同一种词出现多次只算 1 个）。中英文分开匹配，合并去重。

**判定**：
- if 有 ≥5 个不同的动作指令词 → 通过
- if 有 3-4 个不同的动作指令词，且 instructions > 500 字 → 列入「需要你决策的」
- if 有 3-4 个不同的动作指令词，且 instructions ≤ 500 字 → 通过
- if 有 < 3 个不同的动作指令词，且 instructions > 500 字 → 列入「需要你决策的」
- if 有 < 3 个不同的动作指令词，且 instructions ≤ 500 字 → 通过

### C. 防御性设计

检查是否有兜底和约束。

- if 关键步骤缺少失败分支 → 自动修复：新增 if-then 失败分支（仅新增文字）
- if 存在未声明的前置依赖 → 自动修复：新增依赖声明
- if 加约束、加兜底 → 无副作用，直接改
- if 需要改措辞才能加防御 → 有副作用，列入「需要你决策的」
- else → 通过

### D. 跨 skill 依赖

检查是否声明了对其他 skill 的依赖。

- if 引用了其他 skill 但未声明 → 自动修复：新增依赖声明（声明不改变行为，无副作用）
- if 依赖路径可能不正确 → 列入「需要你决策的」
- else → 通过

### E. 规格清晰度（仅大型）

检查指令是否精确。

- if 存在冗余描述（同一规则重复出现）→ 自动修复：删冗余（无副作用）
- if 存在错误引用或过时信息 → 自动修复：修错误（无副作用）
- if 存在歧义 → 自动修复：消歧义（无副作用）
- else → 通过

#### E.7 MISTAKES.md 检查点

**1. MISTAKES.md 是否存在**
- if 不存在 → 自动修复：创建五段式空模板，列入「已自动修复」
- if 存在 → 继续检查

**2. MISTAKES.md 是否为空**
- if 为空 → 正常（无失败记录 = 好事），不列入问题
- if 不为空 → 继续检查

**3. 触发机制是否声明**

以下检查**目标 skill** 的 MISTAKES.md 触发条件（非 mechanic 自身）。

- if SKILL.md 无"失败记录"相关指令 → 列入「需要你决策的」，补充触发条件
- if SKILL.md 有"失败记录"指令但未覆盖 4 项触发条件（错误结果/输出不符/用户纠正/边界情况）→ 列入「需要你决策的」，补充缺失条件
- if SKILL.md 有"失败记录"指令且覆盖完整 → 通过

**4. 记录格式是否符合**
- if MISTAKES.md 条目不符合五段式（Error/Root Cause/Fix/Lesson/下次规则）→ 列入「需要你决策的」，标注不符合条目编号，修正格式
- if MISTAKES.md 条目符合五段式 → 继续检查

**5. 回流机制是否声明**
- if SKILL.md 无"教训回流"相关指令 → 列入「需要你决策的」，补充回流规则
- if SKILL.md 有"教训回流"指令但未定义 N 值（取值范围 2-5，默认值 3）→ 列入「需要你决策的」，补充 N 值（2-5）
- if SKILL.md 有"教训回流"指令且 N 值在范围内 → 继续检查

**6. 已积累条数是否达标**
- if MISTAKES.md 条数 < N（该 skill 定义的回流阈值）→ 只提醒「当前 {n} 条，未达回流阈值 {N}」，不触发回流
- if MISTAKES.md 条数 ≥ N → 只提醒「当前 {n} 条，已达回流阈值 {N}，需处理」，不自动回流

**7. 全通过格式**
- if E.7 所有检查点均通过 → 在报告中输出 `✅ E.7 MISTAKES.md：通过（格式正确，触发机制完整，回流机制完整）`
- if 存在问题 → 按上述规则处理，按表格顺序输出（问题在前，提醒在后）

#### E.13 内容密度（仅大型）

检查各章节长度是否均衡，是否存在某个章节过长而淹没其他章节。

**检测逻辑**：
1. 统计 SKILL.md 中所有 `##` 级标题（排除代码块内的 `##`）
2. 计算每个章节的字符数（从当前 `##` 到下一个 `##` 之间的内容）
3. 空章节（`##` 标题后无内容或只有空行）：计入章节数，字符数为 0
4. 计算平均章节长度 = 总字符数 / 章节数

**判定**：
- if 平均章节长度在 200-1000 字 **且** 无章节超过平均值的 3 倍 → 通过
- if 存在章节**严格超过**平均值的 3 倍 **且** 章节字符数 > 1500 → 列入「需要你决策的」
- if 章节数 < 3 且总字数 > 2000 → 列入「需要你决策的」
- if 章节数 = 0（无 `##` 标题）→ 跳过

**与 H 类别的关系**：H 类别检查段落级（单段 > 200 字），E.13 检查章节级（章节间均衡性）。两者独立触发，不冲突。

### F. 复杂度与问题匹配（仅大型）

检查 skill 的复杂度是否与问题规模匹配。

- if 简单问题用了复杂架构 → 列入「需要你决策的」，说明不匹配点
- if 复杂问题缺少必要的结构 → 列入「需要你决策的」，补充结构
- else → 通过

**注意：** 复杂度调整一定是结构性的，不存在无副作用的改动，必须讨论。

### G. 架构（仅大型）

检查文件组织、职责分离、模块边界。

- if 存在职责重叠 → 列入「需要你决策的」
- if 存在循环依赖或不合理的耦合 → 列入「需要你决策的」
- else → 通过

**注意：** 架构改动一定是结构性的，必须讨论。

### H. 可维护性（仅大型）

检查可维护性指标，只报告不写测试。

- if H 类任一分支触发拆分/精简建议 **且** R 类否决拆分 → 降级为 warning，不计入健康度 finding，跳过后续拆分检查
- if 存在重复代码段 → 报告，标注位置
- if 存在过长的文件（SKILL.md > 40KB）→ 报告，建议精简废话、将执行时资源搬到 resources/；if 文件只包含一个连续流程且无独立子模块 → 接受当前大小，不拆核心流程
  - 超过 40KB 质量明显下降
- if 缺少注释或章节标题 → 报告
- else → 通过

### R. 执行可靠性（仅大型）

检查拆分建议是否会损害执行可靠性。R 是否决项：即使 H/E/G/F 触发拆分建议，只要 R 条件命中，就不拆核心流程。

- if 存在拆分建议会移动核心流程、安全边界、质量门槛、写入契约、失败兜底、不可逆动作限制 → 不建议拆核心流程；改为建议精简表达、迁移长枚举/模板/示例/历史记录等非执行资源
- if 拆分后主流程依赖 agent 主动读取多个文件才能正确执行 → 列入「需要你决策的」，并标注「可能降低执行可靠性」
- else → 通过

**R 的执行逻辑**：当其他类别（H/E/G/F）提出拆分建议时，检查该建议是否命中 R 的两条条件。命中 → 阻止拆分，改为建议资源迁移或表达压缩；未命中 → 拆分建议继续保留。R 不产生独立 findings，只否决其他类别的拆分建议。

R 否决 H 类建议时，H 类整体降级为 warning（不计入健康度 finding），而非保留在「需要你决策的」章节中循环触发。

### I. 安全与隐私（有文件/数据操作时）

检查是否有安全风险。

- if 存在未校验的外部输入 → 自动修复：新增输入校验约束（加约束 = 无副作用）
- if 需要新增交互步骤才能保障安全 → 列入「需要你决策的」（加交互步骤 = 有副作用）
- if 存在硬编码的敏感信息 → 列入「需要你决策的」
- else → 通过

---

## 四、自动修复标准

### 候选项来源

候选项来自排查类别 A-I, R 的各项检查规则。每条规则的 if-then 分支中，标注为「自动修复」的即为候选项。

### 自动修复预算

一次排查中自动修复候选项 > 5 时：
  → 只执行确定性最高的前 5 项
  → 其余列入「需要你决策的」，标注「自动修复候选项，因预算限制（≤5 处）移至此处」

排序规则（由 `fix-loop.mjs rank` 脚本实现，预算上限 5）：

调用 `node resources/fix-loop.mjs rank --items <待修复项json> [--budget 5]`，按脚本输出的 queue 执行。

### 无副作用，直接改

- 只新增文字/文件，不删除、不修改已有文字
- 新增内容不改变已有规则的行为
- 新增内容不引入新的交互分支
- 把模糊指令变精确（「应该」→ if-then、消除歧义）

### 有副作用，列决策列表讨论

- 改已有文字（措辞变了，LLM 行为可能变）
- 引入新交互分支（用户会多看到提示或多一个步骤）
- 删除已有内容（可能误删核心指令）
- 结构性调整（拆文件、改架构、改复杂度）

---

## 五、报告格式

### 报告模板

报告由以下部分组成（每个部分对应一个 markdown 段）：

```markdown
## 结构健康度：{score}%
| 类别 | 适用条件数 | 通过数 | 状态 |
|------|-----------|--------|------|
| ... | ... | ... | ... |
| **合计** | **{total}** | **{passed}** | **{score}%** |

### 排查统计
| 层 | findings 数 | 耗时 |
|---|---|---|
| 机械层（脚本） | {n} | <1s |
| ... | ... | ... |

## 已自动修复（{N} 项）
| # | 类别 | 来源 | 改了什么 | 为什么 |
|---|------|------|---------|--------|

## 已跳过（{K} 项）  ← 仅在有 skip 记录命中时出现
- {finding.title}（用户选择不修复，{timestamp}）

## 需要你决策的（{M} 项）  ← 为空时不出此段
| # | 类别 | 问题 | 方案A | 方案B | 不修复 |
|---|------|------|-------|-------|--------|
回复格式：`1A, 2不修` 或「全不修」

## 建议补充的
- [ ] test-prompts.json：{缺失 / 已有但不完整}
- [ ] MISTAKES.md：{缺失时已自动创建 / 已有}

## 实测验证（{X}/{Y} 通过）  ← 仅在 test-prompts.json 存在时出现
| # | Prompt | 断言 | 状态 | 备注 |
|---|--------|------|------|------|

> 验证器：{触发 N 次，drop N 条} / 漏报抽样：{抽样 N 章节，发现 N 条新问题}
> 结构化日志：logs/{timestamp}.json
```

如果改动涉及 LLM 行为变化，提醒用户跑测试验证。

### verifier-log.md 格式

文件位置：目标 skill 目录下。验证器 drop 的 findings 写入此文件（格式：类别分组 → 每条含原文/drop 原因/反证 quote/来源/归纳状态）。底部一行汇总：drop M 条，soften S 条，escalate E 条，保留 K 条。

**双向监控阈值**（warning 级：报告追加提醒；action 级：暂停询问用户）：

| 级别 | 触发条件 |
|------|----------|
| warning | 最近 5 次 drop rate ≥ 40% / A/F/G 类 high severity drop ≥ 2 / 同类别连续 3 次被 drop |
| action | verifier-log 总 drop ≥ 15 / 单类别 drop ≥ 5 / 连续 5 次 drop_count==0 且 findings>20 |

### 报告末尾：verifier-log 累积检查

🔴 CHECKPOINT：达到 action 阈值时必须暂停，询问用户是否启动归纳分析，等用户回复后才能继续。不自动执行。

- if verifier-log.md 不存在 → 跳过

**反向归纳 + 4-agent 归纳**（条件性）：

| 类型 | 触发条件 | 动作 |
|------|---------|------|
| 反向归纳 | 连续 5 次 drop_count==0 且 findings>20 | 抽 10% keep 条目用反向 prompt 验证 |
| 4-agent 归纳 | action 阈值命中后用户确认 | spawn 3 agent 统计 + 1 对抗验证，交集对齐后转 SKILL.md 修改建议 |

4-agent 输出：`{"patterns": [{"category": "B", "reason": "...", "count": 5, "suggestion": "..."}]}`。对齐标准：3 agent 中 ≥ 2 提同一「类别+原因」组合 → 算对齐。

---

## 六、小而美 skill 特殊规则

当目标 skill 是小而美类型时：

- 只排查 A、B、C 三个类别（D-I 全部跳过）
- 不评 DO NOT 数量（反例清单有几条算几条，不因数量少而扣分）
- 不评 test-prompts.json（小而美 skill 不要求有）
- 不评文件拆分（单文件是正常形态）
- 不评错误兜底（小而美 skill 的失败分支简化为「目标不存在→终止」即可）
- 重点评每一句话是否在做一件事、有没有废话、LLM 会不会误解
- 没问题就说没问题，不要为了凑条目而列出非问题

---

## 七、反例与黑名单

**核心禁区（MUST NOT）：**

| # | 反模式 | 为什么不要做 | 替代做法 |
|---|--------|------------|---------|
| 1 | **用 9 维度硬套打分** | 评分维度因 skill 类型而异，统一打分是伪精度 | 用结构健康度（通过率百分比）衡量整体质量，报具体问题让用户判断严重程度 |
| 2 | **替用户做决策** | 用户是飞行员，agent 是机械师 | 列出方案和副作用，等用户选择后执行 |
| 3 | **用 9 维度硬套小而美** | 小而美的价值在于精准，不在于结构完整 | 用小而美特殊规则，只评核心指令质量 |
| 4 | **凑问题** | 浪费用户注意力，降低报告信噪比 | 没问题就说没问题，只报真实发现 |
| 5 | **给简洁型 skill 建议加结构** | 加结构会淹没核心指令，破坏简洁性 | 只建议能提升 LLM 理解精准度的改动 |
| 6 | **写测试用例** | 测试用例设计是 writing-skills 的职责 | 在报告第三部分建议补充 |
| 7 | **改核心设计** | 核心设计改动需要用户确认 | 列入「需要你决策的」，等用户决定 |
| 8 | **编造排查发现** | 报告了 SKILL.md 中实际不存在的问题，破坏报告可信度 | 只报真实存在的问题，每条发现必须能回溯到原文具体位置 |
| 9 | **生成规定格式以外的章节** | 三部分报告是 skill 的核心输出契约，额外章节让用户困惑 | 严格按「六、报告格式」生成，观察发现融入已有三部分 |

---

## 八、失败模式

**核心原则**：目标不存在/格式异常 → 终止或降级；写入失败 → 移到需决策；验证器失败 → 跳过并标注。

终止类（该步骤终止排查）：
```
If 目标 skill 路径不存在：
  → 报告「目标 skill 不存在：{路径}」，终止排查

If 目标 skill 目录为空：
  → 报告「目录为空：{路径}」，终止排查

If SKILL.md 不存在：
  → 报告「未找到 SKILL.md：{目录路径}」，终止排查

If SKILL.md 格式异常（编码错误、空文件等）：
  → 尝试用可解析的部分继续排查
  → 在报告中标注「SKILL.md 格式异常，排查结果可能不完整」
```

降级类（不终止，降级处理并报告标注）：
```
If 以下工具层不可用 → 退化为原有流程并报告标注（不终止）：
- skill-md-lint 不可用 → 标注「skill-md-lint 不可用，已退化为全量排查」
- 混合层某组 prompt 失败 → 标注「混合层 {组名} 不可用」
- 判断层 self-consistency 调用失败 → 退化为无 self-consistency 单次判断
- 验证器调用失败 → 跳过验证，直接输出 findings，标注「验证器不可用」

If 排查类别 I 的触发条件不满足（无文件/数据操作）：
  → 跳过类别 I，不在报告中提及
```

警告类（报告追加警告 + 不终止）：
```
If 自动修复写入失败（文件只读、权限不足）：
  → 将该项从「已自动修复」移到「需要你决策的」，标注「写入失败，需手动处理」
  → 继续排查其他项目，不终止

If MISTAKES.md 写入失败（文件只读、权限不足）：
  → 在报告末尾追加一行「⚠️ MISTAKES.md 写入失败，教训未记录，请手动补充」
  → 不终止排查

If 步骤 6 检查 test-prompts.json 读取异常（JSON 格式错误）：
  → 报告「test-prompts.json 格式异常，需检查」，列入「建议补充的」
  → 不终止排查

If verifier-log.md 写入失败（文件只读、权限不足）：
  → 在报告末尾追加「⚠️ verifier-log.md 写入失败，drop 条目未持久化」
  → 不终止排查

If 累积检查读取 verifier-log.md 异常：
  → 跳过累积检查，在报告中标注「⚠️ verifier-log.md 读取异常，累积检查跳过」
  → 不终止排查
```

---

<!-- 维护节奏：每 90 天检查一次，Hub 数据显示死亡拐点在第 10 个月 -->
