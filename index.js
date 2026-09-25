// notifybus —— 进程内事件总线。
//
// 仅使用 Node.js 内置能力（无第三方依赖）。导出 NotifyError 与 NotifyBus。
// 本文件是既有实现，本次任务**不要修改**它。

/** 事件总线错误类型（超出重入深度上限等情况使用）。 */
export class NotifyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotifyError';
  }
}

function isWildcard(event) {
  return event.endsWith('.*');
}

function matches(subscribed, event) {
  if (isWildcard(subscribed)) {
    // "user.*" 匹配 "user." 之后至少还有一段的事件名
    const prefix = subscribed.slice(0, -1);
    return event.length > prefix.length && event.startsWith(prefix);
  }
  return subscribed === event;
}

/** 进程内事件总线。 */
export class NotifyBus {
  #entries = [];

  /** 注册一个常驻订阅。返回 this，便于链式调用。 */
  on(event, handler) {
    assertArgs(event, handler);
    this.#entries.push({ event, handler, once: false });
    return this;
  }

  /** 注册一个一次性订阅。返回 this，便于链式调用。 */
  once(event, handler) {
    assertArgs(event, handler);
    this.#entries.push({ event, handler, once: true });
    return this;
  }

  /** 取消一个订阅（按事件名 + 回调匹配）。返回 this。 */
  off(event, handler) {
    assertArgs(event, handler);
    const at = this.#entries.findIndex(
      (e) => e.event === event && e.handler === handler,
    );
    if (at !== -1) {
      this.#entries.splice(at, 1);
    }
    return this;
  }

  /** 统计订阅数：给定事件名时按精确事件名统计；不传参时返回全部订阅数。 */
  listenerCount(event) {
    if (event === undefined) {
      return this.#entries.length;
    }
    let n = 0;
    for (const e of this.#entries) {
      if (e.event === event) {
        n += 1;
      }
    }
    return n;
  }

  /** 派发一个事件给当前所有匹配的订阅者。 */
  emit(event, payload) {
    for (let i = 0; i < this.#entries.length; i += 1) {
      const entry = this.#entries[i];
      if (!matches(entry.event, event)) {
        continue;
      }
      if (entry.once) {
        entry.handler(payload);
        const at = this.#entries.findIndex(
          (e) => e.event === entry.event && e.handler === entry.handler,
        );
        if (at !== -1) {
          this.#entries.splice(at, 1);
        }
      } else {
        entry.handler(payload);
      }
    }
  }
}

function assertArgs(event, handler) {
  if (typeof event !== 'string' || event.length === 0) {
    throw new TypeError('event 必须是非空字符串');
  }
  if (typeof handler !== 'function') {
    throw new TypeError('handler 必须是函数');
  }
}
