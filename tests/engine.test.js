import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCompatibility, LocalEngine } from '../src/engine.js';

test('detects insecure origins, absent WebGPU and absent adapters', async () => {
  assert.equal((await checkCompatibility({ isSecureContext: false })).supported, false);
  assert.equal(
    (await checkCompatibility({ isSecureContext: true, navigator: {} })).supported,
    false,
  );
  assert.equal(
    (
      await checkCompatibility({
        isSecureContext: true,
        navigator: { gpu: { requestAdapter: async () => null } },
      })
    ).supported,
    false,
  );
  assert.equal(
    (
      await checkCompatibility({
        isSecureContext: true,
        navigator: { gpu: { requestAdapter: async () => ({}) } },
      })
    ).supported,
    true,
  );
});

test('worker generation errors release resources and allow another load', async () => {
  const runtime = new LocalEngine();
  runtime.ready = true;
  let terminated = false;
  runtime.worker = {
    terminate() {
      terminated = true;
    },
  };
  runtime.workerFailure = new Promise(() => {});
  runtime.engine = {
    chat: {
      completions: {
        create: async () => {
          throw new Error('GPU lost');
        },
      },
    },
  };
  await assert.rejects(async () => {
    for await (const _ of runtime.generate([])) {
    }
  }, /GPU lost/);
  assert.equal(runtime.ready, false);
  assert.equal(terminated, true);
});
