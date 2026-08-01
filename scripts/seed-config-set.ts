// Seed (or update) a Supabase-backed DatHost config set — `config_sets`/`config_set_files`, see
// `src/lib/dathost-config.ts` — from local files: a settings JSON (`{server, cs2_settings}`, same
// shape as infra/matchzy/golden-server-settings.json) and a cfg directory. Upserts on `key`, so it's
// safe to re-run. Remote paths are the cfg-dir-relative path prefixed with `cfg/` (DatHost's
// file-manager root), e.g. `infra/matchzy/cfg/MatchZy/config.cfg` with `--cfg-dir infra/matchzy/cfg`
// becomes `cfg/MatchZy/config.cfg`.
//
//   set -a; . ./.env.local; set +a
//   tsx scripts/seed-config-set.ts --key golden --label "DGLS Season 3 Default" \
//     --settings infra/matchzy/golden-server-settings.json --cfg-dir infra/matchzy/cfg --yes

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getAdminClient } from '../src/lib/supabase-admin';
import { flagValue } from './dathost-golden-shared';

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const key = flagValue(args, '--key');
  const label = flagValue(args, '--label');
  const settingsPath = flagValue(args, '--settings');
  const cfgDir = flagValue(args, '--cfg-dir');
  const yes = args.includes('--yes');

  if (!key || !label || !settingsPath || !cfgDir) {
    console.error('Usage: tsx scripts/seed-config-set.ts --key <key> --label <label> --settings <path> --cfg-dir <dir> --yes');
    process.exit(2);
  }
  if (!yes) {
    console.error('⚠ this writes to the live config_sets/config_set_files tables. Re-run with --yes.');
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
    server?: Record<string, unknown>;
    cs2_settings?: Record<string, unknown>;
  };
  const files = walkFiles(cfgDir).map((full) => ({
    remote: `cfg/${relative(cfgDir, full)}`,
    content: readFileSync(full, 'utf8'),
  }));

  const supabase = getAdminClient();

  const { data: set, error: setErr } = await supabase
    .from('config_sets')
    .upsert({ key, label, server_settings: raw.server ?? {}, cs2_settings: raw.cs2_settings ?? {} }, { onConflict: 'key' })
    .select('id')
    .single();
  if (setErr || !set) {
    console.error(`✖ upsert config_sets failed: ${setErr?.message}`);
    process.exit(2);
  }
  const configSetId = (set as { id: number }).id;
  console.error(`✓ config_sets row "${key}" (id ${configSetId})`);

  for (const f of files) {
    const { error } = await supabase
      .from('config_set_files')
      .upsert({ config_set_id: configSetId, remote_path: f.remote, content: f.content }, { onConflict: 'config_set_id,remote_path' });
    if (error) {
      console.error(`✗ upsert config_set_files failed for ${f.remote}: ${error.message}`);
      process.exit(2);
    }
    console.error(`  ✓ ${f.remote}`);
  }

  console.error(`\nSeeded "${key}" with ${files.length} cfg file(s).`);
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(2);
});
