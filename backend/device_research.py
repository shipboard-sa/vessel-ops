"""device_research.py - run headless Claude Code to draft one device's tree entry from its manual.

Purpose: Build the research prompt for one device (manual path(s) + the living instructions doc +
    whatever the systems tree already has for it), run the Claude Code CLI headless on the user's
    own subscription, and turn its reply into a validated JSON draft (make/model, tasks, spares) or
    an explicit INCOMPLETE placeholder on any failure. Never writes to the database itself - the
    caller (device_research_jobs.py, then the frontend review panel) owns applying a draft.
Version: v2 (2026-09-24) - v2: manuals folder from Settings / MXINV_MANUALS_ROOT (no hard-coded path); MXINV_CLAUDE_EXE (HYLAS_CLAUDE_EXE still honoured); status reports a missing folder or instructions doc. v1 (2026-09-22)
Scope: PRODUCTION - mx-inv feature (driven by device_research_jobs.py and a frontend review panel).
Architecture: mx-inv backend support module. This is the mx-inv sibling of 
    research.py, deliberately mirrored line-for-line where the problem is identical (locating the
    CLI, sanitizing its environment, running the subprocess, the cancel/timeout poll loop) since
    those are already solved and live-verified there; only the prompt, tool set, output schema and
    validation differ, because this reads ONE LOCAL manual file rather than searching the web.
    device_research_jobs.py calls research_device() once per job on a background thread;
    backend/routers/device_research.py exposes that as /api/device-research.

Design decisions this module encodes (mirrors 

* Auth is CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`), passed to the child.
  ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are stripped so usage can never become metered API
  billing. Never pass --bare: it never reads OAuth.
* Read-only filesystem access (the Read tool only, cwd fixed to the Manuals folder) - no web, no
  MCP, no writes possible even in principle.
* The reply is untrusted text: it is validated (must be a JSON object with the required shape),
  never executed, never applied without a human review step.
* The system prompt is loaded from references/DEVICE_MANUAL_RESEARCH_INSTRUCTIONS.md at RUN TIME,
  not baked into this file, so the owner can tune the research recipe by editing that document alone -
  see its own header and CHECKPOINT.md #50 for why.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

ENV_EXE = "MXINV_CLAUDE_EXE"
LEGACY_ENV_EXE = "HYLAS_CLAUDE_EXE"  # the original install's name, still honoured
ENV_MANUALS = "MXINV_MANUALS_ROOT"
ENV_TOKEN = "CLAUDE_CODE_OAUTH_TOKEN"
# The ``error`` of a DeviceResult whose run was cancelled (the job registry keys on it).
CANCELLED = "cancelled"



def manuals_root(env: Mapping[str, str] | None = None) -> Path | None:
    """The folder of device manuals the research run reads (and uses as its cwd): the
    Settings screen's "Manuals folder", else the MXINV_MANUALS_ROOT environment variable.
    None = not set up, so the feature reports itself unavailable instead of guessing."""
    env = os.environ if env is None else env
    try:
        import data  # local import: keeps this module importable without a database
        configured = data.get_settings().get("manuals_root", "").strip()
    except Exception:  # noqa: BLE001 - a missing database must not break the status check
        configured = ""
    configured = configured or env.get(ENV_MANUALS, "").strip()
    return Path(configured) if configured else None
INSTRUCTIONS_PATH = Path(__file__).resolve().parents[1] / "references" / "DEVICE_MANUAL_RESEARCH_INSTRUCTIONS.md"


class DeviceResearchError(Exception):
    """Base for this feature's own errors."""


class DeviceResearchUnavailableError(DeviceResearchError):
    """The feature cannot run here: the Claude Code CLI is missing or not configured. Raised
    before any work starts, never mid-run."""


class DeviceResearchOutputError(DeviceResearchError):
    """The model's reply is not a usable draft (not JSON, or missing the required shape). The raw
    reply is available as ``raw``."""

    def __init__(self, message: str, raw: str = "") -> None:
        super().__init__(message)
        self.raw = raw


