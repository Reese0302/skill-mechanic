#!/usr/bin/env node
/**
 * log-writer.mjs — 日志写入（TSV + JSON）
 * 子命令：tsv / json
 *
 * I/O 契约见 improvement-spec-e2-瘦身.md 模块 B
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import fs from "node:fs";

// ── helpers ──────────────────────────────────────────────────────────────────

function fail(msg, code = 2) {
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

// ── TSV 字段定义 ─────────────────────────────────────────────────────────────

const TSV_FIELDS = [
  "timestamp", "skill", "health_score", "auto_fixed", "need_decision",
  "suggest_add", "mechanical_dropped", "drop_challenged", "drop_restored",
  "test_pass_rate", "note",
];

const TSV_FILE = join(
  process.env.HOME || process.env.USERPROFILE || ".",
  ".claude", "skills", "skill-mechanic", "mechanic-log.tsv",
);

// ── tsv ──────────────────────────────────────────────────────────────────────

function cmdTsv(args) {
  let row;
  try {
    row = readJsonInput(args["--row"]);
  } catch (e) {
    fail(`row JSON 解析失败：${e.message}`);
  }

  // 检查缺失字段
  const missing = TSV_FIELDS.filter((f) => row[f] === undefined);
  if (missing.length > 0) {
    fail(`缺失字段：${missing.join(", ")}`);
  }

  // 构建 TSV 行（字段值中的制表符/换行符替换为空格）
  const line = TSV_FIELDS.map((f) => {
    let v = String(row[f]);
    v = v.replace(/[\t\n\r]/g, " ");
    return v;
  }).join("\t");

  // 确保目录存在
  const dir = dirname(TSV_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // 如果文件不存在，先写表头
  if (!existsSync(TSV_FILE)) {
    writeFileSync(TSV_FILE, TSV_FIELDS.join("\t") + "\n");
  } else {
    // 检查现有表头列数
    const firstLine = readFileSync(TSV_FILE, "utf-8").split("\n")[0];
    const existingCols = firstLine.split("\t").length;
    if (existingCols !== TSV_FIELDS.length) {
      // 备份并重建
      const backupPath = `${TSV_FILE}.bak.${Date.now()}`;
      writeFileSync(backupPath, readFileSync(TSV_FILE));
      writeFileSync(TSV_FILE, TSV_FIELDS.join("\t") + "\n");
      process.stderr.write(`警告：TSV 列数不匹配（${existingCols} vs ${TSV_FIELDS.length}），已备份到 ${backupPath} 并重建表头\n`);
    }
  }

  appendFileSync(TSV_FILE, line + "\n");

  out({
    appended: true,
    file: TSV_FILE,
    cols: TSV_FIELDS.length,
  });
}

// ── json ─────────────────────────────────────────────────────────────────────

const JSON_REQUIRED_FIELDS = [
  "timestamp", "file_metrics", "mechanical_findings", "v0_mechanical_dropped",
  "mixed_findings", "judgment_pass1_findings", "judgment_pass2_keep",
  "judgment_pass2_soften", "judgment_pass2_escalate", "judgment_pass2_drop",
  "v2_drop_challenged", "v2_drop_restored", "verifier_triggered",
  "verifier_dropped", "omission_sampled_sections", "omission_new_findings",
  "final_findings", "health_score",
];

function cmdJson(args) {
  let data;
  try {
    data = readJsonInput(args["--data"]);
  } catch (e) {
    fail(`data JSON 解析失败：${e.message}`);
  }

  // 检查缺失字段
  const missing = JSON_REQUIRED_FIELDS.filter((f) => data[f] === undefined);
  if (missing.length > 0) {
    fail(`缺失字段：${missing.join(", ")}`);
  }

  // 日志目录
  const logsDir = join(
    process.env.HOME || process.env.USERPROFILE || ".",
    ".claude", "skills", "skill-mechanic", "logs",
  );
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  // 文件名：{timestamp}.json，同名加序号
  let filename = `${data.timestamp}.json`;
  let filePath = join(logsDir, filename);
  let suffix = 2;
  while (existsSync(filePath)) {
    filename = `${data.timestamp}_${suffix}.json`;
    filePath = join(logsDir, filename);
    suffix++;
  }

  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");

  out({
    written: true,
    file: filePath,
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
  case "tsv":
    cmdTsv(args);
    break;
  case "json":
    cmdJson(args);
    break;
  default:
    fail(`未知子命令：${subcommand || "(无)"}。用法：log-writer.mjs <tsv|json> [选项]`);
}
