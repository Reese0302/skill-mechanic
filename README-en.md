<div align="center">

# skill-mechanic

**Find the real problems in your SKILL.md. Skip the noise.**

> 5-layer adversarial pipeline · 9 audit dimensions · actionable 3-section reports
>
> Real result: authoring-rules scored 66% → 97%, 8 auto-fixes + 2 decisions. Execution time ~2 min. Mechanical-layer checks are deterministic — zero false positives.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](CHANGELOG.md) [![Skills](https://img.shields.io/badge/skills.sh-Compatible-green)](https://skills.sh)

[中文文档](README.md) · [Quick Start](#quick-start) · [Real Result](#real-result) · [How It Works](#how-it-works) · [9 Dimensions](#9-audit-dimensions) · [Limitations](#limitations) · [FAQ](#faq)

</div>

---

## What It Does

skill-mechanic audits a Claude Skill's `SKILL.md` — the single file an agent reads every time it runs. It finds real spec problems (ambiguous instructions, missing failure branches, unclear triggers) and filters out noise. Every finding comes with a clear verdict: **auto-fix / needs your decision / skip**. Fixes are verified against test prompts — if a fix breaks behavior, it rolls back.

## Why It's Different

**Most LLM review tools hallucinate problems.** A single-pass review might report 10 issues — and 3 of them are invented. Small skills are unnecessarily flagged to "split into 3 modules." 50-line files get force-fitted into enterprise frameworks. There is no way to tell which findings are real.

skill-mechanic attacks this from multiple angles:

- **Mechanical layer** catches structural defects — missing fields, broken quotes, duplicates — with deterministic scripts. Zero false positives.
- **Adversarial LLM layer** pits a reviewer against an author-advocate. Every finding is challenged before it reaches the report.
- **Verification layer** re-runs test prompts after fixes. If behavior changes unexpectedly, the fix is rolled back.

The result: false positives in single digits, real problems surfaced first, and a clear line between "fixed" and "your call."

---

## Design Principles

**Spec-only, not implementation.** `SKILL.md` is the agent's only entry point. If the spec is wrong, everything downstream is wrong. Scripts in `resources/` can be tested with Jest or Vitest — but there is no standard tool for testing specification quality. skill-mechanic fills this gap.

**Scripts first.** 70%+ of checks run as deterministic scripts (mechanical-validator.mjs, skill-md-lint). Zero tokens, zero false positives, under 1 second. Semantic checks are left to LLM only where scripts cannot reach.

**Self-iterating.** False positives and user corrections are recorded in `MISTAKES.md`. The next audit reads that file and skips known non-issues. When enough lessons accumulate, they are consolidated back into `SKILL.md` as rules. The skill becomes more accurate with every audit, instead of growing stale.

**Anti-pattern blacklist.** The system explicitly forbids five common failure modes of review tools: force-fitting fixed dimensions onto every skill, making decisions for the author, manufacturing findings to pad the report, and emitting findings without traceable evidence. These rules are written into the audit pipeline as guardrails, not guidelines.

---

## Quick Start

### Install

```bash
# Option A: via skills.sh (recommended)
npx skills@latest add Reese0302/skill-mechanic

# Option B: clone directly
git clone https://github.com/Reese0302/skill-mechanic.git ~/.claude/skills/skill-mechanic
```

### Trigger

Say any of these in Claude Code:

```
audit skill grill-me
check this skill
review skill
audit                           ← no target specified — lists all skills to pick from
audit ~/.claude/skills          ← absolute path works too
```

### Minimal Flow

```
You:  audit skill grill-me
AI:   [locate target] → [classify: small or large] → [5-layer audit] → [report]
AI:   Report ready. 3 items need your decision. Reply: 1A, 2-skip, 3-ok
You:  1A, 2-skip, 3-ok
AI:   [apply fixes] → [verify] → [updated report]
```

### Dependencies

- **skill-md-lint** (bundled in `resources/skill-md-lint/`): mechanical-layer script for deterministic checks. When unavailable, the tool degrades gracefully to full-LLM mode (all features intact, mechanical checks skipped).

---

## Real Result

### authoring-rules: 66% → 97%

**Before audit:** narrative description, vague triggers, missing the standard five-part header (What/Input/Output/Dependency/Failure), 4 stages with 14 prose rules, no DO NOT list, no failure branches.

**After audit:**

| Area | Before | After |
|------|--------|-------|
| Description | "Structural convention for large skills" | Three-part: what + triggers + output format |
| Triggers | "Normalize this skill" | "write skill" / "create SKILL.md" |
| Header | No five elements | Q&A: what / input / output / dependency / failure |
| Steps | 4 stages, 14 prose rules | 12 numbered steps, each with if-then |
| DO NOT | None | 5 MUST NOT / NEVER rules |
| Failure branches | None | if-then on every critical step |
| Visual markers | None | CHECKPOINT + STOP markers |
| MISTAKES.md | None | Five-part template + backflow mechanism |

To try this on your own skill: run `audit skill <your-skill-name>` and compare the before/after scores.

---

## How It Works

```
User input
    │
    ▼
┌─ Layer 0: Mechanical ──────────────────────────────────┐
│  Node.js scripts, zero tokens                          │
│  · Quote-line matching · Field completeness · Dedup    │
│  Output: mechanical_findings + suspect_ranges          │
└────────────────────────────┬───────────────────────────┘
                             ▼
┌─ Layer 1: Hybrid (Sonnet) ─────────────────────────────┐
│  Two structured prompts:                               │
│  · boundary-wording: edges, vague language, sequences  │
│  · spec-interaction: ambiguity, triggers, density      │
│  Post-check: quote must match exactly or finding drops │
└────────────────────────────┬───────────────────────────┘
                             ▼
┌─ Layer 2: Judgment (Opus, self-consistency) ───────────┐
│  Pass 1: Reviewer — find problems aggressively         │
│  Pass 2: Author-advocate — challenge every finding     │
│  Verdict: keep / soften / escalate / drop              │
│  A "drop-rebuttal" round: prevents over-aggressive dismissal of findings   │
└────────────────────────────┬───────────────────────────┘
                             ▼
Merge → Dedup → Skip-filter → Health score → Report
```

**Four-state verdict.** Pass 2 does not simply agree or disagree. Each finding gets one of: *keep* (criticism stands), *soften* (direction right but overstated), *escalate* (worse than described), *drop* (criticism wrong). Intermediate states prevent information loss from binary decisions.

**Asymmetric cost.** Keeping a non-issue costs the user one extra line to read. Dropping a real issue hides a problem. The system leans toward keeping — drops require counter-evidence quotes.

---

## 9 Audit Dimensions

| # | Dimension | What it checks | Scope |
|---|-----------|----------------|-------|
| A | Core Value Protection | Are core instructions clear and unambiguous? | All |
| B | Edge Cases | Uncovered inputs, vague wording, sequence gaps | All |
| C | Defensive Design | Failure branches, pre-dependencies, fallbacks | All |
| D | Cross-Skill Dependencies | Missing dependency declarations | All |
| E | Spec Clarity | Redundancy, wrong quotes, content density | Large |
| F | Complexity Match | Simple problem with complex architecture (and vice versa) | Large |
| G | Architecture | Responsibility overlap, circular dependencies | Large |
| H | Maintainability | Duplicates, file size, comments | Large |
| R | Execution Reliability | Veto — blocks splitting if it hurts runtime correctness | Large |
| I | Safety & Privacy | Unvalidated input, sensitive data, security constraints | All |

> **Large** = multi-file or >200 lines. **All** = every skill, including small ones. Small skills are audited on A/B/C only — no scoring, no structure requirements, no splitting suggestions.

---

## Self-Iteration via MISTAKES.md

Every audit can produce false positives. When one is caught — either by the system or by the user choosing "skip" — the lesson is recorded in `MISTAKES.md` using a five-part template:

```
Situation → What happened → Lesson → Rule → Verified
```

On the next audit, `MISTAKES.md` is read first. Known non-issues are filtered out before the report is generated. When lessons accumulate past a threshold (default: 3), they are consolidated into rules and written back into `SKILL.md`.

```
Lesson → MISTAKES.md → accumulate ≥3 → consolidate → SKILL.md
```

The skill does not decay over time. It sharpens.

---

## Limitations

| Area | Covered | Not covered |
|------|---------|-------------|
| **Scope** | `SKILL.md` spec quality | `resources/` scripts (use jest, etc.) |
| **Depth** | 5-layer architecture catches most issues | Zero false negatives — missed-issue sampling is probabilistic (10-20% of sections) |
| **Judgment** | Deterministic checks (missing fields, broken quotes, vague wording) | Design judgment — "is this architecture right" is the author's call |
| **Semantics** | Self-consistency reduces false positives | Eliminating false positives — ambiguity judgments may differ from human review |
| **Verification** | Auto test-prompts cover input→output assertions | All execution paths — handcrafted test cases are always more targeted |

> It saves ~80% of review time. The remaining 20% of design judgment is still yours.

---

## FAQ

<details>
<summary><b>Can one file really cover skills of any size?</b></summary>

Yes. The audit classifies a skill as "small" or "large" before it starts. Small skills (single file, ≤200 lines) get a lightweight pass — core instructions only, no scoring, no splitting suggestions. Large skills get the full 9-dimension treatment. The same file adapts its behavior to the target.
</details>

<details>
<summary><b>Does my skill need heavy modifications to work with this?</b></summary>

No. Run the audit as-is on any `SKILL.md`. If the skill already has a `MISTAKES.md` and `test-prompts.json`, those are used. If not, the tool generates what it needs. The audit report is the starting point — apply what you agree with, skip the rest.
</details>

<details>
<summary><b>What is the false positive rate?</b></summary>

The mechanical layer (Layer 0) has zero false positives — it runs deterministic scripts. The LLM layers use self-consistency (reviewer vs. author-advocate) to push false positives into single digits. Any remaining false positives can be dismissed via the skip mechanism and will not reappear.
</details>

<details>
<summary><b>Can this run automatically on a schedule?</b></summary>

Not built-in. But since it is a Claude Code skill triggered by a text command, any automation layer that can send messages to Claude Code (CI pipeline, cron-triggered agent, etc.) can invoke it. The structured JSON log (`logs/{timestamp}.json`) supports trend tracking across runs.
</details>

---

## Credits

- **Skill Blue Book ([ZhuYansen](https://github.com/ZhuYansen))** — empirical basis for the 9-dimension system; sweet-spot data used in F/H thresholds
- **Baoyu ([JimLiu](https://github.com/JimLiu))** — agent-role design, skill atomization, self-iteration, scripts-first philosophy; the mechanical architecture and MISTAKES.md backflow mechanism build on this foundation
- **Huashu ([alchaincyf](https://github.com/alchaincyf))** — the "same AI cannot edit and judge" anti-pattern from darwin.skill; adopted as the self-consistency adversarial mechanism
- **Matt Pocock ([mattpocock](https://github.com/mattpocock))** — dual-perspective verification from grill-me; extended into four-state verdict in the reviewer vs. author-advocate design

## License

[MIT](LICENSE)

---

<p align="center">
<a href="README.md">中文文档</a>
</p>
