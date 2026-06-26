#!/usr/bin/env node
/**
 * fix-loop.mjs — 步骤 8 机械部分脚本化
 * 子命令：init / rank / health / rollback
 *
 * I/O 契约见 improvement-spec-e2-瘦身.md 模块 A
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import crypto from "node:crypto";

// ── helpers ──────────────────────────────────────────────────────────────────

function fail(msg, code = 1) {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
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

import fs from "node:fs";

function isStdinPath(p) {
  return p === "/dev/stdin" || p === "/proc/self/fd/0" || p === "\\.\pipe\stdin";
}

function readJsonInput(argPath) {
  if (argPath && !isStdinPath(argPath)) return JSON.parse(readFileSync(resolve(argPath), "utf-8"));
  return JSON.parse(readStdinSync());
}

function gitAvailable() {
  try {
    execSync("git --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function inGitRepo(dir) {
  try {
    execSync(`git -C "${dir}" rev-parse --is-inside-work-tree`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── init ─────────────────────────────────────────────────────────────────────

function cmdInit(args) {
  const skillDir = resolve(args["--skill-dir"]);
  if (!existsSync(skillDir)) fail(`skill 目录不存在：${skillDir}`);

  const ts = timestamp();

  if (gitAvailable() && inGitRepo(skillDir)) {
    // git 模式
    let branchName = `auto-fix/${ts}`;
    // 检查分支是否已存在，追加序号
    let suffix = 1;
    while (true) {
      try {
        execSync(`git -C "${skillDir}" rev-parse --verify "${branchName}"`, { stdio: "pipe" });
        suffix++;
        branchName = `auto-fix/${ts}_${suffix}`;
      } catch {
        break; // 分支不存在，可用
      }
    }

    const baseSha = execSync(`git -C "${skillDir}" rev-parse HEAD`, { stdio: "pipe" })
      .toString().trim();

    try {
      execSync(`git -C "${skillDir}" checkout -b "${branchName}"`, { stdio: "pipe" });
    } catch (e) {
      fail(`创建分支失败：${e.message}`, 2);
    }

    out({
      mode: "git",
      base_sha: baseSha,
      snapshot_path: null,
      timestamp: ts,
      branch: branchName,
    });
  } else {
    // snapshot 模式
    const snapshotDir = join(skillDir, ".fix-loop-snapshots");
    if (!existsSync(snapshotDir)) mkdirSync(snapshotDir, { recursive: true });

    const snapshotPath = join(snapshotDir, `${ts}.tar.gz`);

    try {
      // 创建 tar 快照
      execSync(`tar -czf "${snapshotPath}" -C "${skillDir}" .`, { stdio: "pipe" });
    } catch (e) {
      fail(`快照创建失败：${e.message}`, 2);
    }

    // 计算 checksum
    const snapshotContent = readFileSync(snapshotPath);
    const checksum = crypto.createHash("sha256").update(snapshotContent).digest("hex");

    // 写入 manifest（记录当前目录中的文件列表）
    const manifestPath = join(snapshotDir, `${ts}.manifest`);
    try {
      const files = execSync(`find . -type f ! -path './.fix-loop-snapshots/*'`, {
        cwd: skillDir, stdio: "pipe",
      }).toString().trim().split("\n").filter(Boolean);
      writeFileSync(manifestPath, JSON.stringify(files, null, 2));
    } catch (e) {
      fail(`清单写入失败：${e.message}`, 2);
    }

    // 存储 checksum 到 sidecar 文件
    writeFileSync(`${snapshotPath}.checksum`, checksum);

    out({
      mode: "snapshot",
      base_sha: null,
      snapshot_path: snapshotPath,
      timestamp: ts,
      branch: null,
    });
  }
}

// ── rank ─────────────────────────────────────────────────────────────────────

const CATEGORY_WEIGHT = { B: 1, C: 1, D: 2, E: 3, F: 3, G: 3, H: 3, I: 3, R: 3 };
const CHANGE_TYPE_WEIGHT = { add: 0, modify: 1 };

function cmdRank(args) {
  const budget = parseInt(args["--budget"] || "5", 10);

  // 读取输入
  let raw;
  const itemsPath = args["--items"];
  if (itemsPath && !isStdinPath(itemsPath)) {
    raw = readFileSync(resolve(itemsPath), "utf-8");
  } else {
    raw = readStdinSync();
  }

  let items;
  try {
    items = JSON.parse(raw);
  } catch {
    fail("输入 JSON 解析失败");
  }

  if (!Array.isArray(items)) fail("输入必须是 JSON 数组");

  const skipped = [];
  const valid = [];

  for (const item of items) {
    if (!item.category) {
      process.stderr.write(`警告：item "${item.id || "?"}" 缺 category，跳过\n`);
      skipped.push(item);
      continue;
    }
    valid.push({
      id: item.id,
      category: item.category,
      change_type: item.change_type || "modify",
      change_lines: item.change_lines ?? 4,
    });
  }

  // 三层稳定排序（主键最后排）
  valid.sort((a, b) => {
    const cl = (a.change_lines <= 3 ? 0 : 1) - (b.change_lines <= 3 ? 0 : 1);
    if (cl !== 0) return cl;
    const ct = (CHANGE_TYPE_WEIGHT[a.change_type] ?? 1) - (CHANGE_TYPE_WEIGHT[b.change_type] ?? 1);
    if (ct !== 0) return ct;
    return (CATEGORY_WEIGHT[a.category] ?? 3) - (CATEGORY_WEIGHT[b.category] ?? 3);
  });

  const queue = valid.slice(0, budget);
  const budgetExceeded = valid.slice(budget);
  const lowRiskBatch = queue.filter((i) => i.change_type === "add");
  const highRisk = queue.filter((i) => i.change_type !== "add");

  out({
    queue,
    low_risk_batch: lowRiskBatch,
    high_risk: highRisk,
    budget_exceeded: budgetExceeded,
  });
}

// ── health ───────────────────────────────────────────────────────────────────

function cmdHealth(args) {
  const type = args["--type"];
  if (!type || !["small", "large"].includes(type)) {
    fail("必须指定 --type small 或 --type large");
  }

  const applicableTotal = type === "small" ? 9 : 31;

  // 读取输入
  let raw;
  const tablePath = args["--table"];
  if (tablePath && !isStdinPath(tablePath)) {
    raw = readFileSync(resolve(tablePath), "utf-8");
  } else {
    raw = readStdinSync();
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    fail("输入 JSON 解析失败");
  }

  const table = input.table;
  if (!Array.isArray(table)) fail("输入必须含 table 数组");

  const sumApplicable = table.reduce((s, r) => s + r.applicable, 0);
  if (sumApplicable !== applicableTotal) {
    fail(`类别计数与 type 不符：sum(applicable)=${sumApplicable}，期望 ${applicableTotal}`);
  }

  const passedTotal = table.reduce((s, r) => s + r.passed, 0);
  const score = Math.round((passedTotal / applicableTotal) * 100);

  const resultTable = table.map((r) => ({
    category: r.category,
    applicable: r.applicable,
    passed: r.passed,
    status: r.applicable === r.passed ? "✅" : "❌",
  }));

  out({
    score,
    applicable_total: applicableTotal,
    passed_total: passedTotal,
    table: resultTable,
  });
}

// ── rollback ─────────────────────────────────────────────────────────────────

function cmdRollback(args) {
  const mode = args["--mode"];
  const skillDir = resolve(args["--skill-dir"]);
  const baseSha = args["--base-sha"];
  const snapshotPath = args["--snapshot-path"];
  const branch = args["--branch"];

  if (!mode || !["git", "snapshot"].includes(mode)) {
    fail("必须指定 --mode git 或 --mode snapshot", 2);
  }
  if (!existsSync(skillDir)) fail(`skill 目录不存在：${skillDir}`, 2);

  if (mode === "git") {
    if (!baseSha) fail("git 模式必须指定 --base-sha", 2);
    // 检查 base_sha 是否存在
    try {
      execSync(`git -C "${skillDir}" cat-file -t "${baseSha}"`, { stdio: "pipe" });
    } catch {
      fail(`base_sha 不存在：${baseSha}`, 2);
    }

    try {
      execSync(`git -C "${skillDir}" reset --hard "${baseSha}"`, { stdio: "pipe" });
    } catch (e) {
      fail(`git reset 失败：${e.message}`, 2);
    }

    // 清理分支（如果传了 branch 参数）
    if (branch) {
      try {
        execSync(`git -C "${skillDir}" branch -D "${branch}"`, { stdio: "pipe" });
      } catch {
        // 分支清理失败不阻断
      }
    }

    out({ rolled_back: true, verified: true });
  } else {
    // snapshot 模式
    if (!snapshotPath) fail("snapshot 模式必须指定 --snapshot-path", 2);
    if (!existsSync(snapshotPath)) fail(`快照文件不存在：${snapshotPath}`, 2);

    // checksum 校验
    const checksumFile = `${snapshotPath}.checksum`;
    if (!existsSync(checksumFile)) {
      fail("快照 checksum 文件缺失", 2);
    }
    const expectedChecksum = readFileSync(checksumFile, "utf-8").trim();
    const actualChecksum = crypto
      .createHash("sha256")
      .update(readFileSync(snapshotPath))
      .digest("hex");

    if (expectedChecksum !== actualChecksum) {
      out({ rolled_back: false, verified: false, reason: "checksum mismatch" });
      fail("checksum 校验失败，快照可能被篡改", 2);
    }

    // 读取 manifest
    const manifestPath = snapshotPath.replace(/\.tar\.gz$/, ".manifest");
    if (!existsSync(manifestPath)) {
      out({ rolled_back: false, verified: false, reason: "manifest 缺失" });
      fail("快照清单缺失，需手动确认删除范围", 2);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    // 仅删除 manifest 中的文件
    for (const relPath of manifest) {
      const fullPath = join(skillDir, relPath);
      if (existsSync(fullPath)) {
        try {
          execSync(`rm -f "${fullPath}"`, { stdio: "pipe" });
        } catch {
          // 单文件删除失败不阻断
        }
      }
    }

    // 解压快照
    try {
      execSync(`tar -xzf "${snapshotPath}" -C "${skillDir}"`, { stdio: "pipe" });
    } catch (e) {
      fail(`快照解压失败：${e.message}`, 2);
    }

    out({ rolled_back: true, verified: true });
  }
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
  case "init":
    cmdInit(args);
    break;
  case "rank":
    cmdRank(args);
    break;
  case "health":
    cmdHealth(args);
    break;
  case "rollback":
    cmdRollback(args);
    break;
  default:
    fail(`未知子命令：${subcommand || "(无)"}。用法：fix-loop.mjs <init|rank|health|rollback> [选项]`);
}
