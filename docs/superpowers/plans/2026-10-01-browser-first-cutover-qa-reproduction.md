# 首次浏览器发布：隔离 QA 准备与证据边界

本入口不安装生产组件，不生成发布批准；每个真实 host 成功/故障场景使用新 attempt、新源/目标卷，不重放失败目标。PayPal 延期。普通测试 CPU1/512MiB；native CPU1/768MiB；full-host 总预算在开始前设900秒，编译阶段独占2GiB/heap1536/180秒后通过固定token/attempt/image/ID握手降768MiB。编译和全量noEmit不同：本次noEmit最终独占3GiB/heap2304/180秒通过。任何临时材料仅QA，不能代替生产 fresh approval/window/验收。

## 固定工具与准备父目录

使用当前候选物理 checkout（本次 `b43dd03132658d9c13875f050e2c27e584b61e33`）、Docker arm64、Python3.10+、Git、官方 Node 下载包、pnpm10.33.0、PM2 6.0.14、age，以及 Mac 恢复端已有的官方 Node22.23.2 和 age；运行时PATH将该固定Node目录置首（Mac中介不能静默落到Node25）。指定一个新空 QA 父目录，例如 `/private/tmp/holaday-cutover-qa-materials`。不要复用生产 profile、配置、数据库、商户、密钥或历史数据。记录工具版本、下载来源与实际镜像 ID。

- 工具基座：`scripts/fixtures/browser-first-cutover-network.qa.Dockerfile`。官方 Python digest `2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9`；将官方 `https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-arm64.tar.xz` 放入新 build context，Dockerfile固定校验 SHA `06907b9c088ce62305bc1530e5c1ae1510245114645768f7750c349c5b6fe667`。此新recipe由本次实际继承镜像history及官方SHASUM材料恢复，尚未重新build，不能声称与历史镜像逐字节同一。
- 应用依赖：`scripts/fixtures/browser-full-host-deps.qa.Dockerfile`，FROM上述基座tag `holaday-first-cutover-network:qa`，包含git/age/openssh-client及固定pnpm。context另放官方 Node22.23.2 Linux arm64 tar.xz，SHA `fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8`（请以Dockerfile内完整固定值为准）。应用Node22.23.2与legacy/native22.20分别记账。
- 原生环境：`scripts/fixtures/browser-native-recovery.qa.Dockerfile`。官方 Canonical22.04.5 arm64 rootfs `https://cdimage.ubuntu.com/ubuntu-base/releases/22.04.5/release/ubuntu-base-22.04.5-base-arm64.tar.gz`，SHA `075d4abd2817a5023ab0a82f5cb314c5ec0aa64a9c0b40fd3154ca3bfdae979f`；校验后导入独立QA镜像，将其实际ID作为 `NATIVE_BASE_IMAGE` build arg。Brave1.89.141、keyring1.20-1均由Dockerfile校验。实际无可选pyc并在启动前/后保持目录只读；这不是生产pyc字节复刻。

镜像构建也必须有限时/CPU/内存，不采用无法约束的无限后台构建。需要联网拉取的准备与运行测试串行，网络失败明确保存日志，不能静默换发行版/解释器或放宽source契约。重建后先核对所有实际工具路径（包括sbin）、root不可写归属、UID998、pnpm/git既有布局，再进入效果路径。

## Frozen cache 与原迁移 runtime

在物理候选checkout内执行，两个commit都必须存在且不同：

```bash
python3 scripts/prepare-browser-first-cutover-qa-cache.py \
  --image <实际full-host镜像ID> \
  --candidate b43dd03132658d9c13875f050e2c27e584b61e33 \
  --source-candidate 434f1b1666d02ebda444a2c3ff78e679e549a35f \
  --output-parent /private/tmp/holaday-cutover-qa-materials
```

该工具创建独立bare origin、候选gitarchive和同锁pnpm store，CPU1/512MiB/heap192/600秒。output含cache.json、工具字节、source.tar、prepare.log与receipt；先读exitCode/cleanupError再使用。源与候选不同的现有守卫保留。新准备器本次只做语法/同源输入拒绝，未重新下载1103依赖；已完成cache的真实准备证据另列，不能混称同一次运行。

将source.tar解到另一个新QA workspace，用cache内固定pnpm/store执行 `pnpm install --offline --frozen-lockfile`，workspace symlink必须全部留在此QA树内，不能连回主repo应用源码。`scripts/fixtures/build-recovery-runtime-qa.mjs <恢复目标内可执行的固定Linux Node绝对路径>` 在该树内生成runtime pack：实际原61SQL、manifest、迁移runner/readers及固定node；需要同锁esbuild0.25.12。确认 runtime.json 全文件hash后使用；本次pack携带Linux Node22.20，Mac仅作恢复协议中介，不能把Mac二进制放进Linux目标。生产工具closure仍需独立原审查。

