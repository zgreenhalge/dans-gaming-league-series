---
name: chirp
description: >-
  Generate silly pre-game hype messages or roasts ("chirps") about a DGLS match —
  or a whole week of matches — using the REAL data. Use when the user asks to
  "make a chirp", "roast match #N", "hype up match N / week W", or similar.
  Optionally takes a writing style; if none is given, ask which one to use.
---

# DGLS Chirp Generator

Produce short, funny **pre-game hype / roasts** ("chirps") about DGLS matches,
grounded in each match's actual players and stats. The comedy has to be built on
real numbers — a winless player, a lopsided KD, a bye week — not invented facts.

## League format

DGLS is an **individual rotating mixer**: CS2 Wingman (2v2), teammates reshuffled
every week by random draw. **SHIRTS** and **SKINS** are ad-hoc pairings for that one
match, not standing teams — the two players on a faction almost always have
*different* individual win/loss records, and any record two teammates happen to
share is a coincidence, not a shared team record. Always attribute a stat
(record, KD, ADR, win rate) to the **individual player** it belongs to, never to
"the SHIRTS" or "the SKINS" as if they're a persistent roster. A pairing being
new/unfamiliar is fair game for a joke; implying they've played together before
or share a record is not.

## Inputs

- **Target** (required) — either a single match or a whole week. Parse it from
  the request or the argument:
  - **`m<N>`** (e.g. `m42`) or a bare number / "match #42" → a **single match**,
    `matches.id = N`.
  - **`s<S>w<W>`** (e.g. `s3w4`) or "season 3 week 4" / "week 4" → **week mode**:
    every played/scheduled match in that season+week (typically three).
  - If no target is given, ask.
- **Style** (optional) — a named voice. Resolution depends on target:
  - **Named style** (e.g. `noir`, "in pirate voice", "like a WWE promo") → use
    it. In week mode, use that one style for **every** match.
  - **`random` / "surprise me"** (as an argument or in the request) → **don't
    prompt.** Single match: roll one style, name it, run it. Week mode: roll
    **independently for each match** (duplicates are fine), naming each match's
    rolled style.
  - **No style at all** →
    - *Single match:* show the Style List below and ask which one they want
      before writing anything (pick by number or name).
    - *Week mode:* first ask **how they want to style the week** — (a) prompt
      per match, (b) one style for all of them, or (c) random per match — then
      follow their choice (for a/b, then collect the actual style(s); for c,
      proceed like `random`).

  **When showing the Style List to ask, print the full numbered list (all 16
  entries, as written below) as plain text and let them reply with a number or
  name — don't use a multiple-choice/quick-reply tool for this.** Those tools
  cap out at a handful of options, which silently hides most of the list from
  the user; this is a case where a plain-text question is the right tool, not
  a UI shortcut.

  Only prompt in the "no style" cases above. Once chirps are written the user
  can always ask you to redo any of them in a different voice — so don't
  over-ask.

  **If a style the user passed is ever unclear** — an abbreviation or phrase you
  can't confidently map to a Style List entry (or a reasonable off-list voice) —
  **stop and ask them to clarify or pick from the list. Don't guess.** A clear
  match to a list entry (e.g. `noir` → Film noir detective) or an obvious
  off-list voice (e.g. "like a pirate") is fine to use without asking.

## Step 1 — Pull the real match data

All data lives in Supabase; credentials are in `.env.local` at the repo root.
Every block below assumes these two lines have been run once:

```bash
K=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2)
U=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2)
```

**`season_id` is NOT the season number.** IDs don't track the human number
(the Season 1 & 2 *gauntlets* are ids 6 & 7). Always resolve the regular-season
id by name first:

```bash
S=3   # <-- the human season number from s<S>w<W>
# note the %20 — the space in the name must be URL-encoded or curl errors
curl -s "$U/rest/v1/seasons?name=ilike.Season%20${S}%20Regular*&is_gauntlet=eq.false&select=id" -H "apikey: $K" -H "Authorization: Bearer $K"
# -> SID (the season_id to use everywhere below)
```

