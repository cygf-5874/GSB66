# notifybus

一个**进程内事件总线**：往总线上按事件名注册回调，`emit` 时把负载派发给所有匹配的
订阅者。支持精确事件名订阅与 `user.*` 形式的通配订阅，支持一次性订阅（`once`）。

```js
import { NotifyBus } from './index.js';

const bus = new NotifyBus();
bus.on('user.created', (u) => console.log('created', u));
bus.once('user.created', () => console.log('first only'));
bus.on('user.*', (u) => console.log('any user event', u));

bus.emit('user.created', { id: 7 });
```

## 目录

```
package.json              ESM 包描述，无 dependencies
README.md                 本文件（「对外保证」一节的唯一出处）
index.js                  事件总线实现（既有实现，勿改）
test/notifybus.test.mjs   既有用例（12 个，勿改）
review/CHECKLIST.md       审查核对表（勿改）
review/REVIEW.md          审查结论（待填，本任务的交付物）
check/check.mjs           固定验收程序（勿改）
scripts/check.sh          固定验收入口（勿改）
```

## 语言版本前提

- Node.js 22（`node` v22.22.2 已验证）。
- ESM（`package.json` 里 `"type": "module"`）。
- **只用 `node:` 内置模块**，`package.json` 不含 `dependencies`。

## 怎么跑

```bash
node --test              # 既有用例（自动发现 test/ 下的 *.test.mjs）
bash scripts/check.sh    # 固定验收；支持 -list 与 --only <组名>
```

## 公开 API

| 符号 | 语义 |
| --- | --- |
| `NotifyBus` | 事件总线类 |
| `(*NotifyBus) on(event, handler)` | 注册常驻订阅，返回 `this`（可链式） |
| `(*NotifyBus) once(event, handler)` | 注册一次性订阅，返回 `this`（可链式） |
| `(*NotifyBus) off(event, handler)` | 按「事件名 + 回调」取消一个订阅，返回 `this` |
| `(*NotifyBus) listenerCount(event?)` | 给定事件名时返回该事件名的订阅数；不传参返回全部订阅数 |
| `(*NotifyBus) emit(event, payload)` | 把 `payload` 派发给所有匹配的订阅者 |
| `NotifyError` | 事件总线错误类型（例如超出重入深度上限时抛出） |

事件名与通配：订阅串以 `.*` 结尾时视为通配（如 `user.*` 匹配 `user.created`、
`user.deleted`，但不匹配 `user` 本身）；其余按**精确相等**匹配。

## 对外保证

下面 7 条是 `notifybus` 的**对外契约**，实现必须全部守住；它们是本题验收点的唯一出处。

1. **派发顺序 = 订阅顺序，且集合是快照**：同一次 `emit` 内，匹配到的订阅者按注册
   先后（先进先出）被调用；并且本次派发的订阅者集合是 `emit` 开始时的**快照**——
   派发过程中**新增**的订阅者不参与本次派发。
2. **派发中的退订不打乱本次派发**：订阅者在派发过程中退订自身、或退订**尚未被调用**
   的其他订阅者时，本次派发不得错乱（不得漏掉本应被调用的订阅者、也不得重复调用）。
   被退订者其后的调用**跳过**（写死的语义）。
3. **异常隔离**：单个订阅者抛出的异常不得影响其余订阅者——其余订阅者都要被调用完，
   然后**抛出聚合错误**（把本轮收集到的异常带出来），而不是在第一个异常处中断。
4. **`once` 的一次性语义**：`once` 订阅必须在**调用回调之前**先把自身从订阅集合里摘除；
   因此即使回调抛异常，该订阅也不得残留、不得被重复触发。
5. **通配与精确的优先级**：同一次 `emit` 里，**精确订阅先于通配订阅**被调用
   （各自组内仍按订阅顺序）。
6. **重入深度上限**：`emit` 触发的回调再次 `emit` 同一总线时不得无限递归——
   重入深度上限为 **8**，超过上限必须抛 `NotifyError`（而不是栈溢出）。
7. **计数自洽无泄漏**：每个 `emit` 完成后，`listenerCount()` 与内部订阅结构必须自洽
   （不残留、不丢失）；对同一事件名反复订阅/退订 10^4 次后，
   `listenerCount(该事件)` 必须精确等于 `0`。
