r"""
Purpose: Nightly verified backup of the live mx-inv database, copied off-machine to the Pi and the crew's laptop.
Version: v3 (2026-10-11) - v3: the crew's laptop moved to its reserved .145 (was DHCP .183). v2 (2026-10-08) - v2: second destination, the crew's laptop.
Scope: PRODUCTION - protects vessel_local.db while the laptop is the interim live host.
Architecture: mx-inv operational tooling. Makes a SQLite backup-API copy from a read-only
    connection (safe while the server runs), verifies it (integrity_check, per-table row counts
    equal the source, schema_version from system_config), keeps it in var/backups/nightly/, then
    streams it to the Pi (boat-automation, ~/backups/mx-inv/) over WSL Ubuntu's ssh (key
    Deep_Thought, user lee) and checks the Pi's sha256 equals the local one. Second destination
    (v2): the crew's laptop (crew-laptop 192.168.1.145, router reservation 10-11, user hutch, Windows OpenSSH server) via
    Windows scp/ssh with key ~/.ssh/id_ed25519 (owner-to-crew-key) into
     there (off her system drive), sha256 checked with Get-FileHash. Each destination fails
    on its own. No pruning yet (retention not decided).
Invocation: Windows Task Scheduler task "mx-inv nightly backup" (daily 19:00, runs late if missed):
    .venv\Scripts\python.exe scripts\nightly_backup.py   (working dir 
    Optional: --db <path> (default vessel_local.db). Appends to var/backups/nightly-backup.log;
    exit code 0 = backup verified locally AND on every destination, 1 = something failed.
"""
import argparse, hashlib, os, sqlite3, subprocess, sys, time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(HERE, "var", "backups", "nightly")
LOG = os.path.join(HERE, "var", "backups", "nightly-backup.log")
PI = "lee@192.168.1.10"
PI_DIR = "backups/mx-inv"
REMOTE_BACKUP = "user@192.168.1.145"  # crew laptop for offsite backup
REMOTE_DIR = r"D:Backupsessel-ops"  # backup destination drive
OPENSSH = r"C:\Windows\System32\OpenSSH"
SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
            "-i", os.path.join(os.path.expanduser("~"), ".ssh", "id_ed25519")]


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    print(line)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def counts(conn):
    names = [r[0] for r in conn.execute(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")]
    return {n: conn.execute(f'select count(*) from "{n}"').fetchone()[0] for n in names}


def make_backup(src_path):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dst_path = os.path.join(OUT_DIR, f"vessel_local-{stamp}.db")
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    dst = sqlite3.connect(dst_path)
    try:
        src.backup(dst)
        dst.commit()
        sc, dc = counts(src), counts(dst)
        integ = dst.execute("pragma integrity_check").fetchone()[0]
        ver = dst.execute("select value from system_config where key='schema_version'").fetchone()
    finally:
        src.close()
        dst.close()
    if integ != "ok" or sc != dc:
        raise RuntimeError(f"verify FAILED: integrity={integ} counts_match={sc == dc}")
    with open(dst_path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    log(f"local OK  {dst_path}  schema v{ver[0] if ver else '?'}  {len(dc)} tables  "
        f"{sum(dc.values())} rows  sha256 {sha}")
    return dst_path, sha


def copy_to_pi(path, sha):
    name = os.path.basename(path)
    cmd = ["wsl", "-d", "Ubuntu", "-e", "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", PI,
           f"mkdir -p {PI_DIR} && cat > {PI_DIR}/{name} && sha256sum {PI_DIR}/{name}"]
    with open(path, "rb") as f:
        r = subprocess.run(cmd, stdin=f, capture_output=True, timeout=300)
    remote = r.stdout.decode(errors="replace").split()[:1]
    if r.returncode != 0 or remote != [sha]:
        raise RuntimeError(f"Pi copy FAILED rc={r.returncode} remote={remote} "
                           f"err={r.stderr.decode(errors='replace').strip()[:300]}")
    log(f"Pi OK     {PI}:~/{PI_DIR}/{name}  sha256 matches")


def copy_to_remote(path, sha):
    name = os.path.basename(path)
    ssh = [os.path.join(OPENSSH, "ssh.exe"), *SSH_OPTS, REMOTE_BACKUP]

    def run(cmd, what, timeout=60):
        r = subprocess.run(cmd, capture_output=True, timeout=timeout)
        if r.returncode != 0:
            raise RuntimeError(f"crew member {what} FAILED rc={r.returncode} "
                               f"err={r.stderr.decode(errors='replace').strip()[:300]}")
        return r.stdout.decode(errors="replace").strip()

    run(ssh + [f"if not exist {REMOTE_BACKUP_DIR} mkdir {REMOTE_BACKUP_DIR}"], "mkdir")
    run([os.path.join(OPENSSH, "scp.exe"), *SSH_OPTS, path, f"{REMOTE_BACKUP}:{REMOTE_BACKUP_DIR.replace(os.sep, '/')}/{name}"],
        "scp", timeout=300)
    remote = run(ssh + [f'powershell -NoProfile -Command "(Get-FileHash {REMOTE_BACKUP_DIR}\\{name} '
                        f'-Algorithm SHA256).Hash"'], "hash").lower()
    if remote != sha:
        raise RuntimeError(f"crew member verify FAILED remote={remote[:64]}")
    log(f"crew member OK {REMOTE_BACKUP}:{REMOTE_BACKUP_DIR}\\{name}  sha256 matches")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(HERE, "vessel_local.db"))
    a = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    ok = True
    try:
        path, sha = make_backup(os.path.abspath(a.db))
    except Exception as e:
        log(f"FAILED local backup: {e}")
        return 1
    for dest in (copy_to_pi, copy_to_remote):
        try:
            dest(path, sha)
        except Exception as e:
            log(f"FAILED {dest.__name__}: {e}")
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