# Removed from the child's environment (compared upper-cased) so a stray key can never make this a
# metered-API run, and so a backend started from inside a Claude session does not hand its session
# plumbing (proxy URL, host auth, messaging sockets) to the research child, which must authenticate
# only with the subscription token. Identical to 
_STRIPPED_ENV = frozenset({
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
    "CLAUDECODE", "CLAUDE_PID", "CLAUDE_AGENT_SDK_VERSION",
    "USE_LOCAL_OAUTH", "USE_STAGING_OAUTH",
})
_STRIPPED_PREFIXES = ("CLAUDE_CODE_", "CLAUDE_PREVIEW_")
_SECRET_NAME_RE = re.compile(r"TOKEN|SECRET|PASSWORD|API_KEY", re.IGNORECASE)

RESEARCH_TOOLS: tuple[str, ...] = ("Read",)

DEFAULT_TIMEOUT_S = 600.0
_POLL_S = 0.5  # how often a running CLI is checked for cancellation
# Runaway backstop, NOT an estimate - reading one manual should cost much less than routing's open
# web research (no WebSearch/WebFetch turns), but there is no live data yet to set this from.
DEFAULT_MAX_BUDGET_USD = 2.0


# --------------------------------------------------------------------------
# Locating the CLI and checking it is usable (identical logic to research.py -
# same desktop app, same Windows MSIX-package virtualization problem)
# --------------------------------------------------------------------------


def _version_key(name: str) -> tuple[int, ...]:
    return tuple(int(p) if p.isdigit() else 0 for p in re.split(r"[.\-+]", name))


def _bundled_roots(env: Mapping[str, str]) -> list[Path]:
    """Folders that may hold the desktop app's per-version ``claude.exe`` copies.

    The app is a packaged (Store/MSIX) app: Windows redirects ITS view of ``%APPDATA%`` to
    ``%LOCALAPPDATA%\\Packages\\Claude_<id>\\LocalCache\\Roaming``, and that redirect is invisible
    to a normal process. A backend started by ``run-live.bat`` therefore sees nothing under
    ``%APPDATA%\\Claude`` and must look in the package folder instead. Both are searched.
    """
    roots: list[Path] = []
    appdata = env.get("APPDATA", "").strip()
    if appdata:
        roots.append(Path(appdata) / "Claude" / "claude-code")
    local = env.get("LOCALAPPDATA", "").strip()
    if local:
        packages = Path(local) / "Packages"
        if packages.is_dir():
            roots.extend(sorted(packages.glob("Claude_*/LocalCache/Roaming/Claude/claude-code")))
    return roots


def _newest_bundled(roots: list[Path]) -> Path | None:
    candidates = [
        d for root in roots if root.is_dir()
        for d in root.iterdir() if d.is_dir() and (d / "claude.exe").is_file()
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda d: _version_key(d.name)) / "claude.exe"


def find_claude_exe(
    env: Mapping[str, str] | None = None,
    *,
    which: Callable[[str], str | None] = shutil.which,
) -> Path | None:
    """Locate the Claude Code CLI, or ``None`` if there is none. Order: ``MXINV_CLAUDE_EXE`` (or legacy ``HYLAS_CLAUDE_EXE``)
    override (must exist, else an error), then ``claude`` on PATH, then the newest copy bundled
    with the desktop app."""
    env = os.environ if env is None else env
    override = (env.get(ENV_EXE, "") or env.get(LEGACY_ENV_EXE, "")).strip()
    if override:
        path = Path(override)
        if not path.is_file():
            raise DeviceResearchUnavailableError(f"{ENV_EXE} points to {override!r}, which is not a file")
        return path
    on_path = which("claude")
    if on_path:
        return Path(on_path)
    return _newest_bundled(_bundled_roots(env))


