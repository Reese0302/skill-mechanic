#!/usr/bin/env node
/**
 * skip-record.mjs — 跳过记录过滤与写入
 * 子命令：filter / write
 *
 * I/O 契约见 improvement-spec-e2-瘦身.md 模块 B
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fs from "node:fs";

// ── helpers ──────────────────────────────────────────────────────────────────

function fail(msg, code = 1) {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function readStdinSync() {
  const chunks = [];
  const fd = process.stdin.fd;
  const buf = Buffer.alloc(65536);
  try {
    let n;
    while ((n = fs.readSync(fd, buf)) > 0) chunks.push(buf.slice(0, n).toString("utf-8"));
  } catch { /* EOF or pipe closed */ }
  return chunks.join("");
}

function isStdinPath(p) {
  return p === "/dev/stdin" || p === "/proc/self/fd/0" || p === "\\.\pipe\stdin";
}

function readJsonInput(argPath) {
  if (argPath && !isStdinPath(argPath)) return JSON.parse(readFileSync(resolve(argPath), "utf-8"));
  return JSON.parse(readStdinSync());
}

// ── filter ───────────────────────────────────────────────────────────────────

function cmdFilter(args) {
  const findingsPath = args["--findings"];
  const skipRecordsPath = args["--skip-records"];

  if (!findingsPath) fail("必须指定 --findings");
  if (!skipRecordsPath) fail("必须指定 --skip-records");

  let findings;
  let skipRecords;
  try {
    findings = readJsonInput(findingsPath);
  } catch (e) {
    fail(`findings JSON 解析失败：${e.message}`);
  }
  try {
    skipRecords = readJsonInput(skipRecordsPath);
  } catch (e) {
    fail(`skip-records JSON 解析失败：${e.message}`);
  }

  if (!Array.isArray(findings)) fail("findings 必须是 JSON 数组");
  if (!Array.isArray(skipRecords)) fail("skip-records 必须是 JSON 数组");

  const removed = [];
  let invalidSkips = 0;
  const keepIndices = new Set(findings.map((_, i) => i));

  for (const skip of skipRecords) {
    // 无效 skip 记录：condition_id 和 quote 都缺失
    if (!skip.condition_id && !skip.quote) {
      invalidSkips++;
      continue;
    }

    for (let fi = 0; fi < findings.length; fi++) {
      if (!keepIndices.has(fi)) continue;

      const finding = findings[fi];
      let match = false;

      if (skip.condition_id && finding.condition_id === skip.condition_id) {
        if (skip.quote) {
          // 双向子串匹配
          const fQuote = finding.quote || "";
          const sQuote = skip.quote;
          if (fQuote.includes(sQuote) || sQuote.includes(fQuote)) {
            match = true;
          }
        } else {
          match = true;
        }
      }

      if (match) {
        keepIndices.delete(fi);
        removed.push({ title: finding.title, timestamp: skip.timestamp });
      }
    }
  }

  const filteredFindings = findings.filter((_, i) => keepIndices.has(i));

  out({
    filtered_findings: filteredFindings,
    removed,
    invalid_skips: invalidSkips,
  });
}

// ── write ────────────────────────────────────────────────────────────────────

function cmdWrite(args) {
  const skillDir = resolve(args["--skill-dir"]);
  const findingId = args["--finding-id"];
  const title = args["--title"];
  const conditionId = args["--condition-id"];
  const quote = args["--quote"];
  const reason = args["--reason"];

  if (!skillDir) fail("必须指定 --skill-dir", 2);
  if (!title) fail("必须指定 --title", 2);

  if (!existsSync(skillDir)) fail(`skill 目录不存在：${skillDir}`, 2);

  const mistakesPath = join(skillDir, "MISTAKES.md");

  // 截断 reason 和 quote 到 50 字
  let truncatedReason = false;
  let reasonText = reason || "用户选择不修复";
  if (reasonText.length > 50) {
    reasonText = reasonText.slice(0, 50) + "…";
    truncatedReason = true;
  }

  let quoteText = quote || "";
  if (quoteText.length > 50) {
    quoteText = quoteText.slice(0, 50) + "…";
  }

  const today = new Date().toISOString().slice(0, 10);

  const entry = `
## 📌 Issue: ${title} (${today})
### 1. The Error
${reasonText}
### 2. Root Cause
未分析
### 3. Fix
未修复
### 4. Lesson
用户选择不修复
### 5. 下次规则（decision: skip）
condition_id=${conditionId || "N/A"}, quote="${quoteText}"
`;

  if (!existsSync(mistakesPath)) {
    writeFileSync(mistakesPath, `# MISTAKES.md\n${entry}`);
  } else {
    appendFileSync(mistakesPath, entry);
  }

  out({
    written: true,
    file: mistakesPath,
    truncated_reason: truncatedReason,
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
  case "filter":
    cmdFilter(args);
    break;
  case "write":
    cmdWrite(args);
    break;
  default:
    fail(`未知子命令：${subcommand || "(无)"}。用法：skip-record.mjs <filter|write> [选项]`);
}
