*已回流 2026-06-15：7 条教训归纳为 4 条规则融入 SKILL.md（B 类别 +3，H 类别 +1），3 条已存在于 SKILL.md。*

## 📌 Issue: griller 多轮对话无自动继续机制导致流程停滞 (2026-06-15)
### 1. The Error
skill-mechanic 运行到步骤 4b 时，griller 返回第一轮挑战问题后流程停滞，需要用户手动说"继续"才能推进。
### 2. Root Cause
griller 协议设计为多轮对话（1 初始 + 2 追问），但 SKILL.md 步骤 4b 没有说明 mechanic 需要自动 SendMessage 继续对话。mechanic 把 griller 的返回值当作"最终结果"，但实际上它只是"第一轮挑战"。
### 3. Fix（SKILL.md 里改了什么）
在步骤 4b 补充「Griller 多轮对话自动继续机制」，明确说明：griller 返回后不能视为流程结束，必须主动 SendMessage 推进对话，直到获得明确的 surviving/killed 列表。
### 4. Lesson（一句话可迁移原则）
sub-agent 多轮对话必须有自动继续机制，否则流程会停滞等待用户干预。
### 5. 下次规则（if-then 可执行约束）
if spawn sub-agent 进行多轮对话 → 必须在 SKILL.md 中明确自动继续逻辑，griller 返回后主动 SendMessage 推进

## 📌 Issue: "大型工具型 skill 例外"规则导致 SKILL.md 拆分延迟 (2026-06-15)
### 1. The Error
H.1 检查 SKILL.md > 200 行时，规则有"大型工具型 skill 除外"例外，导致 skill-mechanic 虽然 482 行但未被标记为需要拆分。
### 2. Root Cause
"大型工具型 skill 例外"没有明确的判断标准，griller 过度宽松地应用了这个例外。
### 3. Fix（SKILL.md 里改了什么）
删除"大型工具型 skill 例外"规则，所有 SKILL.md > 200 行都必须建议拆分。执行拆分，SKILL.md 从 482 行减少到 200 行。
### 4. Lesson（一句话可迁移原则）
例外规则必须有明确的判断标准，否则会被过度宽松地应用。
### 5. 下次规则（if-then 可执行约束）
if 规则有例外条件 → 必须定义例外的判断标准，否则删除例外

---

## 📌 Issue: griller 用 H 类别的例外规则击杀 E.13 的 finding (2026-06-15)
### 1. The Error
griller 击杀了 E2（E.13 内容密度），理由是"大型工具型 skill 例外"，但这是 H 类别的规则，E.13 没有例外规则。
### 2. Root Cause
griller 混淆了 E.13 和 H 两个不同类别的规则。H 类别有"大型工具型 skill 例外"，但 E.13 是独立检查，没有例外规则。griller 用 H 的例外规则来击杀 E.13 的 finding，属于越界。
### 3. Fix（SKILL.md 里改了什么）
用户决定拆分 griller 相关内容到 resources/griller-protocol.md，SKILL.md 中步骤 4b 替换为简短引用。
### 4. Lesson（一句话可迁移原则）
E.13 和 H 是独立检查，griller 不能用 H 的例外规则来击杀 E.13 的 finding。
### 5. 下次规则（if-then 可执行约束）
if griller 用其他类别的例外规则来击杀当前类别的 finding → 击杀该 griller 判定，恢复 finding

---

