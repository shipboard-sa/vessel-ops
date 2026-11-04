"""
Purpose: The boat's sail-plan vocabulary and rules (Ship's Automation HB-09, the owner 2026-09-29) and the `sails.activeSet`
    value the cockpit Sail Plan tile writes into SignalK.
Version: v1 (2026-10-05)
Scope: PRODUCTION - mx-inv backend.
Architecture: Pure functions used by backend/routers/cockpit.py (GET / POST /api/cockpit/sail-plan). The value goes
    into SignalK through backend/boat_link.signalk_publish; the Ship's Automation history writer keeps `sails.**` as STATE
    forever (signals.yml), which is THE record of sail changes - mx-inv stores no copy. Feeds the polar-by-sail-set
    work (TD-09) and later WF-603. Rules (HB-09): Main down / full / reef 1-3; ONE headsail - Genoa or Staysail
    (never both: the rig is not a cutter pair) - full / reef 1-3, or none; wing-on-wing = main + genoa only.
    Asymmetric spinnaker and code zero are inactive placeholders (the Beneteau's are too small to rig); storm
    trysail + storm jib come before an ocean crossing - add them to HEADSAILS / a main option when aboard.
Invocation: imported by backend/routers/cockpit.py.
"""
from __future__ import annotations

from typing import Any

PATH = "sails.activeSet"

MAIN_STATES = ("down", "full", "reef1", "reef2", "reef3")
HEADSAILS = ("none", "genoa", "staysail")
HEADSAIL_STATES = ("full", "reef1", "reef2", "reef3")

_WORDS = {"full": "full", "reef1": "reef 1", "reef2": "reef 2", "reef3": "reef 3"}


class SailPlanError(ValueError):
    pass


def label(main: str, headsail: str, headsail_state: str | None, wing_on_wing: bool) -> str:
    """Plain words, also the grouping key on the polar dashboard: 'Main reef 1 + Genoa full, wing-on-wing'."""
    parts = []
    if main != "down":
        parts.append(f"Main {_WORDS[main]}")
    if headsail != "none":
        parts.append(f"{headsail.capitalize()} {_WORDS[headsail_state or 'full']}")
    text = " + ".join(parts) or "No sail (bare poles)"
    return text + (", wing-on-wing" if wing_on_wing else "")


def build(main: str, headsail: str, headsail_state: str | None, wing_on_wing: bool) -> dict[str, Any]:
    """Validate a tap and return the sails.activeSet value. Raises SailPlanError with a plain reason."""
    main, headsail = (main or "").strip().lower(), (headsail or "none").strip().lower()
    hs_state = (headsail_state or "").strip().lower() or None
    if main not in MAIN_STATES:
        raise SailPlanError(f"main must be one of {', '.join(MAIN_STATES)}")
    if headsail not in HEADSAILS:
        raise SailPlanError(f"headsail must be one of {', '.join(HEADSAILS)}")
    if headsail == "none":
        hs_state = None
    elif hs_state not in HEADSAIL_STATES:
        raise SailPlanError(f"say how the {headsail} is set: {', '.join(HEADSAIL_STATES)}")
    if wing_on_wing and (main == "down" or headsail != "genoa"):
        raise SailPlanError("wing-on-wing needs the main AND the genoa up")
    return {"main": main, "headsail": headsail, "headsailState": hs_state, "wingOnWing": bool(wing_on_wing),
            "label": label(main, headsail, hs_state, bool(wing_on_wing))}
