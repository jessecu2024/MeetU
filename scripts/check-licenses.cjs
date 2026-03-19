#!/usr/bin/env node
// ============================================================
// 依赖许可证审计脚本
// 扫描所有 npm 依赖，报告 GPL/AGPL 许可证
// 用法: node scripts/check-licenses.js
// ============================================================

const { execSync } = require('child_process');

const FORBIDDEN = [
  'GPL-2.0',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-1.0',
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
];

const SAFE = [
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0',
  '0BSD', 'Unlicense', 'CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0',
  'BlueOak-1.0.0', 'Python-2.0', 'Artistic-2.0', 'Zlib',
];

console.log('🔍 扫描依赖许可证...\n');

try {
  const output = execSync(
    'npx license-checker --json --production',
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
  );

  const packages = JSON.parse(output);
  const issues = [];
  const warnings = [];
  let safeCount = 0;

  for (const [name, info] of Object.entries(packages)) {
    const license = (info.licenses || 'UNKNOWN').toString();

    // 处理 OR 双许可证：如果有任一安全许可可选，则视为安全
    const isOrLicense = /\bOR\b/i.test(license);
    const licenses = license.split(/[;,\s]+(?:AND|OR)\s+|[;,]/i).map(l => l.trim().replace(/[()]/g, ''));

    let hasForbidden = false;
    let hasSafe = false;
    let allSafe = true;

    for (const lic of licenses) {
      if (FORBIDDEN.some(f => lic.toUpperCase().includes(f.toUpperCase()))) {
        hasForbidden = true;
      }
      if (SAFE.some(s => lic.toUpperCase().includes(s.toUpperCase()))) {
        hasSafe = true;
      } else {
        allSafe = false;
      }
    }

    // OR 许可证：只要有一个安全选项可选即为安全
    if (isOrLicense && hasSafe) {
      safeCount++;
    } else if (hasForbidden) {
      issues.push({ name, license });
    } else if (!allSafe) {
      warnings.push({ name, license });
    } else {
      safeCount++;
    }
  }

  // Report
  console.log(`✅ 安全依赖: ${safeCount} 个\n`);

  if (warnings.length > 0) {
    console.log(`⚠️  需要人工审核的许可证 (${warnings.length} 个):`);
    for (const w of warnings) {
      console.log(`   ${w.name}: ${w.license}`);
    }
    console.log();
  }

  if (issues.length > 0) {
    console.log(`🚨 发现 GPL/AGPL 依赖 (${issues.length} 个):`);
    for (const i of issues) {
      console.log(`   ❌ ${i.name}: ${i.license}`);
    }
    console.log('\n⛔ 商业发布前必须移除以上 GPL/AGPL 依赖！');
    process.exit(1);
  } else {
    console.log('🎉 未发现 GPL/AGPL 依赖，许可证审计通过！');
    process.exit(0);
  }
} catch (err) {
  if (err.status === 1) {
    // license-checker exited with error
    console.error('❌ 许可证检查发现问题，请查看上方输出');
    process.exit(1);
  }
  console.error('⚠️  无法运行许可证检查，请先安装依赖:');
  console.error('   npm install');
  console.error('   npx license-checker --version');
  process.exit(1);
}