## 📌 Issue: griller 用目标 skill 的 Output 定义否定 mechanic 的 E.7 检查 (2026-06-15)
### 1. The Error
griller 击杀了 E.7 MISTAKES.md 不存在的 finding，理由是目标 skill 的 Output 定义不包含 MISTAKES.md。
### 2. Root Cause
griller 混淆了两件事：目标 skill 教别人做的事（Step 9：嵌入指令）vs mechanic 对目标 skill 自身的检查（E.7：目录下有没有 MISTAKES.md）。griller 用目标 skill 的产出定义否定了 mechanic 的排查规则，属于越界。
### 3. Fix（SKILL.md 里改了什么）
无 SKILL.md 改动。griller prompt 模板已明确检查维度，问题出在 griller 的推理逻辑。
### 4. Lesson（一句话可迁移原则）
mechanic 的排查规则（A-I）是独立于目标 skill 内容的检查框架，griller 不能用目标 skill 的定义来否定 mechanic 的规则。
### 5. 下次规则（if-then 可执行约束）
if griller 用目标 skill 的 Output 定义/内容来否定 mechanic 的 E.7 检查 → 击杀该 griller 判定，恢复 finding

---

## 📌 Issue: 行数限制与文件大小限制混淆 (2026-06-15)
### 1. The Error
机械师 skill 将"SKILL.md > 200 行"作为强制限制，建议拆分到 resources/，实际上行数只是判断 skill 类型的参考，不是强制限制。
### 2. Root Cause
混淆了两个概念：① 升格为大型 skill 的条件（行数>200）；② 文件大小限制。蓝皮书数据显示文件大小最优区间是 10-20KB，超过 40KB 质量明显下降。
### 3. Fix（SKILL.md 里改了什么）
修改 categories.md H 类规则：删除行数限制，改为文件大小限制（>40KB 时提醒）。修改 SKILL.md H 类描述。
### 4. Lesson（一句话可迁移原则）
行数只是 skill 类型判断的参考，文件大小（KB）才是质量判断的正确标准。
### 5. 下次规则（if-then 可执行约束）
if 检查 SKILL.md 是否过长 → 用文件大小（KB）判断，超过 40KB 时提醒优化（精简废话、搬迁执行时资源）；职责单一则接受，不拆核心流程

---

## 📌 Issue: resources/ 文件导致 I/O 开销过大 (2026-06-15)
### 1. The Error
skill-mechanic 的核心流程被拆到 resources/ 下的 8 个文件中，每次运行需要读取 8 次文件，导致 I/O 开销过大，运行速度变慢。
### 2. Root Cause
错误地将核心流程文件放到 L3 resources/ 层。蓝皮书设计 L3 的初衷是放「执行时才需要的资源」（静态查表、动态模板），不是「核心流程」。
### 3. Fix（SKILL.md 里改了什么）
将 resources/ 下的 8 个文件全部合并回 SKILL.md：griller-protocol.md、report-format.md、failure-modes.md、anti-patterns.md、auto-fix-standard.md、mistakes-recording.md、feedback-loop.md、small-skill-rules.md。
### 4. Lesson（一句话可迁移原则）
L3 resources/ 放执行时才需要的资源，核心流程应该放在 L2 instructions（SKILL.md）中。
### 5. 下次规则（if-then 可执行约束）
if 核心流程文件每次运行都需要读取 → 合并回 SKILL.md，不放 resources/

---

## 📌 Issue: Step 2 过重拆分建议被用户否决 (2026-06-21)
### 1. The Error
排查 spec-guidelines 时，Step 2（写模块 + 写时门禁）731 行文件中占 ~160 行（3.4× 均值），报告建议拆 Step 2.5 为独立 `##` 章节。
### 2. Root Cause
H 类规则检查章节均衡性，触发 3× 均值阈值。但未考虑执行可靠性（R 类）因素：门禁是模块编写的必经之路，嵌套结构保证 agent 零跳转执行。
### 3. Fix（SKILL.md 里改了什么）
未修改。用户选择不拆。
### 4. Lesson（一句话可迁移原则）
章节均衡性（H）不应凌驾于执行可靠性（R）之上。拆分建议前必须评估 agent 执行时是否需要额外跳转。
### 5. 下次规则（if-then 可执行约束）
if H.2 触发（章节 > 3× 均值）且该章节包含执行链的必经步骤（门禁/校验/兜底） → 先评估 R 类影响，R 命中则不建议拆，改为建议压缩表达
