import test from 'node:test';
import assert from 'node:assert/strict';
import { theaterMessages, extractTheater, validateTheater, bodyOnly } from '../src/planning/theater.js';
import { createTheater } from '../src/host/theater.js';
import { migrateSettings } from '../src/planning/core.js';

const chat = () => [
  { is_user: true, name: 'User', mes: '你好' },
  { is_user: false, name: 'Alice', mes: '旧回复', swipe_id: 0 },
  { is_user: true, name: 'User', mes: '继续' },
  { is_user: false, name: 'Alice', mes: '本轮正文', swipe_id: 0, swipes: ['本轮正文'], swipe_info: [{ extra: {} }] },
];

test('theater messages use profile, bounded history and the current body only', () => {
  const messages = theaterMessages({ chat: chat(), messageId: 3, prompt: 'P', history: 2, charName: 'Alice', userName: 'User', character: { description: '设定', personality: '', scenario: '场景' }, persona: '玩家' });
  assert.equal(messages[0].content, 'P');
  assert.match(messages[1].content, /【角色设定】\n设定/);
  assert.match(messages[1].content, /【场景】\n场景/);
  assert.doesNotMatch(messages[1].content, /【性格】/);
  assert.match(messages[2].content, /Alice：旧回复\n\nUser：继续$/);
  assert.doesNotMatch(messages[2].content, /你好/);
  assert.match(messages.at(-1).content, /Alice：本轮正文/);
  assert.equal(theaterMessages({ chat: chat(), messageId: 3, prompt: 'P', history: 0 }).length, 2);
  assert.throws(() => theaterMessages({ chat: chat(), messageId: 2, prompt: 'P', history: 2 }), /没有可用于小剧场的正文/);
});

test('bodyOnly strips the plan block in front and an earlier theater at the end', () => {
  const plan = { text: '规划', openTag: '<T>', closeTag: '</T>' };
  assert.equal(bodyOnly('<T>\n规划\n</T>\n\n正文\n\n旧剧场', plan, '旧剧场'), '正文');
  assert.equal(bodyOnly('正文', plan, undefined), '正文');
  assert.equal(bodyOnly('正文', undefined, '不在末尾'), '正文');
});

test('theater extraction and settings validation reject truncation and bad limits', () => {
  assert.equal(extractTheater('  剧场  ', 'stop'), '剧场');
  assert.throws(() => extractTheater('剧场', 'length'), /截断/);
  assert.throws(() => extractTheater('', 'stop'), /未返回文本/);
  const settings = migrateSettings({});
  validateTheater(settings);
  assert.throws(() => validateTheater({ ...settings, theaterMaxTokens: 10 }), /theaterMaxTokens/);
  assert.throws(() => validateTheater({ ...settings, theaterHistory: 51 }), /theaterHistory/);
  assert.throws(() => validateTheater({ ...settings, theaterPrompt: ' ' }), /不能为空/);
  assert.equal(settings.theaterEnabled, false);
  assert.equal(settings.theaterAutoGenerate, true);
});

function harness(overrides = {}) {
  const context = { chatId: 'a', characterId: 0, groupId: null, chat: chat(), name1: 'User', name2: 'Alice', characters: [{ description: '设定' }], extensionSettings: { czgh_external_planner: { ...migrateSettings({}), enabled: true, theaterEnabled: true, theaterApiSelection: 'local:x', timeoutSeconds: 60, ...overrides } } };
  const renders = [], refreshed = [];
  let saves = 0, requests = [];
  const theater = createTheater({
    getContext: () => context, getRequestHeaders: () => ({}), save: async () => { saves++; }, chatId: () => context.chatId, refresh: id => refreshed.push(id),
    resolveRequest: async ({ selection, maxTokens }) => { requests.push(selection); return { chat_completion_source: 'custom', custom_url: 'http://x', model: 'm', secret_id: 's', max_tokens: maxTokens }; },
    render: records => renders.push(structuredClone(records)),
  });
  return { context, theater, renders, requests, refreshed, saves: () => saves };
}