def child_env(env: Mapping[str, str]) -> dict[str, str]:
    """The environment for the CLI subprocess: the parent's, minus metered-API credentials,
    inherited Claude-session state and any other secret-looking variable."""

    def keep(name: str) -> bool:
        if name.upper() == ENV_TOKEN:
            return True
        upper = name.upper()
        return not (
            upper in _STRIPPED_ENV
            or upper.startswith(_STRIPPED_PREFIXES)
            or _SECRET_NAME_RE.search(name)
        )

    return {k: v for k, v in env.items() if keep(k)}


@dataclass(frozen=True, slots=True)
class ResearchStatus:
    available: bool
    reason: str
    exe: Path | None = None


def research_status(
    env: Mapping[str, str] | None = None,
    *,
    which: Callable[[str], str | None] = shutil.which,
) -> ResearchStatus:
    """Cheap, offline readiness check: CLI found and the token variable set. Cannot prove the
    token is valid; a bad token surfaces as a failed run."""
    env = os.environ if env is None else env
    try:
        exe = find_claude_exe(env, which=which)
    except DeviceResearchUnavailableError as exc:
        return ResearchStatus(False, str(exc))
    if exe is None:
        return ResearchStatus(
            False,
            f"Claude Code CLI not found. Install it or set {ENV_EXE} to the full path of claude.exe.",
        )
    if not env.get(ENV_TOKEN, "").strip():
        return ResearchStatus(
            False,
            f"{ENV_TOKEN} is not set. Run `claude setup-token`, set the token as a user "
            "environment variable, and restart the app.",
            exe,
        )
    root = manuals_root(env)
    if root is None:
        return ResearchStatus(False, "No manuals folder set - set it in Settings (Manuals folder).", exe)
    if not root.is_dir():
        return ResearchStatus(False, f"Manuals folder not found at {root} - fix it in Settings.", exe)
    if not INSTRUCTIONS_PATH.is_file():
        return ResearchStatus(False, f"Research instructions not found at {INSTRUCTIONS_PATH}.", exe)
    return ResearchStatus(True, "ready", exe)


# --------------------------------------------------------------------------
# Prompt
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ResearchPrompt:
    system: str
    user: str


def _load_instructions() -> str:
    """The living recipe, re-read every run so an edit to the instructions doc takes effect
    immediately - no redeploy. Missing file is a hard error: better than silently researching
    with no rules."""
    try:
        return INSTRUCTIONS_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        raise DeviceResearchUnavailableError(
            f"instructions doc not found at {INSTRUCTIONS_PATH} - cannot research without it"
        ) from exc


_OUTPUT_SCHEMA = """\
Reply with ONLY a single JSON object (no preamble, no closing remarks, no code fence), matching \
exactly this shape:

{
  "device_name": "string - the device name as given, or your best function-based name if none was given",
  "make_model": "string or null",
  "manual_ref": "string or null - the manual's path RELATIVE to the manuals folder (your working directory), using backslashes",
  "key_specs": ["short strings - only specs relevant to maintenance or spares, not a full datasheet dump"],
  "tasks": [
    {"name": "string", "period": "string, a number of days as text e.g. '90', or null for a one-off",
     "interval_type": "one of: days, hrs, use, break_fix",
     "description": "string - what to actually do",
     "source": "a references/PROVENANCE.md tag, e.g. 'MAN:filename.pdf p.12'"}
  ],
  "spares": [
    {"item_name": "string", "item_type": "one of: part, spare_unit, supply, tool, tool_accessory",
     "why": "string - why this is the right spare, and whether it should be a whole-unit spare or a part",
     "source": "a references/PROVENANCE.md tag"}
  ],
  "notes": "string or null - anything worth recording on the device (mismatches found, caveats, general context)",
  "needs_your_answer": ["strings - questions only the boat's owner can answer, e.g. which physical unit, what it feeds, install-vs-spare count"],
  "sources_used": ["the PROVENANCE.md tags actually cited above, e.g. 'MAN:34439-Orion-Tr_Smart_DC-DC_Charger-pdf-en.pdf'"]
}

Empty arrays are fine and expected - do not invent a task or spare that is not really supported by \
the manual. If nothing sourced was found at all, return empty arrays/nulls and explain why in \
"notes", rather than forcing content to appear.\
"""


