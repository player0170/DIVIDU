import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbench } from '../src/host/workbench.js';
import { migrateSchemes } from '../src/planning/schemes.js';

// Minimal fake host context that only exposes what the group-chat fallback path reads.
// The group branch must not call capture()/buildPlanningContext(), so no preset/world stubs are needed.
function fakeContext(overrides = {}) {
  return {
    extensionSettings: { czgh_external_planner: {} },
    groupId: null,
    chat: [],
    chatMetadata: {},
    ...overrides,
  };
}

test('group chat prepare reuses SillyTavern messages and skips independent context assembly', async () => {
  const ctx = fakeContext({
    groupId: 42,
    extensionSettings: {
      czgh_external_planner: {
        ...migrateSchemes({}),
        apiSelection: 'current',
        maxTokens: 512,
      },
    },
    chatCompletionSettings: {
      chat_completion_source: 'custom',
      custom_url: 'https://example.com/v1',
      custom_model: 'body-model',
    },
  });
  const workbench = createWorkbench({ context: () => ctx, headers: () => ({}) });
  const original = [
    { role: 'system', content: '群聊预设' },
    { role: 'user', content: '小明：你好' },
    { role: 'assistant', content: '小红：你好' },
  ];
  const data = { type: 'normal', chat_completion_source: 'custom', custom_url: 'https://example.com/v1', model: 'body-model', messages: structuredClone(original) };
  // freezeCurrentRequest requires the active-secret lookup; stub it out of the way.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ api_key_custom: [{ id: 'active', active: true }] }) });
  let prepared;
  try {
    prepared = await workbench.prepare({ data, config: { ...ctx.extensionSettings.czgh_external_planner }, signal: new AbortController().signal });
  } finally {
    globalThis.fetch = realFetch;
  }
  // The original ST-assembled messages are returned verbatim; no independent rebuild happened.
  assert.deepEqual(prepared.messages, original);
  assert.equal(prepared.request.chat_completion_source, 'custom');
  assert.equal(prepared.request.custom_url, 'https://example.com/v1');
  assert.equal(prepared.request.model, 'body-model');
  // No source manifest because the independent context was not assembled.
  assert.equal(prepared.sourceManifest, undefined);
});

test('group chat prepare with a saved local API scheme resolves its request without rebuilding context', async () => {
  const state = migrateSchemes({});
  state.schemes.api.push({
    id: 'grp',
    kind: 'api',
    name: '群聊方案',
    payload: { source: 'custom', model: 'grp-model', connection: { custom_url: 'https://grp.example/v1' }, secretId: 'grp-secret' },
    updatedAt: 0,
  });
  state.apiSelection = 'local:grp';
  const ctx = fakeContext({
    groupId: 7,
    extensionSettings: { czgh_external_planner: state },
  });
  const workbench = createWorkbench({ context: () => ctx, headers: () => ({}) });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ api_key_custom: [{ id: 'grp-secret', active: true }] }) });
  const data = { type: 'normal', messages: [{ role: 'user', content: '群聊输入' }] };
  let prepared;
  try {
    prepared = await workbench.prepare({ data, config: structuredClone(state), signal: new AbortController().signal });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(prepared.messages, data.messages);
  assert.equal(prepared.profile.secretId, 'grp-secret');
});

test('group chat theaterPrepare appends the theater prompt to the body history without independent assembly', async () => {
  const state = migrateSchemes({});
  state.theaterApiSelection = 'current';
  const ctx = fakeContext({
    groupId: 9,
    extensionSettings: { czgh_external_planner: state },
    chat: [
      { is_user: true, mes: '小明：你好' },
      { is_user: false, mes: '小红：你好\n\n旧小剧场' },
    ],
    chatCompletionSettings: {
      chat_completion_source: 'custom',
      custom_url: 'https://example.com/v1',
      custom_model: 'body-model',
    },
  });
  const workbench = createWorkbench({ context: () => ctx, headers: () => ({}) });
  // The body request captured earlier for "current" connection.
  workbench.rememberBodyRequest({ chat_completion_source: 'custom', custom_url: 'https://example.com/v1', model: 'body-model', messages: [] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ api_key_custom: [{ id: 'active', active: true }] }) });
  const config = { ...state, theaterPrompt: 'TH' };
  let prepared;
  try {
    prepared = await workbench.theaterPrepare({ messageId: 1, body: '小红：你好', config, signal: new AbortController().signal });
  } finally {
    globalThis.fetch = realFetch;
  }
  // history is the raw chat (no independent preset context), the theater prompt is appended.
  assert.equal(prepared.messages.length, 3);
  assert.equal(prepared.messages[0].role, 'user');
  assert.deepEqual(prepared.messages.at(-1), { role: 'system', content: 'TH' });
  assert.equal(prepared.request.chat_completion_source, 'custom');
  assert.equal(prepared.sourceManifest, null);
});
