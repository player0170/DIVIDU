import test from 'node:test';
import assert from 'node:assert/strict';
import { theaterMessages, extractTheater, validateTheater, bodyOnly } from '../src/planning/theater.js';
import { createTheater } from '../src/host/theater.js';
import { migrateSettings, promptDefaults } from '../src/planning/core.js';
import { migrateSchemes, schemeSelectionState, rememberScheme, applySchemeOperation } from '../src/planning/schemes.js';

const chat = () => [
  { is_user: true, name: 'User', mes: '你好' },
  { is_user: false, name: 'Alice', mes: '旧回复', swipe_id: 0 },
  { is_user: true, name: 'User', mes: '继续' },
  { is_user: false, name: 'Alice', mes: '本轮正文', swipe_id: 0, swipes: ['本轮正文'], swipe_info: [{ extra: {} }] },
];

test('theater messages append the stage prompt to the preset context without touching it', () => {
  const context = [{ role: 'system', content: '预设' }, { role: 'user', content: '继续' }, { role: 'assistant', content: '本轮正文' }, { role: 'system', content: '后置' }];
  const messages = theaterMessages(context, { theaterPrompt: 'P' });
  assert.equal(messages.length, 5);
  assert.deepEqual(messages.slice(0, 4), context);
  assert.deepEqual(messages.at(-1), { role: 'system', content: 'P' });
  assert.equal(context.length, 4);
  assert.throws(() => theaterMessages([{ role: 'user', content: '你好' }], { theaterPrompt: 'P' }), /没有可用于小剧场的正文/);
  // The default prompt leaves tags to the preset instead of naming a genre.
  assert.match(promptDefaults.theaterPrompt, /预设要求放在正文之后/);
  assert.doesNotMatch(promptDefaults.theaterPrompt, /番外/);
  assert.equal(migrateSettings({ theaterPrompt: '本轮正文已经完成。请根据下方提供的角色资料、最近聊天和本轮正文，写一段简短的番外小剧场，例如幕后花絮、角色内心吐槽、平行时空或 Q 版短剧。贴合角色性格与说话方式；不续写、不改写正文剧情，小剧场内容不视为已发生的事实；篇幅约 200–500 字。只输出小剧场本身，不输出正文、状态栏、规划或额外说明。' }).theaterPrompt, promptDefaults.theaterPrompt);
  assert.equal(migrateSettings({ theaterPrompt: '自定义' }).theaterPrompt, '自定义');
});

test('bodyOnly strips only an earlier theater at the end', () => {
  assert.equal(bodyOnly('<T>\n规划\n</T>\n\n正文\n\n旧剧场', '旧剧场'), '<T>\n规划\n</T>\n\n正文');
  assert.equal(bodyOnly('正文', undefined), '正文');
  assert.equal(bodyOnly('正文', '不在末尾'), '正文');
});

test('post-body stage keeps its own preset selection and shares saved preset schemes', () => {
  const state = migrateSchemes({});
  assert.deepEqual(state.theaterSelection, { presetId: '', promptOverrides: {}, groupOverrides: {} });
  assert.equal(state.schemeSelection.theater, '');
  state.theaterSelection.presetId = 'B'; state.theaterSelection.promptOverrides = { main: false };
  assert.equal(schemeSelectionState(state, 'theater').dirty, true);
  assert.equal(schemeSelectionState(state, 'preset').dirty, false);
  const saved = applySchemeOperation(state, { kind: 'preset', operation: 'create', name: '后置', payload: { presetId: 'B', promptOverrides: { main: false }, groupOverrides: {} } });
  const id = saved.schemes.preset.at(-1).id;
  rememberScheme(saved, 'theater', id);
  assert.equal(schemeSelectionState(saved, 'theater').dirty, false);
  assert.equal(saved.schemeSelection.preset, '');
  const removed = applySchemeOperation(saved, { kind: 'preset', operation: 'delete', id });
  assert.equal(removed.schemeSelection.theater, '');
});

test('theater extraction and settings validation reject truncation and bad limits', () => {
  assert.equal(extractTheater('  剧场  ', 'stop'), '剧场');
  assert.throws(() => extractTheater('剧场', 'length'), /截断/);
  assert.throws(() => extractTheater('', 'stop'), /未返回文本/);
  const settings = migrateSettings({});
  validateTheater(settings);
  assert.throws(() => validateTheater({ ...settings, theaterMaxTokens: 10 }), /theaterMaxTokens/);
  assert.throws(() => validateTheater({ ...settings, theaterPrompt: ' ' }), /不能为空/);
  assert.equal(settings.theaterEnabled, false);
  assert.equal(settings.theaterAutoGenerate, true);
});

function harness(overrides = {}) {
  const context = { chatId: 'a', characterId: 0, groupId: null, chat: chat(), name1: 'User', name2: 'Alice', characters: [{ description: '设定' }], extensionSettings: { czgh_external_planner: { ...migrateSettings({}), enabled: true, theaterEnabled: true, theaterApiSelection: 'local:x', timeoutSeconds: 60, ...overrides } } };
  const renders = [], refreshed = [], prepared = [];
  let saves = 0;
  const theater = createTheater({
    getContext: () => context, getRequestHeaders: () => ({}), save: async () => { saves++; }, chatId: () => context.chatId, refresh: id => refreshed.push(id),
    // Stand-in for workbench.theaterPrepare: preset context whose history ends with the given body.
    prepare: async ({ messageId, body, config }) => {
      prepared.push({ messageId, body, selection: config.theaterApiSelection });
      const history = context.chat.slice(0, messageId + 1).map((m, i) => ({ role: m.is_user ? 'user' : 'assistant', content: i === messageId ? body : m.mes }));
      return { messages: [{ role: 'system', content: '预设' }, ...history, { role: 'system', content: config.theaterPrompt }], request: { chat_completion_source: 'custom', custom_url: 'http://x', model: 'm', secret_id: 's', tools: [] } };
    },
    render: records => renders.push(structuredClone(records)),
  });
  return { context, theater, renders, prepared, refreshed, saves: () => saves };
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
    assert.deepEqual(h.prepared[0], { messageId: 3, body: '本轮正文', selection: 'local:x' });
    assert.equal(bodies[0].model, 'm');
    assert.equal(bodies[0].stream, false);
    assert.equal(bodies[0].max_tokens, 2000);
    assert.equal('tools' in bodies[0], false);
    assert.equal(bodies[0].messages.at(-2).content, '本轮正文');
    assert.equal(bodies[0].messages.at(-1).content, promptDefaults.theaterPrompt);
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
    // Regenerating replaces the earlier theater instead of stacking; the stage reads the body without it.
    assert.equal(await h.theater.generate(3), true);
    assert.equal(message.mes, '本轮正文\n\n番外');
    assert.equal(h.prepared[1].body, '本轮正文');
    assert.equal(bodies[1].messages.at(-2).content, '本轮正文');
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