def build_prompt(
    device_name: str,
    *,
    manual_paths: list[str] | None = None,
    parent_system: str | None = None,
    existing_make_model: str | None = None,
    existing_notes: str | None = None,
    today: datetime | None = None,
) -> ResearchPrompt:
    """The full prompt for researching one device. Pure, so it is unit-testable."""
    today = today or datetime.now(UTC)
    device_name = device_name.strip()
    manuals_block = (
        "\n".join(f"- {p}" for p in manual_paths) if manual_paths
        else "(none given - search under the manuals folder (your working directory) yourself for a matching manual)"
    )
    existing_block = ""
    if existing_make_model or existing_notes:
        existing_block = (
            "\n## Already in the systems tree for this device - do not contradict without saying so\n"
            f"Make/model on file: {existing_make_model or '(none)'}\n"
            f"Notes on file: {existing_notes or '(none)'}\n"
        )
    parent_line = f"Parent system: {parent_system}\n" if parent_system else ""
    user = f"""\
Research ONE device for the mx-inv maintenance/inventory system and return one JSON draft.

Today's date: {today.date().isoformat()}
Device, as described by the boat's owner: {device_name}
{parent_line}
## Manual(s) given (read with the Read tool, using this exact path under the manuals folder (your working directory))
{manuals_block}
{existing_block}
{_OUTPUT_SCHEMA}
"""
    return ResearchPrompt(system=_load_instructions(), user=user)


# --------------------------------------------------------------------------
# Validating and shaping the reply
# --------------------------------------------------------------------------

_REQUIRED_KEYS = (
    "device_name", "make_model", "manual_ref", "key_specs", "tasks", "spares",
    "notes", "needs_your_answer", "sources_used",
)


@dataclass(frozen=True, slots=True)
class DeviceDraft:
    """A validated draft. Always safe to show the user - either real content or an explicit
    incomplete marker in ``notes``."""

    device_name: str
    make_model: str | None
    manual_ref: str | None
    key_specs: tuple[str, ...]
    tasks: tuple[dict[str, Any], ...]
    spares: tuple[dict[str, Any], ...]
    notes: str | None
    needs_your_answer: tuple[str, ...]
    sources_used: tuple[str, ...]
    incomplete: bool = False


