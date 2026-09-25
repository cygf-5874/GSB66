// check.mjs 是 notifybus 审查题的**固定验收程序**。
//
// ⚠️ 不要修改本文件。它只校验 review/REVIEW.md 的交付格式、可判定性、对 README
// 「对外保证」的覆盖自洽，以及被审查源文件的完整性（SHA-256 基线）；结论「是否
// 正确」由人按 README 保证逐条复核。
//
// 10 个场景分四组：
//
//   format    3：交付物存在且章节齐全 / 结论清单形状（≥6 条、四列齐全）/ 无模糊措辞
//   evidence  3：缺陷位置指向真实文件:行号 / 最小复现可照抄 / 实际输出可判定
//   coverage  2：结论编号合法且覆盖 ≥6 条不同保证 / 保证判定表齐全且与结论自洽
//   integrity 2：不可变文件 SHA-256 与基线一致 / 未新增源码文件
//
// 用法：
//
//   node check/check.mjs                    # 跑全部场景
//   node check/check.mjs -list              # 列出全部场景
//   node check/check.mjs --only coverage    # 只跑一组（可用逗号并列多组）
//
// 判据全程确定性：只读文件、比对 SHA-256，不依赖墙钟与机器速度，**单进程**跑通
// （不使用 child_process / worker_threads / 网络）。
// 失败不早退：一个场景失败也继续跑完其余场景，末尾统一打印「结果：通过 x/N」。

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

// baseline 是「不许被改」的文件的 SHA-256 基线：<相对路径>=<sha256>。
// 计算前会去掉所有 \r，因此与换行风格（LF/CRLF）无关。
const baseline = {
  'index.js': 'bafce4923166fb6042ae4fe2e6b7c3c0e6e8df30446696d3e9660d3850b6875a',
  'package.json': 'd392fe5b0bc50cd45fba5d4777f62d755717387f76937930bb26c1e36bc2bdde',
  'test/notifybus.test.mjs': 'a818ec7c807802433656a6bb0ae6016ba624254bfcee60622f92b971f1a0b43b',
};

// 允许存在的 .js / .mjs 文件（其余一律算「新增源码文件」）。
const allowedSources = new Set([
  'index.js',
  'test/notifybus.test.mjs',
]);

// 被审查的源文件（缺陷位置必须落在这些文件里）。
const sourceFiles = ['index.js', 'test/notifybus.test.mjs'];

const bannedWords = [
  '可能有风险', '建议关注', '看起来', '或许', '也许', '大概',
  '疑似', '需要注意', '可能存在问题', '有待', '不太对', '可能有问题',
];

const placeholders = ['TODO', '待补', '待定', '……'];

const reproKeywords = [
  'node', '--input-type', '--test', 'import', 'emit(', 'NotifyBus',
  'repro', '.mjs', 'mjs',
];

const concreteTokens = [
  'TypeError', 'RangeError', 'NotifyError', 'throw', '抛', '溢出', '栈',
  'undefined', 'null', '泄漏', '计数', '调用', '次', '条', '实际', '期望',
];

const locRe = /([A-Za-z0-9_./\-]+\.(?:mjs|js))\s*(?::|：|第)?\s*(\d+)/;

// ------------------------------------------------------------------ scenarios

