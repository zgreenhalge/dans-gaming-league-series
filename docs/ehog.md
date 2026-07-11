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
| `ehog/backfill.py` | CLI full recompute. `--dry-run` prints standings without writing. `--calibration` scores pre-match win predictions instead (Brier score + reliability bands); `--grid` sweeps MOV/display constants under it. Both are dry-run only. |
| `ehog/test_parity.py` | Generates `parity_fixtures.json` from the Python engine. |
| `ehog/test_parity.ts` | Verifies the TS predictor matches the Python fixtures exactly. |
| `src/lib/ehog.ts` | TS predictor — mirrors the engine math for client-side match projections. |
| `api/ehog/recompute.py` | Vercel Python function (configured in `vercel.json`), triggered after a score is submitted. Thin wrapper over `ehog/engine.py`; also freezes each match's pre-match win probability on first recompute — see **Persisted pre-match snapshot** below. |

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

## Pre-match win probability

`predict_win()` (`engine.py`) / `predictWinProbability()` (`ehog.ts`) give the probability one
2-player team beats another, derived purely from the teams' current OpenSkill state (μ/σ/β) via the
library's own `predict_win` — no trained model, no new state, and the MOV multiplier never
participates. Both wrap the library call rather than hand-rolling the math, so the underlying model
is the single source of truth on both sides; parity is still verified via `win_prob` fixtures in
`parity_fixtures.json`.

`ehog/backfill.py --calibration` chronologically replays every match, recording the pre-match
probability that SHIRTS wins against the actual outcome, then reports:

- **Brier score** — mean squared error of the predictions, compared against the always-predict-50%
  baseline of 0.25 (lower is better).
- **Reliability bands** — predictions bucketed by confidence in the favored side (50–60% … 90%+,
  folding `p < 0.5` by symmetry), each showing predicted vs. actual win rate. Bands with fewer than
  10 predictions are flagged as too small to read.

`--grid` sweeps `MOV_M_MIN`/`MOV_M_MAX`/`EHOG_SCALE`/`EHOG_LAMBDA` and prints Brier per combination.
Only `MOV_M_MIN`/`MOV_M_MAX` (and, unswept by this flag, `BETA_FACTOR`/`SIGMA_FLOOR`/
`SEASON_REGRESSION`) can move the score — `EHOG_SCALE`/`EHOG_LAMBDA` only reshape the μ/σ → display
transform and never reach `predict_win`'s raw μ/σ inputs, so their columns are expected to be flat.
Both modes are dry-run only; neither ever writes to the DB.

### Persisted pre-match snapshot

Every recompute (`api/ehog/recompute.py`, triggered after a score is submitted) predicts each
match's SHIRTS-win probability from that match's pre-match team states via the same `on_before_match`
hook the calibration harness uses, then writes it to `matches.pre_match_win_prob` — but only for
matches that don't already have one (`write_pre_match_win_probs()` in `engine.py`). First write wins:
once a match has a stored prediction it's frozen, so later formula or constant retunes (like a
`MOV_M_MIN` change) never rewrite what was expected *at the time*. `pre_match_win_prob_formula_version`
rides alongside it so a future formula version is distinguishable from matches predicted under an
earlier one. `ehog/backfill.py`'s dry-run/calibration modes never touch this column — only the live
recompute does.

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

# Calibration — Brier score + reliability bands for pre-match win predictions, dry-run only
python ehog/backfill.py --calibration
python ehog/backfill.py --calibration --grid

# Parity test — verify Python/TS produce identical results
python ehog/test_parity.py && npx tsx ehog/test_parity.ts
```

## Keeping Python and TS in sync

The rating math is ~10 lines in each language. The guard against drift is:

1. **Shared constants** — both sides read `ehog/constants.json`.
2. **Parity test** — `ehog/test_parity.py` generates fixtures from the Python engine; `ehog/test_parity.ts` verifies the TS predictor matches within float tolerance (1e-8).

If you change the math in `ehog/engine.py`, mirror it in `src/lib/ehog.ts`, regenerate fixtures, and run both tests.
