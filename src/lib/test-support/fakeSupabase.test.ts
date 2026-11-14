import { test, expect } from 'vitest';
import { clientFailingOn, createFakeSupabaseClient, FakeRpcError, type FakeDb } from './fakeSupabase';

function client(handler: () => unknown) {
  const db: FakeDb = { seasons: [{ id: 1 }] };
  return createFakeSupabaseClient(db, { do_it: handler });
}

const failingInsert = () =>
  clientFailingOn(createFakeSupabaseClient({ seasons: [] }), 'seasons', 'insert', { code: 'TEST', message: 'connection reset' });

test('rpc: resolves { data, error: null } for a handler that returns', async () => {
  expect(await client(() => 'ok').rpc('do_it')).toEqual({ data: 'ok', error: null });
});

test('rpc: a FakeRpcError resolves { data: null, error } carrying its message and code', async () => {
  const res = await client(() => {
    throw new FakeRpcError('boom', '23505');
  }).rpc('do_it');
  expect(res).toEqual({ data: null, error: { code: '23505', message: 'boom' } });
});

test('rpc: .throwOnError() resolves the data when the handler returns', async () => {
  expect(await client(() => true).rpc('do_it').throwOnError()).toEqual({ data: true, error: null });
});

test('rpc: .throwOnError() rejects with an Error carrying the message and code for a FakeRpcError', async () => {
  const pending = client(() => {
    throw new FakeRpcError('overlapping-scrim-night');
  })
    .rpc('do_it')
    .throwOnError();
  await expect(pending).rejects.toBeInstanceOf(Error);
  await expect(pending).rejects.toMatchObject({ message: 'overlapping-scrim-night', code: 'P0001' });
});

test('rpc: .throwOnError() passes any other thrown error through untouched', async () => {
  const pending = client(() => {
    throw new TypeError('bug');
  })
    .rpc('do_it')
    .throwOnError();
  await expect(pending).rejects.toBeInstanceOf(TypeError);
});

test('table write: .throwOnError() on a failing write rejects with an Error carrying the message and code', async () => {
  const pending = failingInsert().from('seasons').insert({ name: 'x' }).throwOnError();
  await expect(pending).rejects.toBeInstanceOf(Error);
  await expect(pending).rejects.toMatchObject({ message: 'connection reset', code: 'TEST' });
});

test('table write: without .throwOnError() a failing write resolves { error }', async () => {
  expect(await failingInsert().from('seasons').insert({ name: 'x' })).toEqual({
    data: null,
    error: { code: 'TEST', message: 'connection reset' },
  });
});