const scenarios = [
  // ---------------- format ----------------
  {
    group: 'format',
    name: 'format/review-exists',
    run: (r) => {
      if (!r.exists) {
        return '期望=review/REVIEW.md 存在且含「保证判定」「结论清单」两节 实际=文件不存在';
      }
      if (!hasHeading(r.raw, '判定')) {
        return '期望=REVIEW.md 含「保证判定」一节 实际=未找到';
      }
      if (!hasHeading(r.raw, '结论')) {
        return '期望=REVIEW.md 含「结论」一节 实际=未找到';
      }
      if (completeRows(r.concl) === 0) {
        return '期望=结论清单至少给出 1 条四列齐全的结论 实际=0 条';
      }
      return '';
    },
  },
  {
    group: 'format',
    name: 'format/table-shape',
    run: (r) => {
      const gate = requireConcl(r);
      if (gate) return gate;
      if (r.concl.length < 6) {
        return `期望=结论清单 ≥6 条数据行 实际=${r.concl.length} 条`;
      }
      for (let i = 0; i < r.concl.length; i += 1) {
        const row = r.concl[i];
        if (row.length < 4) {
          return `期望=第 ${i + 1} 行有 4 列 实际=${row.length} 列`;
        }
        for (let c = 0; c < 4; c += 1) {
          if (row[c] === '') {
            return `期望=第 ${i + 1} 行第 ${c + 1} 列非空 实际=空`;
          }
        }
      }
      return '';
    },
  },
  {
    group: 'format',
    name: 'format/no-vague',
    run: (r) => {
      const gate = requireConcl(r);
      if (gate) return gate;
      for (const w of bannedWords) {
        if (r.raw.includes(w)) {
          return `期望=不出现无法核对的措辞 实际=出现「${w}」`;
        }
      }
      return '';
    },
  },

  // ---------------- evidence ----------------
  {
    group: 'evidence',
    name: 'evidence/location',
    run: (r) => {
      const gate = requireConcl(r);
      if (gate) return gate;
      const lineCount = new Map();
      for (const f of sourceFiles) {
        const n = countLines(join(ROOT, f));
        lineCount.set(f, n);
        lineCount.set(f.split('/').pop(), n);
      }
      for (let i = 0; i < r.concl.length; i += 1) {
        const row = r.concl[i];
        if (row.length < 2) {
          return `期望=第 ${i + 1} 行有「缺陷位置」列 实际=列数不足`;
        }
        const loc = row[1];
        const m = locRe.exec(loc);
        if (m === null) {
          return `期望=第 ${i + 1} 行「缺陷位置」写成 文件名:行号（如 index.js:104） 实际=「${loc}」`;
        }
        const base = m[1].split('/').pop();
        const total = lineCount.get(m[1]) !== undefined ? lineCount.get(m[1]) : lineCount.get(base);
        if (total === undefined) {
          return `期望=第 ${i + 1} 行「缺陷位置」指向 index.js 或 test/notifybus.test.mjs 实际=指向「${m[1]}」`;
        }
        const line = Number.parseInt(m[2], 10);
        if (!(line >= 1 && line <= total)) {
          return `期望=第 ${i + 1} 行行号落在 1..${total} 实际=${line}`;
        }
      }
      return '';
    },
  },
  {
    group: 'evidence',
    name: 'evidence/repro',
    run: (r) => {
      const gate = requireConcl(r);
      if (gate) return gate;
      for (let i = 0; i < r.concl.length; i += 1) {
        const row = r.concl[i];
        if (row.length < 3) {
          return `期望=第 ${i + 1} 行有「最小复现」列 实际=列数不足`;
        }
        const cell = row[2];
        if (runeCount(cell) < 8) {
          return `期望=第 ${i + 1} 行「最小复现」给出可照抄的命令 实际=「${cell}」过短`;
        }
        for (const w of placeholders) {
          if (cell.includes(w)) {
            return `期望=第 ${i + 1} 行「最小复现」是具体命令 实际=出现占位词「${w}」`;
          }
        }
        if (!/[0-9]/.test(cell)) {
          return `期望=第 ${i + 1} 行「最小复现」含具体次数/深度（具体数字） 实际=「${cell}」无数字`;
        }
        if (!containsAny(cell, reproKeywords)) {
          return `期望=第 ${i + 1} 行「最小复现」是可执行的 Node 命令 实际=「${cell}」`;
        }
      }
      return '';
    },
  },
  {
    group: 'evidence',
    name: 'evidence/observed',
    run: (r) => {
      const gate = requireConcl(r);
      if (gate) return gate;
      for (let i = 0; i < r.concl.length; i += 1) {
        const row = r.concl[i];
        if (row.length < 4) {
          return `期望=第 ${i + 1} 行有「实际输出」列 实际=列数不足`;
        }
        const cell = row[3];
        if (runeCount(cell) < 8) {
          return `期望=第 ${i + 1} 行「实际输出」给出具体现象 实际=「${cell}」过短`;
        }
        for (const w of placeholders) {
          if (cell.includes(w)) {
            return `期望=第 ${i + 1} 行「实际输出」是具体现象 实际=出现占位词「${w}」`;
          }
        }
        if (!/[0-9]/.test(cell) && !containsAny(cell, concreteTokens)) {
          return `期望=第 ${i + 1} 行「实际输出」可判定（数值 / 错误类型等） 实际=「${cell}」`;
        }
      }
      return '';
    },
  },

  // ---------------- coverage ----------------
  {
    group: 'coverage',
    name: 'coverage/guarantees',
    run: (r) => {
      const gate = requireConcl(r);
      if (gate) return gate;
      const ids = new Set();
      for (let i = 0; i < r.concl.length; i += 1) {
        const row = r.concl[i];
        if (row.length < 1 || row[0] === '') {
          return `期望=第 ${i + 1} 行「保证编号」非空 实际=空`;
        }
        const id = Number.parseInt(row[0].trim(), 10);
        if (!(Number.isInteger(id) && id >= 1 && id <= 7)) {
          return `期望=第 ${i + 1} 行「保证编号」是 1~7 的整数 实际=「${row[0]}」`;
        }
        ids.add(id);
      }
      if (ids.size < 6) {
        return `期望=结论合计覆盖 README 里 ≥6 条不同的保证 实际=${ids.size} 条${sortedIDs(ids)}`;
      }
      return '';
    },
  },
  {
    group: 'coverage',
    name: 'coverage/verdicts',
    run: (r) => {
      const gate = requireConcl(r);
      if (gate) return gate;
      for (let g = 1; g <= 7; g += 1) {
        const v = r.verdicts.get(g);
        if (v === undefined) {
          return `期望=「保证判定」表逐条列出第 ${g} 条 实际=缺失`;
        }
        if (v === 'INVALID') {
          return `期望=第 ${g} 条判定只能是「违反」或「未违反」 实际=无法识别`;
        }
        const hasRow = r.concl.some((row) => Number.parseInt(row[0].trim(), 10) === g);
        if (v === 'VIOLATED' && !hasRow) {
          return `期望=第 ${g} 条判为「违反」时结论清单里有该编号条目 实际=没有`;
        }
        if (v === 'OK' && hasRow) {
          return `期望=第 ${g} 条判为「未违反」时结论清单里不出现该编号 实际=出现`;
        }
      }
      return '';
    },
  },

  // ---------------- integrity ----------------
  {
    group: 'integrity',
    name: 'integrity/immutable-files',
    run: (r) => {
      const gate = requireConcl(r);
      if (gate) return gate;
      const names = Object.keys(baseline).sort();
      for (const rel of names) {
        const got = sha256Of(join(ROOT, rel));
        if (got === null) {
          return `期望=${rel} 存在且保持原样 实际=读取失败`;
        }
        if (got !== baseline[rel]) {
          return `期望=${rel} 保持原样（SHA-256=${baseline[rel].slice(0, 12)}） 实际=SHA-256=${got.slice(0, 12)}`;
        }
      }
      return '';
    },
  },
  {
    group: 'integrity',
    name: 'integrity/no-new-source',
    run: (r) => {
      const gate = requireConcl(r);
      if (gate) return gate;
      const extra = [];
      walk(ROOT, (rel) => {
        if (!/\.(mjs|js)$/.test(rel)) return;
        if (allowedSources.has(rel)) return;
        if (rel.startsWith('check/')) return;
        extra.push(rel);
      });
      if (extra.length > 0) {
        extra.sort();
        return `期望=除 index.js / test/notifybus.test.mjs / check/ 外无 .js 或 .mjs 文件 实际=多出 ${JSON.stringify(extra)}`;
      }
      return '';
    },
  },
];

