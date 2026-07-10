# EHOG Rating Engine

EHOG is the DGLS player skill rating. It maps [OpenSkill](https://github.com/philihp/openskill.js)
(PlackettLuce) state onto a **10–100 display rating** for the leaderboard. Ratings update after
every match via a full chronological recompute.

## How a rating update works

```
1. PlackettLuce.rate() — unweighted, ranks only
   ↓
2. Margin-of-victory multiplier (same m for all 4 players)
   m = MIN + (MAX − MIN) × |scoreSh − scoreSk| / (scoreSh + scoreSk)
   new_mu = prior_mu + m × (unweighted_mu − prior_mu)
   new_sigma = max(SIGMA_FLOOR, unweighted_sigma)
   ↓
3. Logistic display transform
   skill = mu − LAMBDA × sigma
   EHOG = 10 + 90 / (1 + exp(−(skill − CENTER) / SCALE))
```

Between seasons, μ and σ are regressed toward their defaults by `SEASON_REGRESSION` (10%) to keep
ratings responsive without full resets.

A brand-new player starts at `MU_DEFAULT`/`SIGMA_DEFAULT`, which is deliberately **below** `CENTER`
(the display transform's own midpoint anchor) — so an unproven player starts in the low-30s rather
than mid-band, and climbs as results come in. A player with a known skill level can instead be seeded
at an admin-configured starting rating (`players.seed_ehog`, set on `/admin/players`) — see
**Seeding a known player's starting rating** below.

## Display tiers

The UI renders a color-coded badge (`EhogBadge.tsx`) and tier bar (`EhogTierBar.tsx`):

| EHOG range | Color  |
|------------|--------|
| 99–100     | Gold   |
| 95–98      | Red    |
| 80–94      | Pink   |
| 60–79      | Purple |
| 30–59      | Blue   |
| 15–29      | Cyan   |
| 0–14       | Grey   |

## Pipeline

| File | Role |
|---|---|
| `ehog/constants.json` | Single source of truth for all tunable parameters. Read by both Python and TS. |
| `ehog/engine.py` | Core rating math + DB read/write helpers. |
| `ehog/backfill.py` | CLI full recompute. `--dry-run` prints standings without writing. |
| `ehog/test_parity.py` | Generates `parity_fixtures.json` from the Python engine. |
| `ehog/test_parity.ts` | Verifies the TS predictor matches the Python fixtures exactly. |
| `src/lib/ehog.ts` | TS predictor — mirrors the engine math for client-side match projections. |
| `api/ehog/recompute.py` | Vercel Python function (configured in `vercel.json`), triggered after a score is submitted. Thin wrapper over `ehog/engine.py`. |

## `constants.json` reference

### OpenSkill model

| Key | Description |
|---|---|
| `MU_DEFAULT` | Starting μ for a brand-new player with no configured seed. Also the regression target between seasons. Set independently of `CENTER` so new players start below mid-band (EHOG ≈ 30). |
| `SIGMA_DEFAULT` | Starting σ (uncertainty) for new players. Higher = more volatile early ratings. |
| `BETA_FACTOR` | Multiplied by `SIGMA_DEFAULT` to get the OpenSkill β parameter (performance variance). |

### Display transform — `EHOG = 10 + 90 / (1 + exp(−(skill − CENTER) / SCALE))`

| Key | Description |
|---|---|
| `CENTER` | μ value that maps to the midpoint of the band (EHOG ≈ 55) — the pool's average-skill anchor. Independent of `MU_DEFAULT`. |
| `SCALE` | Controls how spread out ratings are. Smaller = more bunched in the middle, larger = wider use of the 10–100 range. **Primary tuning knob for dry-run spread.** |
| `LAMBDA` | Conservatism. `skill = mu − LAMBDA × sigma`, so higher values penalize uncertain (low-game) players. 0 = pure μ (max upset reward). |

### Margin-of-victory — `m = M_MIN + (M_MAX − M_MIN) × |scoreA − scoreB| / (scoreA + scoreB)`

| Key | Description |
|---|---|
| `M_MIN` | Multiplier floor (nailbiter games). Values < 1 dampen close-game updates; values ≥ 1 leave them at or above the unweighted baseline. |
| `M_MAX` | Multiplier ceiling (blowouts). Values > 1 amplify the update for dominant wins/losses. |

### Sigma dynamics

| Key | Description |
|---|---|
| `SIGMA_FLOOR` | Minimum σ. Prevents ratings from freezing after many games — experienced players always retain some volatility. |
| `SEASON_REGRESSION` | Fraction of μ and σ regressed toward defaults between seasons (0.1 = 10%). Keeps ratings responsive across seasons. |

### Metadata

| Key | Description |
|---|---|
| `FORMULA_VERSION` | Written to `player_rating_history.formula_version` and used as the column name in `player_current_ratings`. |

## Seeding a known player's starting rating

`players.seed_ehog` (nullable) holds an admin-entered EHOG value (10–100, exclusive — those are the
display transform's unreachable asymptotes) for a player whose real-world skill is already known. Set
it on `/admin/players`. `from_ehog()` — the inverse of `to_ehog()`, in both `engine.py` and
`ehog.ts` — converts it to a starting μ at `SIGMA_DEFAULT` the first time that player appears in the
chronological rating walk (`fetch_player_seeds()` / `compute_ratings()`'s `state_for()`); once a
player has any `player_rating_history` rows, their seed no longer applies. The same conversion is
used client-side (`getPlayerRatings()` in `queries.ts`) so a seeded player's pre-first-match rating
projection shows their seed instead of the global default.

## Running

```bash
# Dry-run — compute and print standings, don't write to DB
python ehog/backfill.py --dry-run

# Real backfill — overwrites existing ratings
python ehog/backfill.py

# Parity test — verify Python/TS produce identical results
python ehog/test_parity.py && npx tsx ehog/test_parity.ts
```

## Keeping Python and TS in sync

The rating math is ~10 lines in each language. The guard against drift is:

1. **Shared constants** — both sides read `ehog/constants.json`.
2. **Parity test** — `ehog/test_parity.py` generates fixtures from the Python engine; `ehog/test_parity.ts` verifies the TS predictor matches within float tolerance (1e-8).

If you change the math in `ehog/engine.py`, mirror it in `src/lib/ehog.ts`, regenerate fixtures, and run both tests.