## Fresh 真实 host 的严格输入

新建两个独立MySQL8.0 QA容器/卷，CPU1/512MiB、network none、IPC private、无ports、`MYSQL_ALLOW_EMPTY_PASSWORD=1`、`MYSQL_DATABASE=restore_qa`、`--event-scheduler=OFF`。每个容器label `holaday.cutover.attempt=<各自新UUID>`，仅挂自己新建volume到`/var/lib/mysql`。等待有界socket readiness。固定DB镜像本次实际公共RepoDigest为 `mysql@sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b`（本地image ID同SHA），无需依赖某个临时creator文件。以下每次生成独立资源，保留旧失败资源；先准备新的0700 QA父目录：

```bash
dbImage=mysql@sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b
sourceAttempt=$(uuidgen | tr '[:upper:]' '[:lower:]')
targetAttempt=$(uuidgen | tr '[:upper:]' '[:lower:]')
sourceVolume=holaday-cutover-restore-$sourceAttempt
targetVolume=holaday-cutover-restore-$targetAttempt
docker volume create --label holaday.cutover.attempt=$sourceAttempt "$sourceVolume"
docker volume create --label holaday.cutover.attempt=$targetAttempt "$targetVolume"
sourceId=$(docker run -d --name holaday-qa-source-$sourceAttempt \
  --label holaday.cutover.attempt=$sourceAttempt --network none --ipc private \
  --cpus 1 --memory 512m --pids-limit 256 \
  -e MYSQL_ALLOW_EMPTY_PASSWORD=1 -e MYSQL_DATABASE=restore_qa \
  --mount type=volume,source=$sourceVolume,target=/var/lib/mysql \
  "$dbImage" --event-scheduler=OFF)
targetId=$(docker run -d --name holaday-qa-target-$targetAttempt \
  --label holaday.cutover.attempt=$targetAttempt --network none --ipc private \
  --cpus 1 --memory 512m --pids-limit 256 \
  -e MYSQL_ALLOW_EMPTY_PASSWORD=1 -e MYSQL_DATABASE=restore_qa \
  --mount type=volume,source=$targetVolume,target=/var/lib/mysql \
  "$dbImage" --event-scheduler=OFF)
```

每个 `docker` 创建命令通过外层 `subprocess.run(..., timeout=30)` 约束并保留argv/exit；镜像首次拉取另设60秒总超时。先 `docker inspect` 验证上述完整ID/image/label/volume/network none/private IPC，随后每个角色最多30秒、每次最多5秒 `docker exec <ID> mysql --no-defaults -uroot --database=restore_qa --execute 'SELECT 1'`，结果成功才继续；driver在效果前再次执行同一有界socket检查，初始化preparer仍要求新空库。把实际ID、attempt、image ID写入下方严格8字段JSON（mode0600），而不是把placeholder作为证明。停止或清理前重复核实本次ID/image/attempt/volume，旧失败卷保留。

源初始化必须显式执行一次，仅接受本次已验证的新空QA源：

```bash
<固定Mac Node22.23.2> scripts/fixtures/prepare-browser-first-cutover-source-qa.mjs \
  <source完整ID> <DB实际imageID> <source UUID> <已验证runtime pack绝对路径> current-61
```

它复用原Unicode/binary/NULL/trigger/disabled-event fixture和真实61SQL工具，修正仅隔离固定runtime材料的root归属，输出schemaBaseline/current-61与manifest/source摘要；目标必须另以同一命令的最后参数 `empty-target` 安装原runtime，保持空库。共享 `browser-first-cutover-runtime-materials.qa.mjs` 在准备后和driver效果前核实双方实际全部文件SHA、root/0600/0700/单链接和目录，不接受调用方boolean。成功/候选tail要求90表，before-migration场使用minimal的2表。当前61SQL源基线不证明旧schema新增升级，另参opt-in MySQL。失败源不重放初始化，改用新源/卷。

runner driver在效果前验证两端精确归属/volume/network/IPC，各30秒单调有界socket readiness和events OFF，并核对源表数及原行/trigger/event，再进入既有runtime/cache/候选与工具检查。严格JSON只包含以下8字段：

```json
{
  "targetContainerId": "<新的完整ID>",
  "sourceContainerId": "<另一个新的完整ID>",
  "imageId": "<两个DB的固定实际imageID>",
  "attempt": "<target的label UUID>",
  "sourceAttempt": "<source的label UUID>",
  "runtimeRoot": "<已校验新runtime pack绝对路径>",
  "buildCache": "<已完成cache绝对路径>",
  "scenario": "success"
}
```

