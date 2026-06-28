# Changelog

## v0.1.1 (2026-06-28)

### 文档

- README.md 设计原则新增「反例黑名单」
- README-en.md 新增英文版 README，含 Design Principles / Why It's Different / Quick Start / How It Works / 9 Dimensions / Self-Iteration via MISTAKES.md 等章节

---

## v0.1.0 (2026-06-26)

首次发布。

### 功能

- 9 维度排查：核心价值保护(A)、边界情况(B)、防御性设计(C)、跨 skill 依赖(D)、规格清晰度(E)、复杂度匹配(F)、架构(G)、可维护性(H)、执行可靠性(R)、安全与隐私(I)
- 多层检查架构：机械层(脚本) → 混合层(Sonnet) → 判断层(Opus self-consistency) → 验证器(Sonnet) → 漏报抽样
- 三段式报告：已自动修复 / 需要你决策的 / 建议补充的
- 优化循环：含回滚机制、语义自检、test-prompts 验证
- 小而美 skill 特殊规则：只排查 ABC 三类，不强制结构完整
- skip 记录机制：用户选择不修复的项持久化，下次排查自动跳过
- 结构化日志：每次排查生成 JSON 日志，支持历史追踪

### 资源脚本

- `resources/fix-loop.mjs`：优化循环管理（init/rank/rollback）
- `resources/log-writer.mjs`：日志写入（tsv/json）
- `resources/mechanical-validator.mjs`：机械校验（quote 匹配、字段完整性）
- `resources/skip-record.mjs`：skip 记录过滤与写入
- `resources/test-prompt-gen.mjs`：test-prompts.json 自动生成
- `resources/skill-md-lint/`：机械层检查脚本（12 项 SKILL.md 检查）