// ------------------------------------------------------------------ main

function main() {
  const argv = process.argv.slice(2);
  let only = '';
  let list = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-list' || a === '--list') {
      list = true;
    } else if (a === '--only') {
      only = argv[i + 1] || '';
      i += 1;
    } else if (a.startsWith('--only=')) {
      only = a.slice('--only='.length);
    } else if (a === '-h' || a === '--help') {
      console.log('用法：node check/check.mjs [-list] [--only <组名>]');
      return;
    } else {
      console.log(`未知参数 ${a}（可用：-list / --only <组名>）`);
      process.exitCode = 2;
      return;
    }
  }

  if (list) {
    for (const sc of scenarios) {
      console.log(sc.name);
    }
    return;
  }

  const groups = new Set(['format', 'evidence', 'coverage', 'integrity']);
  const want = new Set();
  if (only.trim() !== '') {
    for (const g of only.split(',')) {
      const name = g.trim();
      if (name === '') continue;
      if (!groups.has(name)) {
        console.log(`未知分组 "${name}"（可选：format / evidence / coverage / integrity）`);
        process.exitCode = 2;
        return;
      }
      want.add(name);
    }
  }

  const r = parseReview(ROOT);

  let total = 0;
  let passed = 0;
  for (const sc of scenarios) {
    if (want.size > 0 && !want.has(sc.group)) continue;
    total += 1;
    let errMsg = '';
    try {
      errMsg = sc.run(r);
    } catch (e) {
      errMsg = `检查过程抛异常：${e && e.message ? e.message : e}`;
    }
    if (errMsg === '') {
      passed += 1;
      console.log(`PASS ${sc.name}`);
    } else {
      console.log(`FAIL ${sc.name}  ${errMsg}`);
    }
  }

  if (total === 0) {
    console.log(`没有匹配的场景（--only ${only}）`);
    process.exitCode = 2;
    return;
  }

  console.log(`结果：通过 ${passed}/${total}`);
  if (passed !== total) {
    process.exitCode = 1;
  }
}