```bash
CUTOVER_QA_ESBUILD=<此QA树esbuild/lib/main.js绝对路径> \
CUTOVER_QA_MODULE_ROOT=<此QA树绝对路径> \
CUTOVER_TEST_AGE_EXECUTABLE=<Mac固定age绝对路径> \
python3 scripts/run-browser-first-cutover-qa.py connected \
  --image <full-host实际固定镜像ID> \
  --connected-config <上述新JSON路径> --timeout 900 --compile-budget
```

现有受支持scenario还包括before-migration/after-start/before-open/after-open/after-ingress/after-worker/lost-open-ack/enabled-worker/late-known-effect；每场全新输入。runner只有本次token/attempt/image/ID证实的资源可以停止；不清理任意配置指定容器。运行前后保存日志/receipt，owned DB空闲后核实归属再停止并留卷。内层QA增量诊断以0600私有文件在容器移除前逐行fsync、总64KiB/单行8KiB，拒绝原始stdout和未知字段；只保留固定阶段、phase/event计数、identity/record digest、memory.current/peak/events和child code/signal，不能输出行值/密钥/env。

本harness证明真实host/stop/加密backup/Mac restore/61SQL/候选open链，但业务facts仍显式QA合成，不能宣称production-facts默认全链现场验收。实际SQL读取实现+合成后端/签名响应/defaultsite组合测试与真实MySQL测试另列；生产支付恢复/重投重复权益、完整浏览器任务成功率、新鲜批准窗口尚需原验收。about:blank最低探针仅证明本次目标浏览器执行基础。

## 脚本合同中的支付SDK材料

`browser-first-cutover-payments.test.mjs` 使用实际原payment-cutover-query及SDK，但后端签名响应为隔离fixture。在同锁QA workspace用esbuild将 `apps/cn-payment/scripts/payment-cutover-query.ts` bundle为CJS（platform=node），保存其来源commit、bundle SHA。随后传 `run-browser-first-cutover-qa.py unit --query-bundle <此绝对路径>`；运行migration-gate时只读挂载并设置 `CUTOVER_QA_QUERY_BUNDLE=<容器内bundle路径>`。缺该材料导致tsx模块找不到不能当业务失败，也不能将合成provider响应称生产实测。PayPal参数化子例本次延期；混合文件必须使用已逐个核对函数体的明确非PayPal名称白名单，不进行PayPal子例、外部preflight/verify/付款。完整17项补跑被正常auto-review拒绝且未执行，随后明确16项白名单正常审核放行并通过；两者分别留账。

本次独立90表小链真实exit0/24.31秒，snapshot frame50365字节、verify tool request20137字节，原wire256KiB/tool1MiB限制保持。实际full-host镜像36e1…工具预检17项通过；它未包含后来recipe新增的openssh-client，本harness通过私有pipe代替SSH，不证明生产SSH链。Redis使用lazyConnect且本harness的状态/维护/空worker轮询未调用它；不宣称Redis业务路径或完整任务路由验收。

### 原 Task6 unknown/known 入口

每个场景使用独立新容器。预设维护 scope 180s、fixture child 220s、Node test 240s、外层 runner 260s；CPU1/512MiB、heap192、UV1/V8pool1。外层以 `subprocess.run(argv, timeout=260)` 执行下列 argv；超时及正常结束均先核对本次 container ID、固定 image ID、`holaday.qa.runner` token 后仅回收该容器。将实际 argv、token/ID、退出码、OOMKilled、日志 SHA 保存为0600 receipt。

```sh
docker run --name "holaday-original-entry-$QA_TOKEN" \
  --label "holaday.qa.runner=$QA_TOKEN" --network none --ipc private \
  --cpus 1 --memory 512m --pids-limit 256 \
  --cap-add SYS_PTRACE --cap-add NET_ADMIN \
  -e 'NODE_OPTIONS=--max-old-space-size=192 --v8-pool-size=1' \
  -e UV_THREADPOOL_SIZE=1 -e "CUTOVER_QA_LOST_EFFECT_CASE=$QA_CASE" \
  -v "$QA_SOURCE/scripts:/source:ro" -v "$QA_SOURCE/ops:/ops:ro" \
  -v "$QA_SOURCE/apps:/apps:ro" -w / "$QA_APP_IMAGE_ID" \
  /opt/node22/bin/node --test --test-concurrency=1 \
  /source/browser-first-cutover.integration.test.mjs
```

`QA_CASE` 只能为 `unknown` 或 `known`；`QA_TOKEN` 为本次新 UUID，`QA_SOURCE` 为审核过的候选源码绝对路径，`QA_APP_IMAGE_ID` 为前述固定 patched Node22.23.2 镜像 ID。gateway/ingress session 子进程分别实际 `/usr/bin/node`、固定绝对 entry 和 cwd `/`；身份读者仍读取真实 `/proc`，未合成其身份。此入口证明 retirement/failure retention，不覆盖候选 open。