def validate_draft(text: str, device_name: str) -> DeviceDraft:
    """Parse the model's reply into a :class:`DeviceDraft`, or raise
    :class:`DeviceResearchOutputError`. Tolerates a wrapping code fence; requires valid JSON with
    every required key present (missing keys default sensibly rather than failing outright, since
    a model omitting an empty array is a minor formatting slip, not a real failure)."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[A-Za-z]*\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        data = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise DeviceResearchOutputError(f"reply is not valid JSON: {exc}", raw=text) from exc
    if not isinstance(data, dict):
        raise DeviceResearchOutputError("reply is not a JSON object", raw=text)
    missing = [k for k in _REQUIRED_KEYS if k not in data]
    if missing:
        raise DeviceResearchOutputError(f"reply is missing key(s): {', '.join(missing)}", raw=text)

    def _list(key: str) -> tuple[Any, ...]:
        v = data.get(key) or []
        return tuple(v) if isinstance(v, list) else ()

    return DeviceDraft(
        device_name=str(data.get("device_name") or device_name),
        make_model=(data.get("make_model") or None),
        manual_ref=(data.get("manual_ref") or None),
        key_specs=tuple(str(s) for s in _list("key_specs")),
        tasks=tuple(t for t in _list("tasks") if isinstance(t, dict)),
        spares=tuple(s for s in _list("spares") if isinstance(s, dict)),
        notes=(data.get("notes") or None),
        needs_your_answer=tuple(str(s) for s in _list("needs_your_answer")),
        sources_used=tuple(str(s) for s in _list("sources_used")),
    )


def incomplete_draft(device_name: str, reason: str, when: datetime) -> DeviceDraft:
    """A draft-shaped placeholder for any failure, so the caller never has to special-case
    'no result' - always something safe to show, clearly marked incomplete."""
    return DeviceDraft(
        device_name=device_name,
        make_model=None,
        manual_ref=None,
        key_specs=(),
        tasks=(),
        spares=(),
        notes=f"RESEARCH INCOMPLETE: {reason} at {when:%Y-%m-%d %H:%M} UTC",
        needs_your_answer=(),
        sources_used=(),
        incomplete=True,
    )


# --------------------------------------------------------------------------
# Running the CLI (identical to research.py - the subprocess boundary is not
# routing-specific at all)
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RunRequest:
    args: tuple[str, ...]
    stdin: str
    env: Mapping[str, str]
    cwd: Path
    timeout_s: float
    # Set from another thread to abandon the run: the process tree is killed and the output comes
    # back with ``cancelled=True``. ``None`` means uncancellable.
    cancel: threading.Event | None = None


@dataclass(frozen=True, slots=True)
class RunOutput:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False
    cancelled: bool = False


Runner = Callable[[RunRequest], RunOutput]


def _kill_tree(proc: subprocess.Popen[str]) -> None:
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, check=False)
    else:
        proc.kill()


def run_subprocess(req: RunRequest) -> RunOutput:
    """Run the CLI, feed ``req.stdin``, enforce the wall-clock timeout (there is no --max-turns
    flag) and kill the whole process tree if it is exceeded or if ``req.cancel`` is set (checked
    every ``_POLL_S`` seconds)."""
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        creationflags = 0
    proc = subprocess.Popen(
        list(req.args), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=req.cwd, env=dict(req.env), text=True, encoding="utf-8", errors="replace",
        creationflags=creationflags,
    )
    deadline = time.monotonic() + req.timeout_s
    pending_input: str | None = req.stdin
    while True:
        remaining = deadline - time.monotonic()
        if req.cancel is not None and req.cancel.is_set():
            _kill_tree(proc)
            out, err = proc.communicate()
            return RunOutput(-1, out or "", err or "", cancelled=True)
        if remaining <= 0:
            _kill_tree(proc)
            out, err = proc.communicate()
            return RunOutput(-1, out or "", err or "", timed_out=True)
        try:
            out, err = proc.communicate(pending_input, timeout=min(_POLL_S, remaining))
        except subprocess.TimeoutExpired:
            pending_input = None
            continue
        return RunOutput(proc.returncode, out or "", err or "")


def build_args(
    exe: Path,
    system_prompt: str,
    *,
    max_budget_usd: float = DEFAULT_MAX_BUDGET_USD,
    model: str | None = None,
    effort: str | None = None,
) -> tuple[str, ...]:
    """The CLI argv. Never includes --bare (it would drop OAuth). The prompt itself goes on
    stdin (avoids Windows command-line length/quoting limits)."""
    args = [
        str(exe),
        "-p",
        "--output-format", "json",
        "--no-session-persistence",
        "--tools", ",".join(RESEARCH_TOOLS),
        "--allowedTools", *RESEARCH_TOOLS,
        "--permission-mode", "dontAsk",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-chrome",
        "--append-system-prompt", system_prompt,
        "--max-budget-usd", f"{max_budget_usd:g}",
    ]
    if model:
        args += ["--model", model]
    if effort:
        args += ["--effort", effort]
    return tuple(args)


@dataclass(frozen=True, slots=True)
class DeviceResult:
    """Outcome for one device. ``draft`` is always safe to show: the researched draft on success,
    an incomplete placeholder on failure."""

    device_name: str
    status: Literal["ok", "failed"]
    draft: DeviceDraft
    error: str | None = None
    raw: str = ""
    duration_s: float = 0.0
    cost_usd: float = 0.0
    usage: Mapping[str, Any] = field(default_factory=dict)
    turns: int | None = None  # model turns; 1 means no tool (Read) use at all
    warnings: tuple[str, ...] = ()


def _run_warnings(data: Mapping[str, Any]) -> tuple[int | None, tuple[str, ...]]:
    raw_turns = data.get("num_turns")
    turns = raw_turns if isinstance(raw_turns, int) else None
    notes: list[str] = []
    if turns == 1:
        notes.append(
            "no manual was actually read (single model turn): treat every fact as unverified"
        )
    denials = data.get("permission_denials")
    if isinstance(denials, list) and denials:
        notes.append(f"{len(denials)} tool call(s) were denied, so research may be incomplete")
    return turns, tuple(notes)


def research_device(
    device_name: str,
    *,
    exe: Path,
    manual_paths: list[str] | None = None,
    parent_system: str | None = None,
    existing_make_model: str | None = None,
    existing_notes: str | None = None,
    env: Mapping[str, str] | None = None,
    run: Runner = run_subprocess,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    max_budget_usd: float = DEFAULT_MAX_BUDGET_USD,
    model: str | None = None,
    effort: str | None = None,
    now: Callable[[], datetime] | None = None,
    cancel: threading.Event | None = None,
) -> DeviceResult:
    """Research one device with headless Claude Code, reading its manual(s) with the Read tool.

    Raises :class:`DeviceResearchUnavailableError` only when the feature cannot start (no token,
    or the instructions doc is missing). Every failure once a run has started (budget cap,
    timeout, CLI error, unusable reply) comes back as a ``failed`` result carrying an incomplete
    placeholder draft, so the caller never has to special-case "no result".
    """
    env = os.environ if env is None else env
    if not env.get(ENV_TOKEN, "").strip():
        raise DeviceResearchUnavailableError(f"{ENV_TOKEN} is not set (run `claude setup-token`)")
    clock = now or (lambda: datetime.now(UTC))
    device_name = device_name.strip()
    prompt = build_prompt(
        device_name, manual_paths=manual_paths, parent_system=parent_system,
        existing_make_model=existing_make_model, existing_notes=existing_notes,
    )
    args = build_args(exe, prompt.system, max_budget_usd=max_budget_usd, model=model, effort=effort)

    def failed(reason: str, *, raw: str = "", duration: float = 0.0, cost: float = 0.0,
               usage: Mapping[str, Any] | None = None) -> DeviceResult:
        return DeviceResult(
            device_name=device_name, status="failed",
            draft=incomplete_draft(device_name, reason, clock()),
            error=reason, raw=raw, duration_s=duration, cost_usd=cost, usage=usage or {},
        )

    if cancel is not None and cancel.is_set():
        return failed(CANCELLED)

    root = manuals_root(env)
    if root is None or not root.is_dir():
        return failed(f"Manuals folder not found at {root}" if root else "No manuals folder set in Settings")

    out = run(RunRequest(args, prompt.user, child_env(env), root, timeout_s, cancel))

    if out.cancelled:
        return failed(CANCELLED)
    if out.timed_out:
        return failed(f"timed out after {timeout_s / 60:g} min")
    try:
        data = json.loads(out.stdout)
    except json.JSONDecodeError:
        detail = (out.stderr or out.stdout).strip()[:200]
        return failed(f"unreadable output from claude (exit {out.returncode}): {detail}")
    if not isinstance(data, dict):
        return failed(f"unexpected output from claude (exit {out.returncode})")

    duration = float(data.get("duration_ms") or 0.0) / 1000.0
    cost = float(data.get("total_cost_usd") or 0.0)
    raw_usage = data.get("usage")
    usage: dict[str, Any] = raw_usage if isinstance(raw_usage, dict) else {}
    result_text = str(data.get("result") or "")
    if data.get("is_error"):
        why = result_text.strip() or str(data.get("terminal_reason") or "claude reported an error")
        return failed(why, duration=duration, cost=cost, usage=usage)
    try:
        draft = validate_draft(result_text, device_name)
    except DeviceResearchOutputError as exc:
        return failed(str(exc), raw=exc.raw, duration=duration, cost=cost, usage=usage)
    turns, warnings = _run_warnings(data)
    return DeviceResult(
        device_name=device_name, status="ok", draft=draft, duration_s=duration, cost_usd=cost,
        usage=usage, turns=turns, warnings=warnings,
    )