### Week mode (`s<S>w<W>`) — batch it

Fetch the whole week in a handful of calls, **not** per-match. After resolving
`SID` above:

```bash
W=4   # <-- the week number
# week row -> its id (WID) + bye_player_id
curl -s "$U/rest/v1/weeks?season_id=eq.$SID&week_number=eq.$W&select=id,bye_player_id" -H "apikey: $K" -H "Authorization: Bearer $K"

# all matches in the week
curl -s "$U/rest/v1/matches?week_id=eq.$WID&select=id,match_number,final_score,is_feature_match,is_playoff_game,scheduled_at&order=match_number" -H "apikey: $K" -H "Authorization: Bearer $K"

# then ONE call each for the whole week, using in.(...) over every match id / player id:
curl -s "$U/rest/v1/player_match_stats?match_id=in.(44,45,46)&select=match_id,player_id,faction,kills,deaths,adr,is_win" -H "apikey: $K" -H "Authorization: Bearer $K"
curl -s "$U/rest/v1/players?id=in.(7,8,12,13,...,BYE)&select=id,name" -H "apikey: $K" -H "Authorization: Bearer $K"
curl -s "$U/rest/v1/player_season_leaderboard?player_id=in.(7,8,12,13,...)&season_id=eq.$SID&select=player_id,player_name,matches_won,matches_lost,win_rate_percentage,kd_ratio,overall_adr" -H "apikey: $K" -H "Authorization: Bearer $K"
```

### Single match (`m<N>`)

```bash
MID=42
# the match (grab week_id, is_playoff_game, score, feature flag)
curl -s "$U/rest/v1/matches?id=eq.$MID&select=id,week_id,match_number,final_score,is_feature_match,is_playoff_game,scheduled_at" -H "apikey: $K" -H "Authorization: Bearer $K"
# its four participants + factions (kills/deaths/adr/is_win matter only if it's already been played)
curl -s "$U/rest/v1/player_match_stats?match_id=eq.$MID&select=player_id,faction,kills,deaths,adr,is_win" -H "apikey: $K" -H "Authorization: Bearer $K"
# season_id for the stats query (from the match's week)
curl -s "$U/rest/v1/weeks?id=eq.$WID&select=season_id" -H "apikey: $K" -H "Authorization: Bearer $K"
# names + season stats for the four players
curl -s "$U/rest/v1/players?id=in.(4,11,3,5)&select=id,name" -H "apikey: $K" -H "Authorization: Bearer $K"
curl -s "$U/rest/v1/player_season_leaderboard?player_id=in.(4,11,3,5)&season_id=eq.$SID&select=player_id,player_name,matches_won,matches_lost,win_rate_percentage,kd_ratio,overall_adr" -H "apikey: $K" -H "Authorization: Bearer $K"
```

(All ids shown above are example values — replace with what you actually get back.)

### Step 1b — Advanced context (sabremetrics, EHOG, H2H)

Beyond the basic scoreboard stats above, the site tracks deeper stats worth mining for a chirp:
sabremetric "+" ratios (rate vs. league average that season), raw accuracy/mechanics numbers,
current EHOG skill rating, projected EHOG swing for the match, and career head-to-head history
between the four players. Pull all of it in one call via the reusable script (reuses the app's
own query/rating logic, so the numbers can't drift from what the site shows):

```bash
npx tsx scripts/match-context.ts $MID          # single match
npx tsx scripts/match-context.ts 44 45 46      # week mode — pass every match id at once
```

This needs the same Supabase env vars loaded into the shell (not just read with `grep`):

```bash
set -a; . ./.env.local; set +a
```

The JSON it prints, per match:
- `seasonSabremetrics[playerId]` — that player's `+` stats for the season (`kprPlus`, `aprPlus`,
  `dprPlus`, `kdrPlus`, `adrPlus`, `entryPlus`, `kastPlus`, `objectivePlus`, `utilityPlus`,
  `clutchPlus`, per the formulas in `docs/calculations.md`), plus raw `mechanics` rates
  (`accuracy`, `headAccuracy`, `counterStrafePct`, `sprayAccuracy`). `sampleMatches` is how many
  of that player's *season* matches have demo-derived data — **this will usually be small (1-3)
  early in a season**, since these stats only exist for matches with an uploaded/parsed demo.
  Always weigh a `+` stat's sample size before leaning on it in the chirp; a 1.4 KPR+ off one
  match is a footnote, not a headline.
