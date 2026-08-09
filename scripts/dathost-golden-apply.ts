// Resolve drift between a Supabase-backed DatHost config set (default `golden`, the production
// baseline) and the live DGLS match server, in one of two directions. Always run
// scripts/dathost-golden-diff.ts first to see what's actually different — this script does not diff,
// it just applies.
//
//   set -a; . ./.env.local; set +a
//
//   --capture <serverId> --yes [--key golden]     live server → config_sets row (recapture: the
//                                                  panel was intentionally retuned and should become
//                                                  the new baseline for that set)
//   --reassert <serverId> --yes [--key golden]    config_sets row → live server (push the set,
//                                                  overwriting whatever recreational-mode drift
//                                                  happened in the panel)
//
// Both mutate real state (the `config_sets`/`config_set_files` tables, or the live match server) and
// require --yes. Neither adds or removes tracked keys/files — `--capture` only overwrites values for
// keys/files the config set already tracks (use `scripts/seed-config-set.ts` to add a new set or a
// new tracked file). `--reassert` only PUTs scalar cs2_settings/server fields (via buildScalarFields()
// in src/lib/dathost.ts, the same builder applyConfigSet() uses) — array fields like metamod_plugins
// are skipped, matching that function's documented reasoning: DatHost preserves them across changes,
// so guessing form-encoding for an array isn't worth the risk. `--reassert` also does not touch
// per_match_overrides (those are per-match, not part of the static baseline).

import { api, flagValue } from './dathost-golden-shared';
import { getAdminClient } from '../src/lib/supabase-admin';
import { resolveConfigSet, pushCfgFiles } from '../src/lib/dathost-config';
import { buildScalarFields, MAP_SELECTION_KEYS } from '../src/lib/dathost';
import type { Json } from '../src/lib/database.types';

async function capture(serverId: string, key: string) {
  const supabase = getAdminClient();
  const set = await resolveConfigSet(supabase, key);

  console.error(`— GET /game-servers/${serverId} (live cs2_settings) —`);
  const { status, json } = await api('GET', `/game-servers/${serverId}`);
  if (status !== 200) {
    console.error(`✖ could not read live server (${status})`);
    process.exit(2);
  }
  const live = json as Record<string, unknown>;
  const liveCs2 = (live.cs2_settings ?? {}) as Record<string, unknown>;

  const newServer: Record<string, unknown> = { ...set.server };
  for (const k of Object.keys(set.server)) {
    if (live[k] !== undefined) newServer[k] = live[k];
  }
  const newCs2: Record<string, unknown> = { ...set.cs2Settings };
  for (const k of Object.keys(set.cs2Settings)) {
    if (liveCs2[k] !== undefined) newCs2[k] = liveCs2[k];
  }

  const { error: setErr } = await supabase
    .from('config_sets')
    .update({
      server_settings: newServer as unknown as Json,
      cs2_settings: newCs2 as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq('key', key);
  if (setErr) {
    console.error(`✖ could not update config_sets: ${setErr.message}`);
    process.exit(2);
  }
  console.error(`✓ updated config_sets "${key}" from live settings`);

  const { data: idRow } = await supabase.from('config_sets').select('id').eq('key', key).maybeSingle();
  const configSetId = idRow?.id;
  if (configSetId == null) {
    console.error(`✖ could not resolve config_sets.id for "${key}" — cfg files left untouched.`);
    process.exit(2);
  }

  for (const f of set.cfgFiles) {
    console.error(`— GET /game-servers/${serverId}/files/${f.remote} —`);
    const { status: fstatus, text } = await api('GET', `/game-servers/${serverId}/files/${f.remote}`);
    if (fstatus !== 200) {
      console.error(`  ⚠ could not fetch ${f.remote} (${fstatus}) — left its stored content untouched.`);
      continue;
    }
    const { error: fileErr } = await supabase
      .from('config_set_files')
      .update({ content: text })
      .eq('config_set_id', configSetId)
      .eq('remote_path', f.remote);
    if (fileErr) {
      console.error(`  ✗ could not update ${f.remote}: ${fileErr.message}`);
      continue;
    }
    console.error(`  ✓ updated ${f.remote} from live content`);
  }

  console.error(`\nReview via \`tsx scripts/dathost-golden-diff.ts ${serverId} ${key}\` (should now be clean).`);
}

async function reassert(serverId: string, key: string) {
  const supabase = getAdminClient();
  const set = await resolveConfigSet(supabase, key);

  // Same scalar-field builder the app uses (applyConfigSet in src/lib/dathost.ts) — see its doc
  // comment for why non-scalar values (arrays like metamod_plugins, null, nested objects) are skipped
  // rather than guessed at. `onSkip` reports exactly what buildScalarFields itself excluded, so the
  // logged message can never drift from the actual PUT.
  const skipMsg = (label: string) => (k: string) =>
    console.error(`  ~ skipping ${label}.${k} (array/null/object — not re-asserted, see script header)`);
  const fields: Record<string, string> = {
    ...buildScalarFields(set.server, { onSkip: skipMsg('server') }),
    ...buildScalarFields(set.cs2Settings, { prefix: 'cs2_settings.', exclude: MAP_SELECTION_KEYS, onSkip: skipMsg('cs2_settings') }),
  };

  console.error(`— PUT /game-servers/${serverId} (config set "${key}") —`);
  const put = await api('PUT', `/game-servers/${serverId}`, new URLSearchParams(fields));
  if (put.status >= 400) {
    console.error(`✖ PUT failed (${put.status}): ${put.text.slice(0, 300)}`);
    process.exit(2);
  }
  console.error(`✓ settings pushed (${put.status})`);

  console.error(`— POST /game-servers/${serverId}/files/* (${set.cfgFiles.length} cfg files) —`);
  for (const r of await pushCfgFiles(serverId, set.cfgFiles)) {
    if (!r.ok) console.error(`  ✗ upload failed (${r.status}) for ${r.remote}`);
    else console.error(`  ✓ pushed ${r.remote}`);
  }

  console.error('\nSettings apply on next provision (or next PUT). cfg files apply on next server boot.');
}

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const key = flagValue(args, '--key') ?? 'golden';

  const captureId = flagValue(args, '--capture');
  const reassertId = flagValue(args, '--reassert');

  if (!captureId && !reassertId) {
    console.error('Usage: tsx scripts/dathost-golden-apply.ts --capture <serverId> --yes [--key golden]');
    console.error('   or: tsx scripts/dathost-golden-apply.ts --reassert <serverId> --yes [--key golden]');
    process.exit(2);
  }
  if (!yes) {
    console.error('⚠ this mutates real state (config_sets/config_set_files, or the live match server). Re-run with --yes.');
    process.exit(1);
  }

  if (captureId) await capture(captureId, key);
  else if (reassertId) await reassert(reassertId, key);
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(2);
});
