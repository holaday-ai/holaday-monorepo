# CDP就绪探测与响应体收尾实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。单主实现，复用唯一reviewer，与重任务串行。

**Goal:** 就绪探测从fetch到响应体读取/取消及重试timer都有可等待的生命周期，不以收到响应头或Abort作为物理完成。

**Architecture:** 将spawn.ts末端就绪探测提取为cdp-readiness.ts并保持原导出。整轮probe同步预留子owner，逐次HTTP响应操作再预留私有pin；json读取与重试等待也登记。已取得响应的finally取消在原响应owner内直接等待，即使之后blocked/unknown也执行，不新建根或绕过准入派发新请求。

**Tech Stack:** Node fetch/Response/ReadableStream、TypeScript、Vitest fake timers、真实ExecutionDrain；无依赖/真实网络。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；process-drain-coverage.md。

## Global Constraints

- 基线f3a1609e，现有隔离worktree。约10GB预算、Node heap2048MiB、Vitest单线程无文件并行≤20文件；free<40%/磁盘<10GiB不启动重任务。reviewer错开。
- 不安装/开Docker或浏览器/访问生产，不触禁止业务领域、配置、秘密、主8草稿或PR237冻结包。未完成全机制及门禁不发布局部组件。
- 本单元固定loopback /json/version是只读就绪查询，无模型/业务提交。其连接拒绝、非2xx、JSON错误是已知失败，可以在截止前重试；取消失败不能证明资源收口，保留unknown并停止重试。不得将此known分类推广到任意HTTP请求。

## 已核对路径与剩余边界

pool.spawnInstance调用waitForCdpReady后再connect；旧请求2s timer仅在fetch成功后clear，json无超时且非2xx body未处理。pool shutdown已有分配屏障；它不代替raw跟踪。

launchManaged的失败close、disconnect先清字段再dispose/close、explorer超时void dispose及finally清理、pool ready hook/3s banner和OS信号还需资源生命周期设计；本次不机械加unknown guard使原清理被跳过，也不宣称这些已覆盖。

## 单元：限定只读探测的完整响应生命周期

**Files:** 新增apps/orchestrator/src/browser-pool/cdp-readiness.ts和cdp-readiness.test.ts；修改spawn.ts仅提取并重导出waitForCdpReady；本计划/coverage。

**Interfaces:** waitForCdpReady(cdpPort:number,timeoutMs=10000):Promise<string>；原调用方不改。私有withProbeLifetime(action)当前scope下同步startOwnedOperation(errorOutcome:known)，禁止未知/失效scope的新派发；无scope兼容。原响应owner从fetch前持续至finally cancel结束，cleanup失败在owner释放前markUnknown。

- [x] RED：真实导出+drain，fetch/json/cancel挂起时父ACK或Abort后仍活动；非2xx先取消再重试，body JSON挂起时2s信号仍触发，fetch拒绝无遗留timer。真实ReadableStream验证cancel，不启动网络。

```ts
const response = new Response(new ReadableStream({ cancel: () => held }), { status: 503 });
// Synthetic fetch returns this real response; stop cannot pass until held settles.
drain.close();
expect(drain.snapshot().idle).toBe(false);
resolveCancel();
```

- [x] RED：blocked/unknown发生在headers后仍取消该响应，不能再发新fetch；取消失败保留unknown，read-only失败重试保持兼容。unknown/sealed/expired起点零网络；不跟随redirect到其他请求。审查补充：迟到JSON/cancel、未触发timer但时钟已到期、单次过期后的新尝试；非法端口/预算零网络零child且不强转对象。
- [x] GREEN：在准入前验证端口number整数1..65535、timeout有限正数。每次attempt使用绝对总deadline与当前时间+2s较小者；try/finally保持timer直到body/cancel结束。在派发前、headers/JSON/cleanup后检查abort与绝对时钟，整轮返回前再验总deadline；未消费body取消并等待，finally clearTimeout；250ms重试等待归属整轮probe。

```ts
return withProbeLifetime(async () => {
  const responseOwner = currentOperationLifetime();
  let response: Response | undefined;
  let version: string;
  try {
    assertFresh();
    response = await fetch(loopbackUrl, { signal, redirect: 'error' });
    assertFresh();
    if (!response.ok) throw new Error('HTTP status');
    version = (await withProbeLifetime(() => response.json())).Browser ?? 'unknown';
    assertFresh();
  } finally {
    // Private disposal helper marks unknown and rethrows on failed cancellation.
    try { await disposeResponse(response, responseOwner); }
    finally { clearTimeout(timer); }
  }
  assertFresh();
  return version;
});
```

- [x] 新矩阵+pool/spawn/executor/owned/drain相关串行回归、完整后端tsc、新文件Biome/原spawn其他源码一致性、独立审查及最终复验通过；随后精确本地提交五文件并记录ledger/原自动化接续。

Run（apps/orchestrator）：`LOG_LEVEL=fatal NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/browser-pool/cdp-readiness.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。

## 实施证据（JST）

- 04:45原spawn导出上15项：14条有效RED、1条旧fallback兼容，无fixture超时或unhandled。04:46最小提取/实现后15/15；补充响应与JSON独立pin、cancel持有原响应pin的完整行为验证，新增矩阵16项。
- 04:48扩大7文件145/145，1.58秒；完整后端tsc退出0，新2文件Biome、diff及spawn非探测源码逐字相同检查通过。原finally中显式throw的lint提示通过提取实际disposeResponse生产职责处理，未压制规则，清理错误仍覆盖成功/已知失败并保留unknown。
- 此时等待独立审查，尚不提交/发布。资源free72%、磁盘143GiB，Node堆2GB、单线程测试，未启动真实网络/进程/浏览器。
- 独立审查发现两项Important：迟到成功仍可返回ready；运行时非法端口可改变首跳主机。04:55新增15条有效RED（无unhandled/fixture超时），先修严格输入验证11GREEN，再修绝对deadline及cleanup后复验；04:56完整31/31通过，格式化后等待独立复审及最终扩大验证。不以abort或超时释放未结束的原始IO pin。
- 最终独立复审两项关闭，无剩余Critical/Important/必修Minor。04:57:48 JST最终7文件160/160，1.43秒；04:58完整后端tsc退出0，新2文件Biome、diff与spawn其他源码逐字一致检查通过。主8草稿、原66f3a583和PR237 manifest ad0f5c0064bd02887a896fbf9e4a89b16e227da29bc75a4094aa2c56759e8c40现场不变。没有实际网络/浏览器/数据库/模型/Linux/PM2/生产或发布build验证；本地单元不构成完整机制发布资格。
