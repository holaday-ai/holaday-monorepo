#!/usr/bin/python3
"""Fixed capability/load canary; never starts a service, display or profile."""
import sys

sys.dont_write_bytecode = True
sys.path[0] = "/usr/bin"
import hashlib
import importlib.metadata
import json
import os
import re
import subprocess


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"mnt:\[\d+\]", sys.argv[1]):
        raise RuntimeError("input")
    status = open("/proc/self/status", encoding="utf8").read()

    def field(name):
        rows = re.findall(r"^" + name + r":\s*(.+)$", status, re.M)
        if len(rows) != 1:
            raise RuntimeError("status")
        return rows[0]

    uids = list(map(int, field("Uid").split()))
    capabilities = {k: field(k) for k in ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]}
    namespace = os.readlink("/proc/self/ns/mnt")
    if (
        uids != [0, 0, 0, 0]
        or namespace == sys.argv[1]
        or field("NoNewPrivs") != "1"
        or any(int(v, 16) for v in capabilities.values())
    ):
        raise RuntimeError("capabilities")
    # Exercise the exact distro startup/entry selection, without calling the
    # entry or binding a socket. -B prevents cache writes and keeps default paths.
    distribution = importlib.metadata.distribution("websockify")
    entries = [
        e
        for e in distribution.entry_points
        if e.group == "console_scripts" and e.name == "websockify"
    ]
    if len(entries) != 1 or entries[0].value != "websockify.websocketproxy:websockify_init":
        raise RuntimeError("entry")
    entry = entries[0].load()
    if not callable(entry) or entry.__module__ != "websockify.websocketproxy":
        raise RuntimeError("selection")
    versions = {}
    for role, command, pattern in [
        (
            "holaday-chromium-headed",
            ["/opt/brave.com/brave/brave", "--version"],
            r"Brave Browser [0-9.]+",
        ),
        ("holaday-vnc", ["/usr/bin/x11vnc", "-version"], r"x11vnc: [0-9.]+"),
    ]:
        value = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=5,
            check=True,
        )
        if len(value.stdout) > 8192 or not re.search(pattern, value.stdout.decode("utf8")):
            raise RuntimeError("version")
        versions[role] = hashlib.sha256(value.stdout).hexdigest()
    modules = sorted(
        {
            os.path.realpath(m.__file__)
            for m in list(sys.modules.values())
            if getattr(m, "__name__", None) != "__main__"
            and getattr(m, "__file__", None)
            and not m.__file__.startswith("<")
        }
    )
    libraries = set()
    for line in open("/proc/self/maps", encoding="utf8"):
        parts = line.rstrip().split(None, 5)
        if len(parts) == 6 and parts[5].startswith("/"):
            if parts[5].endswith(" (deleted)"):
                raise RuntimeError("deleted")
            libraries.add(os.path.realpath(parts[5]))
    print(
        json.dumps(
            dict(
                schemaVersion=1,
                purpose="cloud-recovery-native-preflight",
                parentMountNamespace=sys.argv[1],
                mountNamespace=namespace,
                uids=uids,
                noNewPrivs=1,
                capabilities=capabilities,
                python=os.readlink("/proc/self/exe"),
                entry=entries[0].value,
                version=distribution.version,
                modules=modules,
                libraries=sorted(libraries),
                roles=sorted(versions),
                versionDigests=versions,
            ),
            separators=(",", ":"),
        )
    )


try:
    main()
except Exception:
    print("CUTOVER_CLOUD_NATIVE_PREFLIGHT_UNPROVEN", file=sys.stderr)
    sys.exit(1)
