# 代码审查结论 · notifybus

> 按 `review/CHECKLIST.md` 的格式填写。复现命令均在仓库根目录执行（Node v22.11.0 实测）。

## 一、保证判定

对 README「对外保证」的 7 条逐条给出判定：**违反** 或 **未违反**（二选一，不许留空）。

| 保证编号 | 判定 | 说明 |
| --- | --- | --- |
| 1 | 违反 | `emit` 按活数组边遍历边取长度，派发中新增的订阅者参与了本次派发，快照语义不成立 |
| 2 | 违反 | 派发中退订自身（或 `once` 摘除自身）会让数组前移，紧跟其后的订阅者被跳过 |
| 3 | 违反 | 首个抛异常的订阅者直接中断 `emit`，其余订阅者未被调用，也无聚合错误 |
| 4 | 违反 | `once` 先调回调后摘除，回调抛异常时订阅残留并被重复触发 |
| 5 | 违反 | 只按注册先后派发，精确订阅与通配订阅无分组，通配可先于精确被调用 |
| 6 | 违反 | 全实现无重入深度计数，重入不受限，最终以 RangeError 栈溢出收场而非 NotifyError |
| 7 | 违反 | `once` 回调抛异常后条目残留，`emit` 完成后 `listenerCount` 与应有状态不自洽 |

## 二、结论清单

| 保证编号 | 缺陷位置（文件:行号） | 最小复现（含次数/深度） | 实际输出 |
| --- | --- | --- | --- |
| 1 | index.js:73 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); const s = []; b.on('e', () => { s.push('a'); b.on('e', () => s.push('b')); }); b.emit('e', 1); console.log(JSON.stringify(s));"` | 实际=`["a","b"]`（派发中新增的 b 被调用 1 次）；期望快照只含 `["a"]` |
| 2 | index.js:73 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); const s = []; const a = () => { s.push('a'); b.off('e', a); }; b.on('e', a); b.on('e', () => s.push('b')); b.emit('e', 1); console.log(JSON.stringify(s));"` | 实际=`["a"]`（b 被跳过 1 次未调用）；期望=`["a","b"]` |
| 2 | index.js:84 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); const s = []; b.once('e', () => s.push('once')); b.on('e', () => s.push('on')); b.emit('e', 1); console.log(JSON.stringify(s));"` | 实际=`["once"]`（once 摘除后数组前移，on 被跳过 1 次）；期望=`["once","on"]` |
| 3 | index.js:87 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); const s = []; b.on('e', () => { throw new Error('boom'); }); b.on('e', () => s.push('b')); try { b.emit('e', 1); } catch (err) { console.log('threw=' + err.constructor.name); } console.log('seen=' + JSON.stringify(s));"` | 实际=`threw=Error`、`seen=[]`（第 2 个订阅者 0 次调用，无聚合错误）；期望=`seen=["b"]` 且抛聚合错误 |
| 4 | index.js:79 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); let n = 0; b.once('e', () => { n += 1; throw new Error('x'); }); try { b.emit('e', 1); } catch {} try { b.emit('e', 2); } catch {} console.log('calls=' + n + ' count=' + b.listenerCount('e'));"` | 实际=`calls=2 count=1`（抛异常的 once 残留并被触发 2 次）；期望=`calls=1 count=0` |
| 5 | index.js:73 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); const s = []; b.on('user.*', () => s.push('wild')); b.on('user.created', () => s.push('exact')); b.emit('user.created', 1); console.log(JSON.stringify(s));"` | 实际=`["wild","exact"]`（通配先于精确）；期望=`["exact","wild"]` |
| 6 | index.js:72 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); let d = 0; b.on('e', () => { d += 1; b.emit('e', 1); }); try { b.emit('e', 1); } catch (err) { console.log('err=' + err.constructor.name + ' depth=' + d); }"` | 实际=`err=RangeError depth=3422`（重入 3422 层后栈溢出）；期望=深度超过 8 时抛 NotifyError |
| 7 | index.js:84 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); b.once('e', () => { throw new Error('x'); }); try { b.emit('e', 1); } catch {} console.log('count=' + b.listenerCount('e'));"` | 实际=`count=1`（emit 完成后残留 1 条，计数泄漏）；期望=`count=0` |
