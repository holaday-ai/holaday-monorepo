#!/usr/bin/env python3
"""Prepare disposable frozen-lockfile QA material; never release evidence."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import uuid


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, timeout=kwargs.pop("timeout", 60), **kwargs)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--image", required=True)
parser.add_argument("--candidate", required=True)
parser.add_argument("--source-candidate", required=True)
parser.add_argument("--output-parent", type=Path, default=Path(tempfile.gettempdir()))
args = parser.parse_args()
# Run from the selected checkout; no existing workspace is modified.
root = Path.cwd().resolve()
candidate = subprocess.check_output(
    ["git", "rev-parse", args.candidate + "^{commit}"], text=True, cwd=root, timeout=15
).strip()
source = subprocess.check_output(
    ["git", "rev-parse", args.source_candidate + "^{commit}"], text=True, cwd=root, timeout=15
).strip()
if candidate == source:
    raise RuntimeError("QA source and candidate must differ")
image = subprocess.check_output(
    ["docker", "image", "inspect", "--format", "{{.Id}}", args.image], text=True, timeout=15
).strip()
if not image.startswith("sha256:") or len(image) != 71:
    raise RuntimeError("QA image identity unavailable")
output = Path(
    tempfile.mkdtemp(prefix="holaday-cutover-cache-", dir=args.output_parent.resolve(strict=True))
)
run(
    ["git", "clone", "--bare", "--no-hardlinks", str(root), str(output / "origin.git")],
    stdout=subprocess.DEVNULL,
)
with (output / "source.tar").open("wb") as archive:
    run(["git", "archive", candidate], cwd=root, stdout=archive)
(output / "cache.json").write_text(
    json.dumps(
        dict(
            schemaVersion=1,
            observations="synthetic-qa-only",
            candidate=candidate,
            sourceCandidate=source,
            origin=str(output / "origin.git"),
        ),
        indent=2,
    )
)
token = uuid.uuid4().hex
name = "holaday-cutover-cache-" + token
command = "mkdir /qa-src && tar -xf /out/source.tar -C /qa-src && cp /usr/bin/git /out/git && cp /usr/bin/age /out/age && cp -a /usr/lib/git-core /out/git-core && cp -a /opt/node22/lib/node_modules/pnpm /out/pnpm && cp /opt/node22/bin/node /out/node && cd /qa-src && pnpm fetch --frozen-lockfile --store-dir /out/store"
code = 1
error = None
cleanup_error = None
container_state = None
try:
    with (output / "prepare.log").open("w") as log:
        result = subprocess.run(
            [
                "docker",
                "run",
                "--name",
                name,
                "--label",
                "holaday.qa.runner=" + token,
                "--cpus",
                "1",
                "--memory",
                "512m",
                "--pids-limit",
                "256",
                "-v",
                str(output) + ":/out",
                "-e",
                "NODE_OPTIONS=--max-old-space-size=192 --v8-pool-size=1",
                "-e",
                "UV_THREADPOOL_SIZE=1",
                image,
                "/bin/bash",
                "-c",
                command,
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
            timeout=600,
        )
        code = result.returncode
except Exception as failure:
    error = type(failure).__name__
    code = 124 if isinstance(failure, subprocess.TimeoutExpired) else 1
finally:
    try:
        inspected = subprocess.run(
            ["docker", "inspect", name], capture_output=True, text=True, timeout=15
        )
        if inspected.returncode == 0:
            row = json.loads(inspected.stdout)[0]
            if (
                row["Image"] != image
                or row["Config"].get("Labels", {}).get("holaday.qa.runner") != token
            ):
                raise RuntimeError("QA cleanup identity refused")
            if row["State"]["Running"]:
                run(["docker", "stop", "--time", "5", row["Id"]], capture_output=True, timeout=15)
            container_state = json.loads(
                subprocess.check_output(["docker", "inspect", row["Id"]], text=True, timeout=15)
            )[0]["State"]
        elif (
            "No such object: " + name not in inspected.stderr
            and "No such container: " + name not in inspected.stderr
        ):
            raise RuntimeError("QA inspect failed")
    except Exception as failure:
        cleanup_error = type(failure).__name__
        code = 1
    receipt = dict(
        output=str(output),
        candidate=candidate,
        sourceCandidate=source,
        imageId=image,
        token=token,
        exitCode=code,
        error=error,
        cleanupError=cleanup_error,
        containerState=container_state,
        memoryBytes=536870912,
        cpus=1,
        timeoutSeconds=600,
        releaseAcceptance=False,
    )
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))
raise SystemExit(code)