- `ehogProjections` — four representative-scoreline scenarios (blowout each way, close each way),
  each with **a separate EHOG delta per player** — like Premier rating, EHOG is an individual
  stat, so the four players in a match are never all gaining or all losing the same amount, even
  on the same team. **Never pool these into one shared number** ("X points on the line" for the
  match) — if you use a projection, cite it per player (e.g. "a blowout swings Adam +3.9 but
  Kevin +7.5 — the two SHIRTS aren't equally exposed tonight").
- `roster[].currentEhog` — each player's current EHOG rating (10-100 scale), individual.
- `roster[].trophyCase` — that player's podium finishes across every completed season (regular
  season top-3 by canonical rank, gauntlet champion/2nd/3rd), each entry with `season_name`,
  `is_gauntlet`, and `rank` (1/2/3). **Use this for respect, never mockery.** All three ranks are
  fair game — a 2nd or 3rd is real proof of sustained strong play across a whole season, not a
  punchline about "never winning." Frame it as credentials (e.g. "a two-time podium finisher," "has
  medaled in three straight seasons"), and where it's illuminating, use it comparatively against
  the *other players in this match* ("the only one of tonight's four with any hardware at all," "a
  podium finisher going up against someone who's never medaled") rather than in isolation. An empty
  `trophyCase` is not itself a joke — don't needle a player over the absence of hardware, just
  contrast it neutrally if it's relevant. Also never frame *tonight's single match* as the thing
  that could change a season-long standing — one regular-season game doesn't decide a title or a
  podium, so don't write "will he finally win it tonight."
- `h2h` — one entry per pair of the four players, tagged `relation: "rival"` (opponents this
  match) or `"duo"` (teammates this match), each with career-wide stats (`meetings`, `aWins`/
  `bWins`, per-player career `aStats`/`bStats`, `mapBreakdown`, and the actual `matches` list).
  **`stats: null` means they've never shared a match before** — a genuinely notable "first-ever
  meeting" angle, not a data gap to route around. `meetings` and everything under `stats` is
  **all-time/career**, never season-scoped — label it that way if you use it.
- A `{ matchId, error }` entry (instead of the full shape) means the script skipped that match —
  currently only for gauntlet matches (see Step 1's existing gauntlet rule). Surface the reason,
  don't retry with the basic-stats-only flow silently.

Notes on the data:
- Teams are **SHIRTS** vs **SKINS** (the `faction` column). Two players a side.
- **Gauntlet / playoff matches aren't supported yet.** If a match has
  `is_playoff_game: true` (gauntlet seasons store *all* matches that way, and
  `player_season_leaderboard` excludes them), stop and tell the user this skill
  only handles regular-season matches — don't chirp it with missing/zero stats.
- **Empty result = doesn't exist.** If the match/week query comes back `[]`,
  say so and stop; never invent a matchup.
- **A player with no leaderboard row is unproven** (first match of the season).
  Play that up — "no track record", "the rookie" — don't fabricate stats.
- `final_score` of `"0-0"` / `is_win` all false means the match **hasn't been
  played yet** → write it as *pre-game hype*, not a recap. If real scores exist,
  you may write it as a post-game roast instead.
- **Round `overall_adr` to a whole number** for display (it comes back as a long
  float). Only show a decimal if the joke hinges on a tiny ADR gap between two
  players.
- `is_feature_match: true` is worth playing up — it's the marquee match.
- The **bye player** (`weeks.bye_player_id`) is fair game — nobody undefeated
  like the guy who didn't play — **but only in week mode.** A single-match chirp
  (`m<N>`) is about that match's four players only; don't mention the bye there.
- Great roast fuel: a 0-win record, a KD below 1.0, a huge ADR gap between
  teammates, a 100% winrate tryhard, a feature-match choke setup, a standout/
  cellar-dwelling sabremetric `+` stat (with a real sample behind it), a lopsided
  or long-running rival H2H record, a first-ever meeting between two players, a
  notably lopsided per-player EHOG stake, or a real championship in a player's
  trophy case (see the `trophyCase` note above for what's fair game there).
- **Surface outliers, don't manufacture them.** Advanced stats (sabremetrics,
  H2H, EHOG) are a deeper well to pull from, not a checklist to empty into every
  chirp. Only mention one if it's genuinely discussion-worthy — a real league-wide
  extreme, a real streak/rivalry, a striking coincidence — and it clears its own
  bar (see the sample-size note in Step 1b for `+` stats). A middling `+` stat or
  a single-meeting H2H with nothing interesting in it is exactly the kind of thing
  that shouldn't get forced into a storyline. Basic stats (record, KD, ADR) are
  always fair game since every match has them; advanced stats are a bonus, used
  only when they earn their spot.

## Guardrails checklist

Before emitting any chirp, verify each of these against the data actually pulled
in Step 1 — not against memory or assumption. If any item doesn't check out, fix
it or stop and say what's wrong; never guess to fill a gap.

- **Date/time** — the scheduled day/time stated in the chirp is `matches.scheduled_at`
  for *that* match, converted to a real calendar day (don't invent or assume a day
  of the week).
- **Players** — every name used is the player actually returned for that
  `player_id` in this match/week's data, not a name recalled from a previous
  chirp or a different match.
- **All-time vs. seasonal stats** — `player_season_leaderboard` rows pulled via
  `season_id=eq.$SID` are **season-only**. Never state a seasonal number as if
  it's a career number (or vice versa) — if the request calls for career stats,
  say so explicitly and pull career data instead of silently reusing the season
  query.
- **Faction assignment** — each player is paired with the SHIRTS/SKINS faction
  `player_match_stats` actually returned for them, and (per League format above)
  their stats are never blended into a shared "team" record with their faction
  partner.
- **Season/week/match reference** — the season number, week number, and match
  number named in the chirp all resolve to the same `SID`/`WID`/`MID` the data
  was actually queried with — don't let a header say "Week 4" while the data
  pulled is Week 5's.
- **Advanced-stat sourcing** — any sabremetric `+`, mechanics rate, EHOG number,
  H2H fact, or trophy traces back to `scripts/match-context.ts`'s output for
  *this* match, not a different match, a different season, or a guess at what a
  player's numbers "probably" look like. A `+` stat is only used with its
  `sampleMatches` count kept in mind, and H2H facts are labeled as career/
  all-time (never implied to be this-season-only).
- **EHOG is per-player** — any EHOG rating or projected delta named belongs to
  one specific player, never averaged or pooled across a faction/team as if
  it's a shared stake.
- **Trophy accuracy** — a title/podium mentioned for a player is present in
  their `trophyCase` with the matching `rank` and `is_gauntlet` value; don't
  call a regular-season 1st a "gauntlet champion" or vice versa, and don't
  credit a podium to a player whose `trophyCase` is empty.

## Step 2 — Write the chirp

- **Emit the chirp as raw markdown inside a fenced code block** (```` ```md ````
  … ````` ``` `````) so the user can copy/paste it and keep the exact
  formatting. Any framing you add (which style was rolled, etc.) goes *outside*
  the fence; only the chirp text itself goes inside. In week mode, put **each
  match's chirp in its own code block**.
- Keep it short — a few punchy lines, Discord-postable.
- Name the real players and weave in their real numbers.
- Commit **hard** to the chosen voice; the bit is the whole point.
- Keep it playful trash-talk, never actually mean-spirited. PG-ish.
- End with a signature/sign-off that fits the voice.
- **Week mode:** write one chirp per match, in `match_number` order, each with a
  clear header (e.g. `### Match #42 — SHIRTS vs SKINS`). If a style was rolled or
  chosen per match, note that match's style in its header. You can add a short
  week-wide intro/outro, but each match gets its own self-contained chirp.
- **Structure tip for announcer-style voices** (WWE, SportsCenter, town crier,
  ring announcer, etc.): introduce **all four players first** (both sides, back
  to back), *then* land the storyline beat (H2H rematch, rivalry, trophy case,
  stakes) as its own section afterward, rather than interleaving a player's
  stats with a story point about them mid-introduction. Reads cleaner — the
  intro builds the cast, the story pays it off. Voices without a formal
  "introduction" beat (Bob Ross, noir, Attenborough, etc.) don't need to force
  this shape; use whatever structure suits how that voice naturally unfolds.

## Style List

1. **Bob Ross** — gentle, soothing, everything's a happy accident. "And maybe,
   right here, we'll put a happy little 0-3 record. There are no losses, only
   happy little learning opportunities. Let's give Brian a friend."
2. **Cave-man / caveman speak** — grunty, primal, no articles. "SEAN strong.
   KEVIN club own foot. 0.51 KD. Brian no win, ever. Ugh. Rock beat scoreboard."
3. **Corporate LinkedIn thought-leader** — "Agree? 🔽 Match #42 taught me 3
   lessons about resilience. Kevin's 0.51 KD is not a failure — it's a growth
   opportunity. #Grindset #Wingman".
4. **David Attenborough nature doc** — hushed reverent narration. "Here, in the
   dim glow of the server, the winless Brian ventures out once more, hoping this
   season to finally… feed."
5. **Epic / Homeric myth** — "Sing, O Muse, of the wrath of Sean, whose 100%
   winrate laid low a thousand SKINS…"
6. **Film noir detective** — world-weary voiceover, past tense, rain on the
   server window. "Brian walked in 0-and-3. The kind of record that follows a
   man. I lit a cigarette and checked the ADR. It didn't look good for anybody."
7. **Gen Z brainrot** — skibidi, rizz, gyatt, "no cap", Ohio, fanum tax, "he's
   so mid", "-7 aura", "it's giving winless". Maximum unhinged zoomer slang.
8. **Gordon Ramsay kitchen roast** — "This ADR is so RAW it's still walking
   around the server! Kevin, you donkey, 52 damage a round?! GET OUT."
9. **Late-night infomercial** — "But WAIT — there's MORE! Tired of a 0.51 KD
   weighing you down? Introducing SEAN, sold separately! Call now and we'll
   throw in a SECOND loss absolutely FREE!"
10. **Medieval town crier** — "HEAR YE, HEAR YE! Let it be known throughout the
    realm that on the morrow, the winless Brian shall once more test his blade!"
11. **Navy SEAL "Gorilla Warfare"** — the over-the-top tough-guy copypasta.
    "What did you just say about my ADR, you little— I graduated top of my class
    in the Wingman gauntlet…" Absurd escalating threats, "I have over 300
    confirmed kills."
12. **Pirate sea shanty** — "Yo ho, a chirp for ye!", rhyming verse, "Brian's
    ship be sinkin' at nought-and-three, arr."
13. **SportsCenter anchor** — breathless ESPN hype-man cadence, "You wanna talk
    about a MISMATCH? Let's go to the tape." Stat-drop after stat-drop.
14. **t3h PeNgU1N oF d00m** — the classic scene-kid copypasta. Leetspeak,
    "SOOOO random!!!", *holds up spork* 🥄, waffles, DOOOOMMM, xD, "im mature 4
    my age", sign off "love and waffles".
15. **WWE promo / ring announcer** — ALL CAPS hype, "IN THIS CORNER…",
    "AND HIS TAG PARTNER, THE 0.51 KD MACHINE…", body-slam metaphors, "AND HIS
    NAME IS…"
16. **Ye Olde Shakespearean** — thee/thou/hark, iambic drama, "What light through
    yonder scoreboard breaks? 'Tis Sean, and his winrate is the sun."

Feel free to riff on these or blend two if it lands — the list is a menu, not a
cage.
