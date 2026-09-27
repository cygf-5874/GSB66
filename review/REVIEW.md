# 代码审查结论 · notifybus

> 按 `review/CHECKLIST.md` 的格式填写。所有复现命令均在仓库根目录执行，
> 使用 Node.js 22（`node --input-type=module -e "…"`），可直接照抄运行。

## 一、保证判定

对 README「对外保证」的 7 条逐条给出判定：**违反** 或 **未违反**（二选一，不许留空）。

| 保证编号 | 判定 | 说明 |
| --- | --- | --- |
| 1 | 违反 | emit 直接遍历活动数组 #entries，派发中新增的订阅者参与本次派发，无快照 |
| 2 | 违反 | 派发中 off 触发 splice 使索引错位，尚未调用的订阅者被跳过 |
| 3 | 违反 | 订阅者异常直接向上抛，其余订阅者不被调用，也无聚合错误 |
| 4 | 违反 | once 先调用回调再摘除自身，回调抛异常时订阅残留并被重复触发 |
| 5 | 违反 | 单趟循环不区分精确与通配，调用顺序只按注册先后 |
| 6 | 违反 | emit 无重入深度计数，无限递归以 RangeError 栈溢出告终而非 NotifyError |
| 7 | 违反 | once 回调抛异常后订阅残留在 #entries 中，emit 完成后 listenerCount 不为 0 |

## 二、结论清单

| 保证编号 | 缺陷位置（文件:行号） | 最小复现（含次数/深度） | 实际输出 |
| --- | --- | --- | --- |
| 1 | index.js:73 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); const c = []; b.on('e', () => { c.push('a1'); b.on('e', () => c.push('b2')); }); b.emit('e'); console.log(JSON.stringify(c));"` | 实际打印 ["a1","b2"]，期望 ["a1"]：emit 循环每轮重读 this.#entries.length，派发中新增的 1 个订阅者被调用，快照语义不成立 |
| 2 | index.js:73 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); const c = []; const a = () => { c.push('a1'); b.off('e', a); }; b.on('e', a); b.on('e', () => c.push('b2')); b.emit('e'); console.log(JSON.stringify(c));"` | 实际打印 ["a1"]，期望 ["a1","b2"]：a 在派发中退订自身触发 splice，索引错位导致尚未调用的 b2 被跳过（漏调用 1 次） |
| 3 | index.js:87 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); const c = []; b.on('e', () => { throw new Error('boom1'); }); b.on('e', () => c.push('b2')); try { b.emit('e'); } catch (e) { console.log('thrown:', e.constructor.name); } console.log('calls:', JSON.stringify(c));"` | 实际打印 thrown: Error 与 calls: []，期望第 2 个订阅者被调用 1 次后抛聚合错误：第一个异常即中断，其余订阅者 0 次调用，抛出的是原始 Error 而非聚合错误 |
| 4 | index.js:79 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); let n = 0; b.once('e', () => { n += 1; throw new Error('x1'); }); try { b.emit('e'); } catch {} try { b.emit('e'); } catch {} console.log('once handler called:', n, 'times');"` | 实际打印 once handler called: 2 times，期望 1 次：第 79 行先调用回调、第 80-85 行才摘除，回调抛异常使 once 订阅残留并被第 2 次 emit 重复触发 |
| 5 | index.js:75 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); const o = []; b.on('user.*', () => o.push('wild1')); b.on('user.created', () => o.push('exact2')); b.emit('user.created'); console.log(JSON.stringify(o));"` | 实际打印 ["wild1","exact2"]，期望 ["exact2","wild1"]：单趟循环里 matches 对精确与通配一视同仁，先注册的通配订阅先于精确订阅被调用 |
| 6 | index.js:72 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); let d = 0; b.on('e', () => { d += 1; b.emit('e'); }); try { b.emit('e'); } catch (e) { console.log('thrown:', e.constructor.name); }"` | 实际打印 thrown: RangeError（Maximum call stack size exceeded），期望重入深度超过 8 时抛 NotifyError：emit 没有任何深度计数，递归数千层后栈溢出 |
| 7 | index.js:79 | `node --input-type=module -e "import { NotifyBus } from './index.js'; const b = new NotifyBus(); b.once('e', () => { throw new Error('x1'); }); try { b.emit('e'); } catch {} console.log('listenerCount(e) after 1 emit:', b.listenerCount('e'));"` | 实际打印 listenerCount(e) after 1 emit: 1，期望 0：once 回调抛异常后订阅残留在 #entries 中，emit 完成后计数与应有的订阅结构不自洽（残留 1 条） |