// ------------------------------------------------------------------ review

function parseReview(root) {
  const review = {
    exists: false,
    raw: '',
    concl: [],
    verdicts: new Map(),
  };
  let text;
  try {
    text = readFileSync(join(root, 'review', 'REVIEW.md'), 'utf8');
  } catch {
    return review;
  }
  review.exists = true;
  review.raw = text;

  let section = 0;
  let conclSec = '';
  let verdictSec = '';
  for (const line of review.raw.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim();
    if (t.startsWith('#')) {
      if (t.includes('判定')) {
        section = 2;
      } else if (t.includes('结论')) {
        section = 1;
      } else {
        section = 0;
      }
    }
    if (section === 1) conclSec += line + '\n';
    else if (section === 2) verdictSec += line + '\n';
  }

  review.concl = parseRows(conclSec);
  for (const row of parseRows(verdictSec)) {
    if (row.length < 1) continue;
    const id = Number.parseInt(row[0].trim(), 10);
    if (!(Number.isInteger(id) && id >= 1 && id <= 7)) continue;
    const cell = row.length >= 2 ? row[1] : '';
    let verdict;
    if (cell.includes('未违反') || cell.includes('不违反')) {
      verdict = 'OK';
    } else if (cell.includes('违反')) {
      verdict = 'VIOLATED';
    } else {
      verdict = 'INVALID';
    }
    review.verdicts.set(id, verdict);
  }
  return review;
}

// parseRows 从一段 markdown 里取出表格数据行（去掉表头、分隔行与空行）。
function parseRows(section) {
  const rows = [];
  for (const line of section.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const parts = t.split('|');
    if (parts.length < 2) continue;
    const cells = [];
    for (let i = 1; i < parts.length - 1; i += 1) {
      cells.push(parts[i].trim());
    }
    if (cells.length === 0) continue;
    let allEmpty = true;
    let allSep = true;
    for (const c of cells) {
      if (c !== '') allEmpty = false;
      if (c.replace(/[-: ]/g, '') !== '') allSep = false;
    }
    if (allEmpty || allSep) continue;
    const joined = cells.join('');
    if (
      joined.includes('保证编号') || joined.includes('缺陷位置') ||
      joined.includes('最小复现') || joined.includes('实际输出') ||
      joined.includes('判定') || joined.includes('复现命令') ||
      joined.includes('可观察')
    ) {
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

function requireConcl(r) {
  if (!r.exists) {
    return '期望=review/REVIEW.md 存在 实际=文件不存在';
  }
  if (completeRows(r.concl) === 0) {
    return '期望=review/REVIEW.md 已按 review/CHECKLIST.md 写出结论（结论清单至少 1 条四列齐全） 实际=0 条';
  }
  return '';
}

function completeRows(rows) {
  let n = 0;
  for (const row of rows) {
    if (row.length >= 4 && row[0] !== '' && row[1] !== '' && row[2] !== '' && row[3] !== '') {
      n += 1;
    }
  }
  return n;
}

// ------------------------------------------------------------------ util

function hasHeading(text, kw) {
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim();
    if (t.startsWith('#') && t.includes(kw)) return true;
  }
  return false;
}

function containsAny(s, subs) {
  for (const sub of subs) {
    if (s.includes(sub)) return true;
  }
  return false;
}

function runeCount(s) {
  return [...s].length;
}

function sortedIDs(ids) {
  return `[${[...ids].sort((a, b) => a - b).join(' ')}]`;
}

function countLines(p) {
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch {
    return 0;
  }
  if (raw.length === 0) return 0;
  const n = (raw.match(/\n/g) || []).length;
  return raw.endsWith('\n') ? n : n + 1;
}

// sha256Of 计算文件内容的 SHA-256；先去掉 \r，使结果与换行风格无关。
function sha256Of(p) {
  let raw;
  try {
    raw = readFileSync(p);
  } catch {
    return null;
  }
  const norm = Buffer.from(raw.filter((b) => b !== 0x0d));
  return createHash('sha256').update(norm).digest('hex');
}

function walk(dir, onFile) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === '.git' || name === 'node_modules') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, onFile);
    } else if (st.isFile()) {
      onFile(relative(ROOT, full).split('\\').join('/'));
    }
  }
}

main();
