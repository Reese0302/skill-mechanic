#!/usr/bin/env node
/**
 * test-prompt-gen.mjs — test-prompts.json 自动生成
 * 子命令：generate
 *
 * I/O 契约见 improvement-spec-e2-瘦身.md 模块 B
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── helpers ──────────────────────────────────────────────────────────────────

function fail(msg, code = 1) {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// ── generate ─────────────────────────────────────────────────────────────────

function cmdGenerate(args) {
  const skillMd = resolve(args["--skill-md"]);
  const skillDir = resolve(args["--skill-dir"]);

  if (!existsSync(skillMd)) fail(`SKILL.md 不存在：${skillMd}`);
  if (!existsSync(skillDir)) fail(`skill 目录不存在：${skillDir}`);

  const testPromptsPath = join(skillDir, "test-prompts.json");

  // 检查是否已存在
  if (existsSync(testPromptsPath)) {
    try {
      const existing = JSON.parse(readFileSync(testPromptsPath, "utf-8"));
      if (Array.isArray(existing)) {
        // 已存在且格式正常 → skipped
        out({
          action: "skipped",
          prompts: existing,
          untestable: [],
          checks_passed: true,
        });
        return;
      }
    } catch {
      // JSON 格式异常 → 重新生成
      process.stderr.write("test-prompts.json 格式异常，已重新生成\n");
    }
  }

  // 读取 SKILL.md
  let content = readFileSync(skillMd, "utf-8");

  // 截断超长文件（> 8k token ≈ 32k chars）
  const maxChars = 32000;
  let truncated = false;
  if (content.length > maxChars) {
    content = content.slice(0, maxChars) + "\n...（文件过长，已截断）";
    truncated = true;
  }

  // 提取指令行（排除代码块）
  const lines = content.split("\n");
  const instructions = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // 提取含指令特征的行
    if (
      /\b(if|STOP|MUST|NEVER|禁止|必须|不可|不得)\b/i.test(line) ||
      /\b(如果|→|则)\b/.test(line)
    ) {
      instructions.push({ lineno: i + 1, text: line.trim() });
    }
  }

  // 阶段 1：生成断言三元组
  const assertions = [];
  const untestable = [];
  let assertionId = 0;

  for (const inst of instructions) {
    assertionId++;
    const aid = `A${assertionId}`;
    const text = inst.text;

    // 分类
    let category = "boundary";
    if (/失败|不存在|异常|错误|error|fail|miss/i.test(text)) {
      category = "failure";
    } else if (/成功|通过|正常|pass|ok|正确/i.test(text)) {
      category = "happy_path";
    }

    // 提取可观测信号
    let observableSignal = null;

    // 匹配 "输出含X" / "报告含X" / "标注X"
    const outputMatch = text.match(/(?:输出|报告|标注|显示|包含)[「"']?(.+?)[」"']?$/);
    if (outputMatch) {
      observableSignal = { type: "must_include", value: outputMatch[1].replace(/[」"']/g, "") };
    }

    // 匹配 "退出码 N"
    const exitMatch = text.match(/退出码\s*[=：:]\s*(\d)/);
    if (exitMatch) {
      observableSignal = { type: "format", value: `exit_code=${exitMatch[1]}` };
    }

    // 匹配 "终止/不终止"
    if (/终止/.test(text) && !observableSignal) {
      observableSignal = { type: "must_include", value: "终止" };
    }

    if (!observableSignal) {
      untestable.push({ lineno: inst.lineno, reason: "纯指令无可观测信号" });
      continue;
    }

    assertions.push({
      id: aid,
      trigger: text.slice(0, 80),
      expected: observableSignal.value,
      observable_signal: observableSignal,
      category,
      lineno: inst.lineno,
    });
  }

  // 阶段 2：合成 prompt（3-5 个）
  const prompts = [];
  const happyAssertions = assertions.filter((a) => a.category === "happy_path");
  const failureAssertions = assertions.filter((a) => a.category === "failure");
  const boundaryAssertions = assertions.filter((a) => a.category === "boundary");

  // 每个 prompt 关联 1-3 条 assertion
  function makePrompt(id, category, catAssertions, promptText) {
    if (catAssertions.length === 0) return null;
    const selected = catAssertions.slice(0, 3);
    const checks = selected
      .filter((a) => a.observable_signal)
      .map((a) => ({
        op: a.observable_signal.type,
        value: a.observable_signal.value,
      }));
    if (checks.length === 0) return null;
    return {
      id,
      category,
      prompt: promptText,
      assertion_ids: selected.map((a) => a.id),
      checks,
    };
  }

  // happy_path prompt
  const p1 = makePrompt("TP1", "happy_path", happyAssertions, "提供一个正常的 skill 路径，执行排查流程");
  if (p1) prompts.push(p1);

  // failure prompt
  const p2 = makePrompt("TP2", "failure", failureAssertions, "提供一个不存在的 skill 路径，测试错误处理");
  if (p2) prompts.push(p2);

  // boundary prompts
  const p3 = makePrompt("TP3", "boundary", boundaryAssertions, "提供一个边界条件 skill，测试边界处理");
  if (p3) prompts.push(p3);

  // 补充 prompt 如果少于 3 个
  if (prompts.length < 3 && assertions.length > 0) {
    const remaining = assertions.filter(
      (a) => !prompts.some((p) => p.assertion_ids.includes(a.id))
    );
    if (remaining.length > 0) {
      const p4 = makePrompt(`TP${prompts.length + 1}`, "boundary", remaining, "补充测试用例");
      if (p4) prompts.push(p4);
    }
  }

  // 阶段 3：自检
  let checksPassed = true;
  if (prompts.length === 0) {
    checksPassed = false;
  }
  const hasHappy = prompts.some((p) => p.category === "happy_path");
  const hasFailure = prompts.some((p) => p.category === "failure");
  if (!hasHappy || !hasFailure) {
    checksPassed = false;
  }
  const allChecksNonEmpty = prompts.every((p) => p.checks.length > 0);
  if (!allChecksNonEmpty) {
    checksPassed = false;
  }

  // 最多重试 2 轮
  if (!checksPassed) {
    // 简单重试：强制补齐 happy_path + failure
    if (!hasHappy && happyAssertions.length > 0) {
      const px = makePrompt(`TP${prompts.length + 1}`, "happy_path", happyAssertions, "补充正常流程测试");
      if (px) prompts.push(px);
    }
    if (!hasFailure && failureAssertions.length > 0) {
      const px = makePrompt(`TP${prompts.length + 1}`, "failure", failureAssertions, "补充失败流程测试");
      if (px) prompts.push(px);
    }
    // 重新检查
    checksPassed = prompts.length > 0 &&
      prompts.some((p) => p.category === "happy_path") &&
      prompts.some((p) => p.category === "failure") &&
      prompts.every((p) => p.checks.length > 0);
  }

  if (!checksPassed) {
    // 写空数组
    writeFileSync(testPromptsPath, "[]\n");
    out({
      action: "generated",
      prompts: [],
      untestable,
      checks_passed: false,
    });
    return;
  }

  writeFileSync(testPromptsPath, JSON.stringify(prompts, null, 2) + "\n");

  out({
    action: "generated",
    prompts,
    untestable,
    checks_passed: true,
  });
}

// ── arg parser ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        result[arg] = next;
        i += 2;
      } else {
        result[arg] = true;
        i++;
      }
    } else {
      i++;
    }
  }
  return result;
}

// ── main ─────────────────────────────────────────────────────────────────────

const subcommand = process.argv[2];
const args = parseArgs(process.argv.slice(3));

switch (subcommand) {
  case "generate":
    cmdGenerate(args);
    break;
  default:
    fail(`未知子命令：${subcommand || "(无)"}。用法：test-prompt-gen.mjs generate [选项]`);
}
