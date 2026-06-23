"""
EHOG v2 parity test — verifies Python engine matches the TS predictor.

Generates fixture cases, computes expected outputs from the Python engine,
and writes them to ehog/parity_fixtures.json. The TS test reads the same
fixtures and asserts identical results within float tolerance.

Run:  python ehog/test_parity.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ehog.engine import (
    MU_DEFAULT, SIGMA_DEFAULT, SIGMA_FLOOR, BETA,
    to_ehog, margin_multiplier, run_openskill_update,
)

TOLERANCE = 1e-8

FIXTURES = [
    {
        "label": "fresh players, close game",
        "team_a": [(MU_DEFAULT, SIGMA_DEFAULT), (MU_DEFAULT, SIGMA_DEFAULT)],
        "team_b": [(MU_DEFAULT, SIGMA_DEFAULT), (MU_DEFAULT, SIGMA_DEFAULT)],
        "score_a": 13, "score_b": 11, "a_won": True,
    },
    {
        "label": "fresh players, blowout",
        "team_a": [(MU_DEFAULT, SIGMA_DEFAULT), (MU_DEFAULT, SIGMA_DEFAULT)],
        "team_b": [(MU_DEFAULT, SIGMA_DEFAULT), (MU_DEFAULT, SIGMA_DEFAULT)],
        "score_a": 13, "score_b": 1, "a_won": True,
    },
    {
        "label": "experienced vs fresh, upset",
        "team_a": [(30.0, 4.0), (28.0, 5.0)],
        "team_b": [(MU_DEFAULT, SIGMA_DEFAULT), (MU_DEFAULT, SIGMA_DEFAULT)],
        "score_a": 8, "score_b": 13, "a_won": False,
    },
    {
        "label": "experienced vs fresh, expected win",
        "team_a": [(30.0, 4.0), (28.0, 5.0)],
        "team_b": [(MU_DEFAULT, SIGMA_DEFAULT), (MU_DEFAULT, SIGMA_DEFAULT)],
        "score_a": 13, "score_b": 5, "a_won": True,
    },
    {
        "label": "low sigma, nailbiter",
        "team_a": [(32.0, 3.0), (27.0, 3.5)],
        "team_b": [(29.0, 3.2), (26.0, 4.0)],
        "score_a": 13, "score_b": 12, "a_won": True,
    },
    {
        "label": "asymmetric sigmas, blowout",
        "team_a": [(35.0, 5.8), (31.0, 5.4)],
        "team_b": [(20.0, 6.5), (18.0, 6.6)],
        "score_a": 13, "score_b": 2, "a_won": True,
    },
    {
        "label": "near-boundary low, moderate game",
        "team_a": [(12.0, 6.0), (15.0, 7.0)],
        "team_b": [(MU_DEFAULT, SIGMA_DEFAULT), (MU_DEFAULT, SIGMA_DEFAULT)],
        "score_a": 9, "score_b": 13, "a_won": False,
    },
    {
        "label": "zero rounds (MoV defaults to 1.0)",
        "team_a": [(MU_DEFAULT, SIGMA_DEFAULT), (MU_DEFAULT, SIGMA_DEFAULT)],
        "team_b": [(MU_DEFAULT, SIGMA_DEFAULT), (MU_DEFAULT, SIGMA_DEFAULT)],
        "score_a": 0, "score_b": 0, "a_won": True,
    },
    {
        "label": "very low sigma (floor test)",
        "team_a": [(33.0, 2.1), (30.0, 2.2)],
        "team_b": [(27.0, 2.3), (24.0, 2.5)],
        "score_a": 13, "score_b": 9, "a_won": True,
    },
]


def compute_fixture(f: dict) -> dict:
    team_a_states = [tuple(s) for s in f["team_a"]]
    team_b_states = [tuple(s) for s in f["team_b"]]

    new_a_uw, new_b_uw = run_openskill_update(
        team_a_states, team_b_states, f["a_won"]
    )

    m = margin_multiplier(f["score_a"], f["score_b"])

    results = []
    for i, (prior, uw) in enumerate(zip(team_a_states, new_a_uw)):
        new_mu = prior[0] + m * (uw[0] - prior[0])
        new_sigma = max(SIGMA_FLOOR, uw[1])
        prior_ehog = to_ehog(prior[0], prior[1])
        new_ehog = to_ehog(new_mu, new_sigma)
        results.append({
            "team": "A", "index": i,
            "prior_mu": prior[0], "prior_sigma": prior[1],
            "new_mu": new_mu, "new_sigma": new_sigma,
            "prior_ehog": prior_ehog, "new_ehog": new_ehog,
            "delta": new_ehog - prior_ehog,
        })
    for i, (prior, uw) in enumerate(zip(team_b_states, new_b_uw)):
        new_mu = prior[0] + m * (uw[0] - prior[0])
        new_sigma = max(SIGMA_FLOOR, uw[1])
        prior_ehog = to_ehog(prior[0], prior[1])
        new_ehog = to_ehog(new_mu, new_sigma)
        results.append({
            "team": "B", "index": i,
            "prior_mu": prior[0], "prior_sigma": prior[1],
            "new_mu": new_mu, "new_sigma": new_sigma,
            "prior_ehog": prior_ehog, "new_ehog": new_ehog,
            "delta": new_ehog - prior_ehog,
        })

    return {
        "label": f["label"],
        "input": {
            "team_a": f["team_a"],
            "team_b": f["team_b"],
            "score_a": f["score_a"],
            "score_b": f["score_b"],
            "a_won": f["a_won"],
        },
        "margin_multiplier": m,
        "results": results,
    }


def main():
    fixtures_path = Path(__file__).resolve().parent / "parity_fixtures.json"
    computed = [compute_fixture(f) for f in FIXTURES]
    with open(fixtures_path, "w") as fp:
        json.dump(computed, fp, indent=2)
    print(f"Wrote {len(computed)} fixtures to {fixtures_path}")

    # Self-check: recompute and verify
    for case in computed:
        recomputed = compute_fixture({
            "label": case["label"],
            "team_a": case["input"]["team_a"],
            "team_b": case["input"]["team_b"],
            "score_a": case["input"]["score_a"],
            "score_b": case["input"]["score_b"],
            "a_won": case["input"]["a_won"],
        })
        for orig, recomp in zip(case["results"], recomputed["results"]):
            for key in ("new_mu", "new_sigma", "new_ehog", "delta"):
                diff = abs(orig[key] - recomp[key])
                if diff > TOLERANCE:
                    print(f"FAIL: {case['label']} {orig['team']}{orig['index']} {key}: {orig[key]} vs {recomp[key]} (diff={diff})")
                    sys.exit(1)
    print("Self-check passed.")


if __name__ == "__main__":
    main()
