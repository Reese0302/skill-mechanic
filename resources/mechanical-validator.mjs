#!/usr/bin/env node
/**
 * V0 机械校验层 — quote/lineno 脚本匹配
 *
 * 用途：在验证器调用前，用确定性脚本过滤掉形式错误的 findings
 * 输入：SKILL.md 全文 + findings JSON 数组
 * 输出：valid_findings / invalid_findings / stats
 *
 * 用法：
 *   node mechanical-validator.mjs <skill-md-path> <findings-json-path>
 *   echo '<findings-json>' | node mechanical-validator.mjs <skill-md-path>
 */

import { readFileSync } from 'fs';

const VALID_SEVERITIES = new Set(['high', 'medium', 'low']);

/**
 * 读取 SKILL.md 并按行分割（保留行号索引）
 */
function loadSkillMd(path) {
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  return { content, lines };
}

/**
 * 检查单条 finding 的形式完整性
 * 返回 { valid: boolean, reason?: string }
 */
function validateFinding(finding, skillLines) {
  // 1. 必填字段检查
  const requiredFields = ['condition_id', 'severity', 'confidence'];
  for (const field of requiredFields) {
    if (finding[field] === undefined || finding[field] === null || finding[field] === '') {
      return { valid: false, reason: `缺少必填字段: ${field}` };
    }
  }

  // 2. severity 枚举检查
  if (!VALID_SEVERITIES.has(finding.severity)) {
    return { valid: false, reason: `severity 不在允许枚举中: ${finding.severity}` };
  }

  // 3. confidence 范围检查
  if (typeof finding.confidence !== 'number' || finding.confidence < 0 || finding.confidence > 1) {
    return { valid: false, reason: `confidence 超出 0-1 范围: ${finding.confidence}` };
  }

  // 4. quote/lineno 存在性检查（如果有 evidence）
  const evidence = finding.evidence || finding;
  const quote = evidence.quote;
  const lineno = evidence.lineno;

  if (quote !== undefined && quote !== null && quote !== '') {
    if (lineno === undefined || lineno === null) {
      return { valid: false, reason: '有 quote 但缺少 lineno' };
    }

    // 行号范围检查
    const lineIdx = lineno - 1; // 转为 0-based 索引
    if (lineIdx < 0 || lineIdx >= skillLines.length) {
      return { valid: false, reason: `lineno ${lineno} 超出文件范围（共 ${skillLines.length} 行）` };
    }

    // quote 子串匹配检查
    const targetLine = skillLines[lineIdx];
    if (!targetLine.includes(quote)) {
      return { valid: false, reason: `quote 在第 ${lineno} 行未找到匹配: "${quote.substring(0, 50)}..."` };
    }
  }

  return { valid: true };
}

/**
 * 检查重复 findings（同一 quote + 同一 condition_id）
 */
function deduplicateFindings(findings) {
  const seen = new Map();
  const unique = [];
  const duplicates = [];

  for (const finding of findings) {
    const evidence = finding.evidence || finding;
    const quote = evidence.quote || '';
    const key = `${finding.condition_id}::${quote}`;

    if (seen.has(key)) {
      duplicates.push({
        ...finding,
        _duplicate_of: seen.get(key),
        _drop_reason: `重复 finding: 与第 ${seen.get(key)} 条相同 (condition_id=${finding.condition_id}, quote="${quote.substring(0, 30)}...")`
      });
    } else {
      seen.set(key, unique.length);
      unique.push(finding);
    }
  }

  return { unique, duplicates };
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('用法: node mechanical-validator.mjs <skill-md-path> [findings-json-path]');
    process.exit(1);
  }

  const skillPath = args[0];
  const { content, lines: skillLines } = loadSkillMd(skillPath);

  // 读取 findings：从文件或 stdin
  let findingsJson;
  if (args[1]) {
    findingsJson = readFileSync(args[1], 'utf-8');
  } else if (!process.stdin.isTTY) {
    // 从管道读取 stdin
    findingsJson = await new Promise((resolve) => {
      const chunks = [];
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (chunk) => chunks.push(chunk));
      process.stdin.on('end', () => resolve(chunks.join('')));
    });
  } else {
    console.error('用法: node mechanical-validator.mjs <skill-md-path> <findings-json-path>');
    console.error('或: cat findings.json | node mechanical-validator.mjs <skill-md-path>');
    process.exit(1);
  }

  let findings;
  try {
    const parsed = JSON.parse(findingsJson);
    // 支持两种格式：直接数组 或 { findings: [...] }
    findings = Array.isArray(parsed) ? parsed : (parsed.findings || []);
  } catch (e) {
    console.error(`JSON 解析失败: ${e.message}`);
    process.exit(1);
  }

  // 1. 去重
  const { unique, duplicates } = deduplicateFindings(findings);

  // 2. 逐条校验
  const validFindings = [];
  const invalidFindings = [...duplicates]; // 重复的直接进 invalid

  for (const finding of unique) {
    const result = validateFinding(finding, skillLines);
    if (result.valid) {
      validFindings.push(finding);
    } else {
      invalidFindings.push({
        ...finding,
        _drop_reason: result.reason
      });
    }
  }

  // 3. 输出
  const output = {
    valid_findings: validFindings,
    invalid_findings: invalidFindings,
    stats: {
      total: findings.length,
      valid: validFindings.length,
      invalid: invalidFindings.length,
      invalid_breakdown: {
        missing_fields: invalidFindings.filter(f => f._drop_reason?.includes('缺少必填字段')).length,
        invalid_severity: invalidFindings.filter(f => f._drop_reason?.includes('severity')).length,
        invalid_confidence: invalidFindings.filter(f => f._drop_reason?.includes('confidence')).length,
        quote_mismatch: invalidFindings.filter(f => f._drop_reason?.includes('quote')).length,
        lineno_out_of_range: invalidFindings.filter(f => f._drop_reason?.includes('超出文件范围')).length,
        duplicates: duplicates.length,
      }
    }
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