test('theater controller appends the result after the body, records it per swipe and replaces an earlier theater', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: '番外' }, finish_reason: 'stop' }] }) }; };
  try {
    const h = harness();
    h.theater.received(3, 'normal');
    assert.equal(h.theater.isRunning(), true);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(h.theater.isRunning(), false);
    assert.equal(h.requests[0], 'local:x');
    assert.equal(bodies[0].model, 'm');
    assert.equal(bodies[0].stream, false);
    assert.equal(bodies[0].max_tokens, 2000);
    assert.match(bodies[0].messages.at(-1).content, /本轮正文/);
    const message = h.context.chat[3];
    assert.equal(message.mes, '本轮正文\n\n番外');
    assert.equal(message.swipes[0], message.mes);
    assert.equal(message.extra.czghTheater[0].text, '番外');
    assert.equal(message.swipe_info[0].extra.czghTheater[0].text, '番外');
    assert.equal(h.saves(), 1);
    assert.deepEqual(h.refreshed, [3]);
    const last = h.renders.at(-1)[0];
    assert.equal(last.phase, 'done');
    assert.equal(last.stale, false);
    assert.equal(h.theater.current().phase, 'done');
    // Regenerating replaces the earlier theater instead of stacking; the prompt sees the body only.
    assert.equal(await h.theater.generate(3), true);
    assert.equal(message.mes, '本轮正文\n\n番外');
    assert.match(bodies[1].messages.at(-1).content, /Alice：本轮正文\n/);
    assert.doesNotMatch(bodies[1].messages.at(-1).content, /番外/);
    message.mes = '编辑后';
    h.theater.render();
    assert.equal(h.renders.at(-1)[0].stale, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('theater controller skips when disabled, manual, or the body changed during the request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: '番外' }, finish_reason: 'stop' }] }) }; };
  try {
    harness({ theaterEnabled: false }).theater.received(3, 'normal');
    harness({ theaterAutoGenerate: false }).theater.received(3, 'normal');
    harness({ enabled: false }).theater.received(3, 'normal');
    harness().theater.received(3, 'quiet');
    await new Promise(r => setTimeout(r, 10));
    assert.equal(calls, 0);
    const disabled = harness({ theaterEnabled: false });
    disabled.theater.render();
    assert.deepEqual(disabled.renders.at(-1), []);
    const manual = harness({ theaterAutoGenerate: false });
    assert.equal(manual.renders.at(-1)?.[0]?.phase, undefined);
    manual.theater.render();
    assert.equal(manual.renders.at(-1)[0].phase, 'idle');
    const task = manual.theater.generate(3);
    manual.context.chat[3].swipe_id = 1;
    assert.equal(await task, false);
    assert.equal(manual.context.chat[3].extra?.czghTheater, undefined);
    manual.context.chat[3].swipe_id = 0;
    manual.theater.render();
    assert.equal(manual.renders.at(-1)[0].phase, 'error');
    assert.match(manual.renders.at(-1)[0].error, /正文已变化/);
  } finally { globalThis.fetch = originalFetch; }
});

test('theater controller cancels on stop, new generation and chat change', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); });
  try {
    const h = harness();
    void h.theater.generate(3);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(h.theater.cancel(), true);
    assert.equal(h.theater.isRunning(), false);
    assert.equal(h.renders.at(-1)[0].phase, 'cancelled');
    void h.theater.generate(3);
    await new Promise(r => setTimeout(r, 5));
    h.theater.generationStarted('normal', false);
    assert.equal(h.theater.isRunning(), false);
    assert.equal(h.renders.at(-1)[0].phase, 'idle');
    void h.theater.generate(3);
    await new Promise(r => setTimeout(r, 5));
    h.theater.generationStarted('quiet', false);
    assert.equal(h.theater.isRunning(), true);
    h.context.chatId = 'b';
    h.theater.chatChanged();
    assert.equal(h.theater.isRunning(), false);
  } finally { globalThis.fetch = originalFetch; }
});
