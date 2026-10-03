#!/usr/bin/env python3
"""Bounded disposable QA entry. Receipts never constitute release approval."""
import argparse
import json
import os
import re
import signal
import sys
import time
from pathlib import Path
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]


def read_swap_mib():
    output = subprocess.check_output(["sysctl", "-n", "vm.swapusage"], text=True, timeout=5)
    match = re.search(r"used = ([0-9.]+)M", output)
    if not match:
        raise RuntimeError("QA host swap observation unavailable")
    return float(match.group(1))


def read_free_percent():
    output = subprocess.check_output(["memory_pressure", "-Q"], text=True, timeout=5)
    match = re.search(r"free percentage: ([0-9]+)%", output)
    if not match:
        raise RuntimeError("QA host pressure observation unavailable")
    return int(match.group(1))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["unit", "native", "connected"])
    parser.add_argument("--image", default=None)
    parser.add_argument("--test-file", action="append", default=[])
    parser.add_argument("--query-bundle", type=Path)
    parser.add_argument(
        "--test-name-pattern",
        help="Bounded unit-test name filter; selected names must be audited separately",
    )
    parser.add_argument("--connected-config", type=Path)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument(
        "--compile-budget",
        action="store_true",
        help="QA-only bounded compile budget; actual cgroup returns to 768MiB before effects",
    )
    args = parser.parse_args()
    if args.test_name_pattern is not None and (
        args.mode != "unit" or len(args.test_name_pattern) > 2048
    ):
        parser.error("test-name-pattern is unit-only and bounded to 2048 characters")
    if args.compile_budget and (args.mode != "connected" or sys.platform != "darwin"):
        parser.error("compile-budget requires the Mac connected QA driver")
    if not 30 <= args.timeout <= 900:
        parser.error("timeout must be between 30 and 900 seconds")
    output = Path(tempfile.mkdtemp(prefix="holaday-cutover-qa-"))
    log = output / "run.log"
    environment = dict(os.environ)
    token = uuid.uuid4().hex
    budget_samples = []
    budget_reason = None
    baseline_swap = None
    if args.compile_budget:
        baseline_swap = read_swap_mib()
        environment["CUTOVER_QA_COMPILE_BUDGET"] = "1"
    name = "holaday-cutover-qa-" + token
    owned_container = args.mode != "connected"
    image = args.image or (
        "holaday-native-recovery:qa" if args.mode == "native" else "holaday-full-host-deps:qa"
    )
    if owned_container:
        image_id = subprocess.check_output(
            ["docker", "image", "inspect", "--format", "{{.Id}}", image], text=True, timeout=15
        ).strip()
        if not image_id.startswith("sha256:") or len(image_id) != 71:
            raise RuntimeError("QA image identity unavailable")
        command = [
            "docker",
            "run",
            "--rm",
            "--name",
            name,
            "--label",
            "holaday.qa.runner=" + token,
            "--network",
            "none",
            "--cpus",
            "1",
            "--memory",
            "768m" if args.mode == "native" else "512m",
            "--pids-limit",
            "256",
            "-v",
            str(ROOT / "scripts") + ":/source:ro",
            "-v",
            str(ROOT / "ops") + ":/ops:ro",
            "-v",
            str(ROOT / "apps") + ":/apps:ro",
        ]
        if args.mode == "native":
            command += [
                "--cap-add",
                "SYS_ADMIN",
                "--security-opt",
                "seccomp=unconfined",
                image_id,
                "/bin/bash",
                "-c",
                'mount --bind /usr/lib/python3.10/__pycache__ /usr/lib/python3.10/__pycache__ && mount -o remount,bind,ro /usr/lib/python3.10/__pycache__ && test ! -e /usr/lib/python3.10/__pycache__/sitecustomize.cpython-310.pyc && cp -R /source /root/native-tools && chmod 700 /root/native-tools && chown -R 0:0 /root/native-tools && cd /root/native-tools && NODE_OPTIONS="--max-old-space-size=192 --v8-pool-size=1" UV_THREADPOOL_SIZE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 /opt/node22/bin/node fixtures/browser-cloud-recovery-probe-linux.mjs --scoped-pm2-vnc; result=$?; test ! -e /usr/lib/python3.10/__pycache__/sitecustomize.cpython-310.pyc || exit 99; exit "$result"',
            ]
        else:
            tests = sorted(
                p.name
                for p in (ROOT / "scripts").glob("browser*.test.mjs")
                if ".integration." not in p.name and "mysql" not in p.name
            )
            if args.test_file:
                if any(name not in tests for name in args.test_file):
                    parser.error("test-file must select an existing non-integration browser test")
                tests = args.test_file
            if not args.query_bundle and "browser-first-cutover-payments.test.mjs" in tests:
                tests.remove("browser-first-cutover-payments.test.mjs")
            if args.query_bundle:
                bundle = args.query_bundle.resolve(strict=True)
                command += [
                    "-v",
                    str(bundle) + ":/qa-query.cjs:ro",
                    "-e",
                    "CUTOVER_QA_QUERY_BUNDLE=/qa-query.cjs",
                ]
            command += [
                "-e",
                "CUTOVER_TEST_AGE_EXECUTABLE=/usr/bin/age",
                "-e",
                "NODE_OPTIONS=--max-old-space-size=192 --v8-pool-size=1",
                "-e",
                "UV_THREADPOOL_SIZE=1",
                "-w",
                "/source",
                image_id,
                "/opt/node22/bin/node",
                "--test",
                "--test-concurrency=1",
                *(
                    ["--test-name-pattern=" + args.test_name_pattern]
                    if args.test_name_pattern is not None
                    else []
                ),
                *tests,
            ]
    else:
        if args.connected_config is None:
            parser.error("connected requires a fresh isolated resource config")
        config = json.loads(args.connected_config.read_text())
        expected = {
            "targetContainerId",
            "sourceContainerId",
            "imageId",
            "attempt",
            "sourceAttempt",
            "runtimeRoot",
            "buildCache",
            "scenario",
        }
        if set(config) != expected or config["scenario"] not in [
            "success",
            "lost-open-ack",
            "enabled-worker",
            "late-known-effect",
            "before-migration",
            "after-start",
            "before-open",
            "after-open",
            "after-ingress",
            "after-worker",
        ]:
            raise RuntimeError("connected QA input shape refused")
        for key in ["runtimeRoot", "buildCache"]:
            config[key] = str(Path(config[key]).resolve(strict=True))
        environment.update(
            CUTOVER_QA_RUNNER_TOKEN=token,
            CUTOVER_QA_RETIREMENT="1",
            CUTOVER_QA_HOST="1",
            CUTOVER_QA_BUILD_CACHE=config["buildCache"],
            CUTOVER_QA_HOST_FAULT=(
                config["scenario"]
                if config["scenario"] not in ["lost-open-ack", "enabled-worker"]
                else "success"
            ),
            CUTOVER_QA_LOST_OPEN_ACK="1" if config["scenario"] == "lost-open-ack" else "0",
            CUTOVER_QA_ENABLED_WORKER="1" if config["scenario"] in ["enabled-worker", "after-worker"] else "0",
        )
        command = [
            "node",
            str(ROOT / "scripts/fixtures/browser-recovery-target-qa.mjs"),
            *[
                config[k]
                for k in [
                    "targetContainerId",
                    "imageId",
                    "attempt",
                    "runtimeRoot",
                    "sourceContainerId",
                    "sourceAttempt",
                ]
            ],
        ]
        image_id = config["imageId"]
        owned_image_id = subprocess.check_output(
            [
                "docker",
                "image",
                "inspect",
                "--format",
                "{{.Id}}",
                args.image or "holaday-full-host-deps:qa",
            ],
            text=True,
            timeout=15,
        ).strip()
    if owned_container:
        owned_image_id = image_id
    else:
        environment["CUTOVER_QA_HOST_IMAGE"] = owned_image_id
    code = 1
    runner_error = None
    cleanup_error = None
    try:
        with log.open("w") as stream:
            process = subprocess.Popen(
                command,
                cwd=ROOT,
                env=environment,
                stdout=stream,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                if not args.compile_budget:
                    code = process.wait(timeout=args.timeout)
                else:
                    started = time.monotonic()
                    deadline = started + args.timeout
                    while process.poll() is None:
                        free = read_free_percent()
                        swap = read_swap_mib()
                        sample = {
                            "elapsedSeconds": round(time.monotonic() - started, 2),
                            "hostFreePercent": free,
                            "swapUsedMiB": swap,
                            "swapDeltaMiB": round(swap - baseline_swap, 2),
                        }
                        owned = subprocess.run(
                            [
                                "docker",
                                "inspect",
                                "holaday-retirement-recovery-" + config["attempt"],
                            ],
                            text=True,
                            capture_output=True,
                            timeout=15,
                        )
                        if owned.returncode == 0:
                            row = json.loads(owned.stdout)[0]
                            if (
                                row["Config"].get("Labels", {}).get("holaday.qa.runner") != token
                                or row["Image"] != owned_image_id
                                or row["Config"]["Labels"].get("holaday.cutover.attempt")
                                != config["attempt"]
                            ):
                                raise RuntimeError("QA compile monitor identity refused")
                            sample["containerId"] = row["Id"]
                            sample["memoryLimitBytes"] = row["HostConfig"]["Memory"]
                            sample["oomKilled"] = row["State"]["OOMKilled"]
                            if (
                                row["State"]["Running"]
                                and row["HostConfig"]["Memory"] == 2147483648
                            ):
                                if time.monotonic() - started >= 180:
                                    budget_reason = "180s compile resource budget"
                            elif row["HostConfig"]["Memory"] == 805306368:
                                sample["ordinaryBudgetRestored"] = True
                            else:
                                raise RuntimeError("QA compile memory contract refused")
                            if row["State"]["Running"]:
                                rss = subprocess.run(
                                    ["docker", "top", row["Id"], "-eo", "pid,rss"],
                                    text=True,
                                    capture_output=True,
                                    timeout=5,
                                )
                                values = [
                                    parts[1]
                                    for line in rss.stdout.splitlines()[1:]
                                    if len(parts := line.split()) == 2 and parts[0].isdigit()
                                ]
                                if (
                                    rss.returncode == 0
                                    and values
                                    and all(value.isdigit() for value in values)
                                ):
                                    sample["sampledProcessRssKiB"] = sum(
                                        int(value) for value in values
                                    )
                        budget_samples.append(sample)
                        if free < 35 or swap - baseline_swap > 256:
                            budget_reason = "host pressure or swap increase budget"
                        if time.monotonic() >= deadline or budget_reason:
                            raise subprocess.TimeoutExpired(command, args.timeout)
                        time.sleep(min(5, max(0, deadline - time.monotonic())))
                    code = process.returncode
            except Exception as error:
                runner_error = type(error).__name__
                try:
                    if process.poll() is None and os.getpgid(process.pid) == process.pid:
                        os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        if process.poll() is None and os.getpgid(process.pid) == process.pid:
                            os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
                except ProcessLookupError:
                    pass
                except Exception as cleanup:
                    cleanup_error = type(cleanup).__name__
                code = 124 if isinstance(error, subprocess.TimeoutExpired) else 1
    except Exception as error:
        runner_error = type(error).__name__
        code = 1
    finally:
        if not owned_container:
            name = "holaday-retirement-recovery-" + config["attempt"]
        try:
            inspection = subprocess.run(
                ["docker", "inspect", name], text=True, capture_output=True, timeout=15
            )
            if inspection.returncode == 0:
                rows = json.loads(inspection.stdout)
                if len(rows) != 1:
                    raise RuntimeError("owned QA cleanup identity refused")
                row = rows[0]
                if (
                    row["Config"].get("Labels", {}).get("holaday.qa.runner") != token
                    or row["Image"] != owned_image_id
                    or not re.fullmatch("[a-f0-9]{64}", row["Id"])
                    or (
                        not owned_container
                        and row["Config"].get("Labels", {}).get("holaday.cutover.attempt")
                        != config["attempt"]
                    )
                ):
                    raise RuntimeError("owned QA cleanup identity refused")
                subprocess.run(
                    ["docker", "stop", "--time", "5", row["Id"]],
                    capture_output=True,
                    timeout=15,
                    check=True,
                )
        except Exception as error:
            cleanup_error = type(error).__name__
            code = code or 1
    receipt = {
        "runnerError": runner_error,
        "cleanupError": cleanup_error,
        "compileBudgetSamples": budget_samples,
        "compileBudgetCancelReason": budget_reason,
        "compileBudgetBaselineSwapMiB": baseline_swap,
        "mode": args.mode,
        "exitCode": code,
        "imageId": image_id,
        "log": str(log),
        "releaseAcceptance": False,
    }
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
