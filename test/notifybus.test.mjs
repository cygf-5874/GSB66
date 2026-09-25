import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NotifyBus } from '../index.js';

test('on + emit：单个订阅者被调用', () => {
  const bus = new NotifyBus();
  let called = 0;
  bus.on('ping', () => {
    called += 1;
  });
  bus.emit('ping');
  assert.equal(called, 1);
});

test('emit：负载原样透传给订阅者', () => {
  const bus = new NotifyBus();
  const seen = [];
  bus.on('data', (payload) => seen.push(payload));
  bus.emit('data', { id: 7 });
  assert.deepEqual(seen, [{ id: 7 }]);
});

test('emit：多个不同订阅者按注册先后被调用', () => {
  const bus = new NotifyBus();
  const order = [];
  const a = () => order.push('a');
  const b = () => order.push('b');
  const c = () => order.push('c');
  bus.on('e', a);
  bus.on('e', b);
  bus.on('e', c);
  bus.emit('e');
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('off：取消订阅之后不再被调用', () => {
  const bus = new NotifyBus();
  let called = 0;
  const handler = () => {
    called += 1;
  };
  bus.on('e', handler);
  bus.off('e', handler);
  bus.emit('e');
  assert.equal(called, 0);
});

test('once：只被调用一次', () => {
  const bus = new NotifyBus();
  let called = 0;
  bus.once('e', () => {
    called += 1;
  });
  bus.emit('e');
  bus.emit('e');
  assert.equal(called, 1);
});

test('once：回调同样收到负载', () => {
  const bus = new NotifyBus();
  let got = null;
  bus.once('e', (payload) => {
    got = payload;
  });
  bus.emit('e', 42);
  assert.equal(got, 42);
});

test('listenerCount：按事件名统计订阅数', () => {
  const bus = new NotifyBus();
  bus.on('e', () => {});
  bus.on('e', () => {});
  bus.on('other', () => {});
  assert.equal(bus.listenerCount('e'), 2);
  assert.equal(bus.listenerCount('other'), 1);
});

test('listenerCount：不传参返回全部订阅数', () => {
  const bus = new NotifyBus();
  bus.on('a', () => {});
  bus.once('b', () => {});
  assert.equal(bus.listenerCount(), 2);
});

test('通配订阅 user.* 匹配 user.created', () => {
  const bus = new NotifyBus();
  const seen = [];
  bus.on('user.*', (payload) => seen.push(payload));
  bus.emit('user.created', 1);
  assert.deepEqual(seen, [1]);
});

test('精确订阅只在事件名完全相等时触发', () => {
  const bus = new NotifyBus();
  let called = 0;
  bus.on('user.created', () => {
    called += 1;
  });
  bus.emit('user.deleted');
  assert.equal(called, 0);
  bus.emit('user.created');
  assert.equal(called, 1);
});

test('on / once / off 均可链式调用', () => {
  const bus = new NotifyBus();
  const returned = bus.on('e', () => {}).once('e', () => {}).off('e', () => {});
  assert.equal(returned, bus);
});

test('没有任何订阅者时 emit 不报错', () => {
  const bus = new NotifyBus();
  assert.doesNotThrow(() => bus.emit('nobody'));
  assert.equal(bus.listenerCount('nobody'), 0);
});
