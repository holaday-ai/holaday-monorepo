# 首次切换：真实主机只读核查与有限修正清单

## 2026-09-27 15:59 JST：单条内部任务获准处置（本节是生产写入，不是只读）

用户明确授权后，旧 explorer `tsk_r3W3wh5LMNbJcgGDRi22D` 已由 running 定向更新为 cancelled，未重跑或改成功。UTC06:58:36.178 同一事务仅改任务 status/updated_at/completed_at，并增加1条 task.cancelled 事件；独立只读连接 UTC06:59:38.315 确认14条动作和22条LLM费用记录摘要不变，原任务其他列不变。生产事务前通过隔离MySQL原行/关联变化拒绝、回滚、重复拒绝等验证。完整证据与限制见[最新断点](2026-09-26-browser-first-cutover-checkpoint.md)。这是明确授权的单条处置，不授权清理其他任务。

PayPal 已按用户最新要求完全暂停，本轮未访问其页面/API或支付表；旧任务取消许可不包含任何订单修改。旧节的“等待取消授权”“继续PayPal登录”不再适用。未停生产服务、修改主机配置或部署；完整host接线仍未完成。

## 2026-09-27 15:31–15:33 JST：启动依赖与证书续期的定向复核

复用06:04双机快照查看六份应用/浏览器/VNC启动脚本及systemd启动指令；未执行这些脚本。应用和注销worker通过各自wrapper指向旧源码/构建入口，files-cron独立调用cleanup-cron；headed浏览器与VNC及它们的子进程须保留，不执行unit中的`reload all`或`kill`。这不是全部223/265来源绑定已审通过，也没有生成全量批准清单。

随后通过严格SSH只读复核Vultr四份启动文件摘要/属主，并核对两机三个已知业务域名的证书续期配置和固定pre/deploy/post钩子目录。未读取证书私钥、acme账户密钥或其他域名配置；未执行续期或改服务。原始私密归档：`/private/tmp/holaday-launch-dependencies-a4Itfj`、`/private/tmp/holaday-renewal-dependencies-xsb3TU`，均0700目录/0600文件。

| 项目 | 现场事实 | 解释边界 |
| --- | --- | --- |
| Aliyun hd-app / hd-pay | Certbot续期配置存在，authenticator=webroot；三个固定钩子目录均空 | 不代表更新过程中所有并发配置变化都被排除 |
| Vultr holaday.ai | authenticator=nginx、installer=nginx；三个固定钩子目录均空 | 不能把“空钩子目录”当成不会触碰nginx配置的证明；上线窗口需沿现有隔离/配置漂移复核覆盖续期并发 |
| acme.sh | Aliyun目录缺失；Vultr仅在限定业务域名名册中未匹配目录 | 不外推为全机无acme任务；Vultr既有root cron仍调用acme.sh |

首轮临时诊断的域名正则转义过度，漏匹配风险已在本地用已知域名复现；改为8个明确域名目录名集合，4个正向/4个反向检查通过后重新采样两机。首次空结果不作为缺失证明。最终采样UTC06:33:31.124/06:33:33.991；续期配置摘要：Aliyun hd-app `383d40c7162726b81529ca9bd515e17ac52f1864587a760412c19478e9a0fc5a`、hd-pay `cf1cd277ddcc5a9ed63586b4c7b01d5b96dafd3d5f22b37c68f554fbe7bfb617`，Vultr `95605af59a9f7d2eab03464dec0b203ac752d3bd3113443d64eb0582440a6aef`。

本轮无产品代码修改或产品测试通过声明；未更新生产配置/服务/数据库、执行支付操作、部署或更改浏览器登录态。PayPal页面本轮仍是未填写的登录表单，已保留，不反复刷新。旧explorer的普通取消路径限制另见最新断点。继续需要实际现场接线与完整演练，不能以本节替代。

## 2026-09-27 15:18 JST：获准的旧 explorer 操作记录核查

用户已明确允许上轮提出的单条旧任务和旧 PayPal 记录只读调查。Vultr精确范围的一致性只读事务成功，观察UTC `2026-09-27T06:18:03.159Z`，结束ROLLBACK，无数据库更新。原始内容留Mac私密归档 `/private/tmp/holaday-authorized-legacy-review-zDa2mv/review.json`，未查询动作input_value、截图或其他用户任务。

6月24日任务 `tsk_r3W3wh5LMNbJcgGDRi22D` 的指令明确是免登录、只读探索 figma.com，学习新建文件/模板浏览等代表流程，并在登录、注册、订单、支付、真实提交之前停止。14条动作全部位于Figma：3次导航，11次点击，涉及Community、Resources、模板主页、Wireframe Kits、Brainstorming和Breakout session模板；未见type、付款或提交记录。这是内部explorer任务的残留running状态，不应称作正在执行的客户任务。

边界：记录为best-effort，序号有间隔（最大21），单凭这14行不能证明所有工具动作或绝对零副作用。当前`explore-sites.ts`已有终态映射及best-effort状态写回，但没有核对6月24日的确切运行版本/异常日志，因此不认定某个catch就是历史根因。未取消、删除、重跑或改终态。建议后续经明确授权后将这条过时内部探索标为取消/失败并保留原动作及LLM记录，而非改成完成；具体路径与并发复核届时核实。

同批核实PayPal精确一条旧Sandbox待处理记录，见[支付证据](2026-09-25-browser-first-cutover-payment-evidence.md)。Yalei USB副本已实际核验，见[密钥保管](../../ops/browser-backup-recovery.md)；不是生产数据库备份。未停服务或写生产配置/业务数据，未部署。

## 2026-09-27 14:50 JST：真实停止参数与物理清单接线

两台主机只读采集均成功：`/private/tmp/holaday-live-host-observer-bA6yUF/{aliyun,vultr}.json`，源SHA `899dd40e959e2042465b254d95282b4881ac1b9c17cb0862406f74d688292d6f`（后续补daemon运行版本核验，不将此旧摘要写作最终版本）。两个实际PM2 daemon分别128388/1170，已安装版本6.0.14，读取的默认停止参数SIGINT/1600ms，daemon无这两项环境覆盖；worker显式660000ms、memory restart 536870912不被填零。所有环境原值均未输出。

将本次实采资料输入新只读分类器作历史观察（使用观察时刻，不冒充当前60秒内批准）。Aliyun可识别当前网关完整5进程和orangebench3个保留进程；965039/965055的4011旧未托管树仍保留未解决项。Vultr识别主程序733273、worker67648和PID0小时files-cron，保留浏览器/VNC/akshare/orangebench等24个进程。监听器检查真实发现4002，已纳入必须覆盖的端口，与4001一起核对。分类器没有全局PM2操作或信号发送能力，实际退出仍由原capture/effects和journal/fence条件控制。

源文件/目录/服务/cron/计时器等全部绑定审查，不以关键词没有命中推导“无未知启动源”。该次未提供源码审查结论，Aliyun223、Vultr265个来源绑定仍未批准；这些是审查记录数，不是新增服务或待删除对象数。PM2实时仪表排除后配置摘要在前后读取间保持一致；实际配置漂移仍拒绝。

另在UTC05:54:18只读查询任务/调度计数，未执行脚本内原支付查询：仍1个6月24日running explorer任务，14次navigate/click、22条模型调用，2个未来active计划；未做业务记录清理。私钥、浏览器profile、支付表/支付方、所有服务状态均未改变。

最终源码加入 `/proc/<daemon>/cmdline` 的实际运行版本校验后，两台主机再次采集成功，UTC `06:04:32.030` / `06:04:37.566`，观察器PID1213763/213706。归档 `/private/tmp/holaday-live-host-observer-aJmL6H/{aliyun,vultr}.json`；源码SHA `1fc086c94ba0b214fc57c2dc9d9bbee46cc71b7b10f87d8aee910c9e4c0480b6`；原始文件SHA分别 `924d136122b1e835472b89cfc737b1688fea36fd9129a4fa7c8f392692a8dbd4` / `9272e152987b3603d39b5daf7a2d0b1396a3f328dc5732fda8392cd1298f8eef`。应用/PM2目标PID保持不变；这是只读事实，不是有效至未来的部署批准。

## 2026-09-27 14:24 JST：真实启动文件和 PM2 主备差异已采集

沿用户已明确授权的两台主机/只读配置范围，原采集器新增 `readCutoverStartupSnapshot` 并在主机快照调用。固定读取 PM2 主/备用文件、systemd 有效 pm2-root 属性与其 Fragment/DropIn 源文件、`/etc/systemd/system` 和 `/run/systemd/system`、系统 cron 目录、Debian/Ubuntu 用户 crontab 目录、rc.local 及实采 PM2 所指向的六个 Holaday 启动脚本。前后两次完整读取并比较内容/链接/目录/元数据；无法读取、内容漂移、循环链接、非文本或超限时拒绝，不把缺失与失败混同。原文可能含私密配置，只保存在 Mac 0700目录/0600文件，不发布到仓库或用户可读报告。

最终实际观察 UTC `05:24:03.390` / `05:24:08.165`，归档 `/private/tmp/holaday-live-host-observer-9ILKHc/{aliyun,vultr}.json`。源码SHA256 `44be604ecaee59509a121dfd26140b7b38b5abc00d879609f55d8319e71f53b8`；阿里云文件SHA256 `76ea9d75187e501bd4d703282167b6472244bd407c6c603b4e7a60376f6a3424`；Vultr文件SHA256 `f331217e6340131d095d360f13436cc7d908eeea612887c4f506988230b3c1ae`。分别175/211条文件观察记录（含显式缺失和同源链接）、30/31个目录，不是175/211个待停止对象。上一次不含五个后补启动脚本的快照为 `...-5FmIVV`。本次在远端用实际 `process.pid` 绑定观察器身份并留原始记录，不再猜测当前采集Node；阿里云1213228、Vultr207630，不据此排除其他root Node。

| 启动来源 | 实际结果 | 切换要求 |
| --- | --- | --- |
| 阿里云 PM2 主文件 | orangebench + holaday-cn-payment；支付入口为 `/opt/holaday-cn-payment/start.sh` | 定向处理支付条目，保留orangebench |
| 阿里云 PM2 备份文件 | 只有orangebench，没有支付条目；摘要不同于主文件 | 不把主文件复制过去，不制造新启动条目 |
| Vultr PM2 主、备文件 | 均含主应用、注销worker、stopped/PID0的files-cron及其他服务；主备摘要不同 | 分别按原始字节核验和保留，不能用全局save替代 |
| files-cron | 两份均有 `0 * * * *`，脚本仍调用cleanup-cron | 无当前PID仍属于未来写入生产者 |
| pm2-root unit | 两端enabled，Restart=on-failure，无DropIn；Aliyun inactive，Vultr active | 保留共享daemon/unit，仅处理批准应用，不把inactive当无开机入口 |
| 云端 headed-browser | `/opt/holaday-headed/start.sh` 第48行删除 `Default/Sessions`，第49行清理Singleton文件 | 不为应用切换附带重启浏览器；这是会话恢复文件，不据此宣称Cookie或登录态已丢失 |

六个启动脚本的存在性、正文和摘要均已读取；没有执行脚本，没有读取浏览器profile、Cookie或历史页面。Vultr主/worker入口分别是 `/var/lib/holaday-deploy/start-orchestrator-production.sh` 和 `start-account-closure-worker-production.sh`。系统cron/rc文件在所采范围未见Holaday字面引用，但字面搜索不是任意间接脚本不存在的证明。

仍需完成：实采清单的逐项职责分类及其引用依赖、受保护批准绑定、双机现场I/O接线和整项演练。用户级systemd/容器调度等不因本次固定范围采集而宣称已穷尽；不返回 `unknownLaunchers=[]` 来假放行。超过60秒的快照仅作历史核查，不作为执行时新鲜证据。本次未停服务、改启动/防火墙/数据库/订单/支付、读取恢复私钥或部署。

## 2026-09-27 13:58 JST：用户明确授权后的双机完整采集器快照

用户回复“允许上述只读采集”后，将现有采集器通过严格 SSH 传入指定两台主机的 Node 内存执行；无远端落盘、服务/配置修改、数据库或支付查询。这里“完整”仅指当前采集器的所有字段均成功返回，不是所有主机启动源或业务责任已穷尽。

首次 Vultr 成功、阿里云拒绝。最小诊断确认是 `crontab -l` 返回 code 1、空 stdout、`no crontab for root`；不是连接失败或读取权限失败。本地采集器现仅接受这一精确正常缺失结果，单独记录 `rootCrontabPresent=false`，并在最终快照前复读比较。权限错误、部分输出、信号中断、其他用户、其他退出码及期间状态变化仍拒绝。没有在服务器创建空 crontab。

修正后两端均成功，以下为 UTC 时间：

| 主机 | 采样时间 | 关键事实 |
| --- | --- | --- |
| 阿里云 | 2026-09-27 04:58:35.429 | 12 条相关进程、2 个 PM2 注册、12 份 nginx 来源；4010 PID1098048 与旧4011 PID965055 仍通配监听。现用支付完整包装树/旧独立树均保留；root 无个人 crontab。 |
| Vultr | 2026-09-27 04:58:40.223 | 28 条相关进程、9 个 PM2 注册、17 份 nginx 来源；orchestrator PID733273、account-closure-worker PID67648 均 UID998；root 个人 crontab 存在，80字节。 |

阿里云 `pm2-root.service` inactive/dead 但 enabled，PM2 daemon PID128388 仍在；Vultr 同名 unit active/running 且 enabled，daemon PID1170。两端 cron/nginx 均 active/enabled。运行状态和开机配置必须分别处理，不能把 inactive 当作不会重启。无关 orangebench/akshare、浏览器/VNC 树也被观察到；这些不是自动停止清单。

原始快照仅在 Mac 私密目录 `/private/tmp/holaday-live-host-observer-sVf60k`（0700），两文件0600，未放仓库。采集器源码 SHA256 `4c054eefe12f88ec8ab49b423b5a5e2087435453805d42bb6b5e73818aa48b83`；`aliyun.json` SHA256 `03106d8e49c77a0fdce0df9705dda5733f4855ced9d547e76ecd45e8b099c9c5`；`vultr.json` SHA256 `ddcc3a98e96dccf6fb9ec7368432eb997a53b11ea1110d514966999a91a14943`。初次 Vultr 成功在 `...-AefxXu`，阿里云定位诊断在 `...-9eZ87a`；均非生产备份。

边界：原始清单含采集当时的 Node 观察进程候选（阿里云1212896、Vultr204324），尚未绑定观察器自身身份，不得按名称忽略所有 root Node。systemd 列表不是 unit 完整配置，root crontab 不覆盖系统 cron/其他用户，nginx 原文也尚待路由分类。受保护停止清单、启动源全量分类及实际双机切换仍待完成；旧支付树不据此自动退役。此快照超过60秒后仅可作历史核查，不能直接作为部署时的实时许可。

## 2026-09-27 后续实际变更：恢复公钥设施

用户允许上节之后提出的Mac私钥/离线副本/生产仅公钥方案。本轮不再是全只读：Vultr新增发行版签名age包`1.0.0-1ubuntu0.1`，没有升级其他包，设置needrestart为只列出而不自动重启；新建`/var/lib/holaday-deploy/recovery-20260927` root0700，只有root0600公钥及无业务数据密文探针。Mac生成私钥、公钥并接收探针，私钥从未上传。详见[完整密钥记录](../../ops/browser-backup-recovery.md)。

安装后的实际systemd观测：mysql/nginx/pm2-root仍active，主进程启动时间分别为2026-09-01 06:37:55 UTC、2026-09-15 06:25:37 UTC、2026-07-27 14:40:31 UTC，均早于本次安装。没有按apt提示重启内核或其他服务。既有部署父目录root0755，最初按0700预期的检查拒绝；现已核清，原目录未chmod，仅独立子目录0700。

公钥及密文摘要双端一致，Mac真实解密和公钥/篡改/截断拒绝验证通过；未读取业务数据、导出数据库、连接支付方或停止服务。离线副本及真正数据库隔离恢复仍未完成，不修改此前有限只读审计的证据边界。

## 2026-09-27 12:25–12:27 JST：备份设施只读核查

从`8025b554`继续。阿里云直接SSH、Vultr经阿里云中转均成功，双端严格校验主机指纹、不转发agent；仅读工具可用性、限定目录元数据、定时器/调度引用文件名、磁盘容量和文件类型，没有输出环境配置、密钥、数据库内容。

| 项目 | 本轮现场结果 | 边界 |
| --- | --- | --- |
| Vultr数据库工具 | mysql/mysqldump 8.0.46，mysql unit active | 本机socket默认认证被拒绝，未取得server UUID/表容量，不代表现用应用认证失效 |
| Vultr容量 | 根盘可用99G；`/var/lib/mysql`占423M | 目录总量不是逻辑dump大小或恢复资源预算 |
| Vultr现有备份目录 | `/var/lib/holaday-deploy/backups`为root 0700，仅两份9月4/5日环境配置副本，文件0600、UTF-8文本 | 不是数据库备份；未读取内容、复制或删除 |
| Vultr隔离恢复环境 | Docker可用；当前仅看到既有neko容器，三个现存镜像都是neko | 未发现专用MySQL恢复实例/镜像；不等于云端或其他位置不存在 |
| 两台主机加密工具 | gpg/openssl可用，PATH未见age/restic | 工具存在不等于已配置设施或密钥托管 |
| 阿里云 | PATH未见mysql/mysqldump/docker；根盘可用17G | 当前检查没有证明它可作为数据库恢复目标 |

限定检查包括`/var/backups`、常见Holaday备份目录、Vultr `/opt/holaday-monorepo`、`/opt/holaday-releases`及`/var/lib/holaday-deploy`的浅层备份命名项、现有systemd timer、cron/systemd文件中的备份引用文件名，以及指定root GPG/restic/备份配置目录的存在性。观察到的备份timer仅dpkg；指定密钥/恢复配置路径未发现。**不是全机、云快照、对象存储或所有用户密钥库的穷尽审计，不能声称完全没有备份。** 未为搜索执行`gpg --list-keys`，避免首次运行创建密钥目录。

生产加密设施和独立恢复目标仍缺真实接线。需要明确现有恢复公钥/设施，或由用户确认新专用恢复密钥的保管地点；不把QA一次性内存密钥提升为生产方案，不复用SSH/API凭据作为加密密钥。待确认方案：生产只保留加密公钥，恢复私钥由用户Mac及另行离线备份保管；使用私钥的隔离恢复流程须随后明确，不上传到生产机或写入仓库。未生成密钥、创建恢复容器、拉镜像、导出数据库、安装软件、变更调度、停服务或改云规则。

本轮无产品代码/测试变更，不把历史397/397或MySQL2/2当作新结果。Task4/5/6状态不变，完整host、双主机切换和独立审查仍未完成。

## 2026-09-27：阿里云安全组控制台只读核查

用户完成登录后，Chrome控制台读取成功。目标为杭州实例 `i-bp1itfzrcudbji9gshm9`，公网 `47.99.169.186`、私网 `172.26.78.219`，运行中。杭州实例列表共1条。安全组列表共1条，普通组 `sg-bp1itfzrcudbji9dnh6x`，VPC `vpc-bp1n674a009zfsc8eeowg`，IP占用1，组内策略“组内互通”。本段资源标识只用于核对本次部署目标，无凭据。

安全组详情和目标实例的“内网入方向全部规则”两处均确认以下4条，同属上述安全组：

| 策略 | 优先级 | 协议/目的端口 | 来源 |
| --- | --- | --- | --- |
| 允许 | 1 | TCP 1–65535 | IPv4 0.0.0.0/0 |
| 允许 | 100 | TCP 3389 | IPv4 0.0.0.0/0 |
| 允许 | 100 | TCP 22 | IPv4 0.0.0.0/0 |
| 允许 | 100 | ICMP IPv4 全部 | IPv4 0.0.0.0/0 |

全TCP规则创建时间为控制台显示2026-03-05 10:13:20，其余三条2026-03-04 19:01:57。这解释了此前公网4010/4011可达；本轮没有重新TCP探测或修改规则，不能说端口已关闭。目标实例的聚合规则直接证明绑定关系，不仅凭相似ID推断。安全组自己的“实例列表”长时间停在loading，不能把其中“暂无数据”当零关联；辅助网卡页显示暂无数据，但未据此证明所有ECI/网卡/跨服务引用已穷尽。未核验IPv6地址分配、出方向、SLB或完整VPC拓扑。

官方依据：[安全组规则](https://www.alibabacloud.com/help/en/ecs/user-guide/security-group-rules)说明同优先级拒绝先于允许，且规则控制公网与内网，安全组带连接状态；[普通/企业安全组](https://www.alibabacloud.com/help/en/ecs/user-guide/basic-security-groups-and-advanced-security-groups)说明普通组内互通可优先于自定义规则。不能仅增加默认优先级100的拒绝，也不能以控制台保存成功证明已有连接和同组内网已被隔离。

部署候选裁决：不删除宽泛允许规则，避免同时改变未知服务；正式切换时可增加明确命名、优先级1、TCP4010/4011的窄拒绝（IPv4及需审查的IPv6范围），作为云侧持久入口控制候选，并用外部新连接/已有连接、同机loopback、nginx和SSH探针核验。现有主机nft屏障及候选loopback监听仍保留，不新增自研开机防火墙框架；云侧规则尚未应用，不能宣称重启隔离已完成。操作前复核关联资源/规则漂移及是否存在合法直连依赖，纳入本次批准清单和变更记录。

控制台简捷版网络组件未加载，改用标准版和目标实例聚合规则页取得事实；没有运行远程命令、健康检查修复、授权角色、重启/停止实例或创建/删除/保存安全组规则。本轮仅UI导航与本地核查记录，支付/订单/数据库/应用配置未动。

## 2026-09-27：支付网络规则仅检查，不应用

候选新增固定4010/4011非loopback隔离策略，并接入本地维护流程（见checkpoint最新节）。本次现场只调用阿里云`nft --version`、前后两次只读规则摘要及`nft --check -f -`，使用严格SSH主机指纹、不转发agent。nft1.0.2接受策略；前后摘要同为`ba9a5a8d6eac1a04c281dd60469d784f95dcf783f525b9e4be8dea6043c9e39e`，没有写规则或关端口。记录`/tmp/holaday-payment-ingress-host-check.log`。

这证明当前工具/内核接受规则，不证明线上端口已隔离；上一次公网可达发现并未被本地代码改变。规则不自动开机恢复，生产入口及重启持久化仍待整项落实。未重新查询业务数据库或支付方、未停4011或现用网关。

## 2026-09-27 00:09–00:12 JST：支付端口公网旁路已实证

限定只读SSH、现有日志聚合与本机TCP探测，未修改线上配置、进程、防火墙或数据库，未调用支付方。

- 4010仍为PID1098048，当前604ddf17e84a发布，由PM2 id1启动；4011仍为965039→965055旧独立树，root、PPID1、083a6232aca7发布。采样前后start/cwd稳定。后者属于`session-31639.scope`，systemd状态为active/abandoned，不在当前PM2清单中。
- 4011的标准输出仍持有已经删除的`/tmp/holaday-cn-payment-candidate-health.log`。只读该已打开普通文件的55,295字节并输出聚合：95条JSON记录，2条healthz、88条其他URL记录；没有上述规范支付创建/回调路径记录。**这是现有日志样本，不是完整业务审计；不能证明从未处理支付或已经排空。** 文件名和会话形态支持“候选健康检查残留”的推断，但未找到原启动命令。
- 4011实际入口源码SHA256为`db77b882e5ac27b13aaf722e669d36042764fae8362c27f41f86eed3bb6953eade836`，与本地Git对象083a6232aca7中的入口完全相同，包含真实支付/短信/内部确认路径。其磁盘配置PORT=4010而实际监听4011，说明不能仅从磁盘配置推断运行端口；本轮未读取输出原始环境值。回调域名仍为hd-pay，内部桥接为holaday.ai。
- 当前启动脚本、PM2主备保存文件、所检查systemd顶层单元、cron及极短root历史中未发现4011引用。该有限搜索不是所有启动来源均已证明不存在。PM2现用支付及无关orangebench注册保持原状。
- IPv4/IPv6 iptables-save、nft ruleset均成功返回空规则，UFW inactive。**Mac对47.99.169.186:4010及:4011的两次TCP连接均成功。** 这证明采样时从本机网络存在公网直达路径；不是云安全组的完整审计，也不表示任意来源都可达。与实际通配监听相结合，原nginx维护屏障并不覆盖这两个直接入口。

本批修复仅作用于候选：cn-payment显式监听127.0.0.1，匹配已核对的同机nginx upstream和发布脚本健康检查；无通配监听配置开关。原始入口和旧进程不受本地改动影响。首次切换仍须先隔离旧实例的直接网络入口，保留按阶段允许的域名回调通道，再按精确清单退休旧进程；不能用新候选回环监听替代旧进程隔离证据，也不能凭这次调查自动停4011。

私密忽略归档：`qa/payment-lineage-20260927/`，目录0700、文件0600，含只读诊断脚本和脱敏结果，不含原始环境/日志/历史文本。完整主机分类、实际端口隔离、双主机host接线与恢复演练仍未完成。

## 2026-09-26 22:22–22:28 JST 支付来源核对（最新）

双主机只读SSH成功，未停服务、修改配置/数据库或调用支付方API。详细计数与限制见[支付证据](2026-09-25-browser-first-cutover-payment-evidence.md)。关键更新：PayPal待核对记录属于sandbox，但当前配置为live；国内旧记录未保存环境/商户身份，支付宝当前及旧网关配置均缺seller ID。不得直接把当前配置用于全部历史订单。

4011仍监听，PID965055，旧release；Node通过 `--env-file` 读取已配置的支付/桥接参数。内核初始环境未见变量不等于有效运行环境为空。4010 PID1098048、4001 PID733273仍与前次身份一致；本轮检查了采样前后start/cwd稳定性。尚未核清4011的完整入口责任，不能自动停用。指定dotenv源的存在性不证明完整启动来源已分类。

元数据与只读事务结果保存在本计划忽略QA的 `payment-binding-audit-20260926/`；无商户ID/订单号/密钥输出。本轮只增加诊断和记录，不重复宣称历史测试为新通过，也未完成实际host/provider组装或部署。

## 2026-09-26 17:12–17:21 JST 恢复核查（历史）

本节优先于下方09:48历史快照。用户已授权当前大项的实施、PR、必要合并、部署和验证；不能据此跳过真实放行检查或自动清理历史业务记录。

### 连接与完整入口资料

- 本机到两台主机的22端口TCP探测成功，直连Vultr SSH在banner交换阶段超时；阿里云直接SSH成功。从阿里云读取Vultr的公开SSH banner立即成功，随后使用已有凭据、严格双主机指纹校验、禁止agent转发的SSH中转执行Vultr `true`成功。未修改VPN、防火墙、sshd或任何服务器配置。该结果证明替代读取路径可用，不确定直连故障的具体网络根因。
- 中转第一次尝试、阿里云路径元数据第一次采样均因本机自动审批超时而未执行；各按工具允许重试一次后成功。不能把审批超时当服务器拒绝。
- 取得两台主机完整 `nginx -T` 和原始站点文件。三个HOLADAY站点原文件摘要与本文件第2节一致；阿里云两个正确站点名均含 `.orangebench.tech`，缩写路径不存在，不应继续猜路径。
- 新增只读 `readCutoverNginxSnapshot` 已接入现有主机采集器：读取两次nginx测试输出、逐文件规范路径/属主/权限/原始字节摘要，并复核源文件与软链接目标未变。不会把UID501发布文件当成root可覆写文件，也不允许人工上传报告替代采集。原文只用于私密证据。
- 实际采集器在Vultr取得17个源文件（20,992字节），阿里云12个（19,337字节）；后者仍有一个UID501的hd-app发布文件。隔离Linux Node22.20/root下真实nginx采集也通过。`nginx -T`证明磁盘配置可解析，**不证明当前worker已加载该版本**；实际fence/reload/探针接线仍需完成。
- 4010/4011仍由Node PID1098048/965055监听，仍未取得4011公网/内部旁路职责的完整证明；不自动停止。

### 数据库只读事务事实

采样08:15:16 UTC：

| 范围 | 新鲜结果 | 不能据此推断 |
| --- | --- | --- |
| 未解决任务 | 1条 `running`，`origin=explorer`；创建/更新时间均为2026-06-24 16:29:22.664 UTC；无session/plan、无普通task_events/task_steps | 不是零工作，不能直接改为完成/失败或删除 |
| Explorer关联轨迹 | 3次navigate、11次click；22次LLM调用；最后动作16:31:14.695、最后调用16:31:21.028 UTC | 无普通步骤不等于未发生浏览器执行；历史点击外部结果尚未核清 |
| 待核对支付 | PayPal 1、微信3、支付宝9，均有provider_order_id；partner支付为空 | pending不是已付款或确定未付款；仍需支付方只读核对 |
| 生产者计划 | 2条active scheduled_tasks，当前due=0；最早next_run=2026-09-27 01:07:07.626 UTC；planned_task_runs与batch_tasks为空 | 当前未到期不等于可以忽略未来派发 |
| 注销请求 | 1条cancelled | 不代表注销worker的启动来源已停用 |

首次步骤统计误用了不存在的 `task_steps.updated_at`，返回ER_BAD_FIELD_ERROR；检查既有schema后改为created_at/started_at/completed_at，再执行完整只读事务通过。没有修改schema或业务数据。后续沿真正Explorer路径补查 `task_action_captures` / `llm_calls`，保留错误和修正证据，不能把第一次部分查询成功说成全部通过。

候选现有 `apps/orchestrator/scripts/explore-sites.ts` 会创建origin=explorer/running行，再best-effort更新终态；源码还记载了历史CLI异常退出遗留running的情况。这与现场形态相符，但尚未将确切旧版本、退出日志及外部结果关联到该行，故仅为调查方向，不是终态修复依据；本轮未改Explorer代码或历史记录。

### 私密证据索引

原文保存在本机0600文件，且已原样复制至本计划 `.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/qa/host-audit-resume-20260926/` 私密归档目录（0700，五份文件均0600）。不提交到Git，不输出凭据、任务正文、用户ID或订单号：

| 文件 | SHA256 |
| --- | --- |
| `/tmp/holaday-vultr-nginx-collector.json` | `a9675919f7b289ffac9003e0019316a3250a356e02cffa69644a061a72ad30c8` |
| `/tmp/holaday-aliyun-nginx-collector.json` | `e905bc9d600f38924d91b055156202945d0abedeb19420108b652d9a5cf2c8be` |

业务聚合原始证据：`/tmp/holaday-live-work-via-jump.json`（含最初字段错误）、`/tmp/holaday-live-work-via-jump-final.json`（修正）、`/tmp/holaday-live-work-explorer-followup.json`（真实轨迹补查）；私密归档保留同名副本。缺失时重新只读采集，不可仅从本文生成ready报告。部署前必须重新采集，不能复用本次时间戳。

新鲜回归：采集器40/40；浏览器发布脚本288/288（包含正常部署shell的6项）；完整test:ops退出0（120/50/16/65及shell）；两个触碰MJS的Biome与diff-check通过。Linux Node22.20全套初次39/40，既有publisher fixture使用process.getgid()导致root组0被正确拒绝；改为以UID/GID998运行原测试后40/40，不修改产品条件或断言。真实root nginx采集另行实测通过。对应日志 `/tmp/holaday-nginx-observation-{targeted-final,browser-final,ops-final,linux,linux-suite,linux-suite-final}.log`；本轮未重跑orchestrator/cn-payment完整应用测试，不复用旧结果冒称新验证。

本节收口的是连接恢复、完整配置采集和业务事实核查。Task4完整host/nginx隔离/多主机DB/provider/readiness/shell接线，Task5恢复演练与外部支付证据，Task6整流程/独立审查均未完成。未push/PR/merge/deploy，未停服务、修改线上配置/DB、支付结算/权益/额度、UI、模型路由或扩展。

## 09:48–09:51 JST 历史快照

核查：2026-09-26 09:48–09:51，Asia/Tokyo。用户在明确只读范围后回复“继续”。分支 `codex/browser-release-candidate-20260925`，HEAD `844c2ced779fa360b62e2bfbdd87d4909d13b8a0`，Task 4 本地改动尚未提交。

结论：现场资料已补充，但现有首次切换适配器不能直接用于这两台主机。此前 243 项脚本与 Linux 组件通过证明的是已覆盖的行为，不证明实际部署形态已全部适配。下列四项是既有切换路径的适配差异，不新增浏览器、支付或 UI 功能。

## 1. 已核实的现场事实

| 范围 | 现场事实 | 对切换的影响 |
| --- | --- | --- |
| Vultr 主应用 | PID 733273，UID998，`/opt/node22/bin/node`，监听 4001/4002，旧 cwd；PM2 id271，autorestart=true | 可继续使用精确旧应用身份；仍需实际工作核查 |
| Vultr 注销 worker | PID67648，UID998，PM2 id272，kill_timeout=660000ms，memory restart=536870912，autorestart=true | 当前 first-runtime 的 600000ms 上限及 memoryRestart=0 条件不适配；不能填零或伪造为停用 |
| PM2 管理器 | 两台实际管理器均为 `/usr/bin/node`；Vultr PM2 6.0.14 | 当前要求管理器 exe=`/opt/node22/bin/node` 的假设错误；应用身份和管理器身份必须分开 |
| 阿里云现用支付网关 | PM2 id1 根 PID1097924 → dash1098031 → tsx1098032 → Node1098048 → esbuild1098060；五个进程 UID0，Node 为 `/usr/bin/node`，监听4010 | 不是 UID998 单 Node 进程树，不能用现有 main/worker 假身份套用 |
| 阿里云旧网关 | 965039→965055，UID0，`/usr/bin/node`，旧 release，父根 PPID1，仍监听 `*:4011`；不在本次 PM2 应用清单中 | 属独立旧树；不能因未见当前请求就自动判为废弃或停止 |
| 支付入口 | `hd-pay.orangebench.tech` 的 HTTPS `location /` → `127.0.0.1:4010` | 当前有效 nginx 配置没有4011字面引用；不等于证明公网直连被阻止、业务已废弃或可以停用 |
| 文件清理计划 | `holaday-files-cron` 当前 stopped/PID0，仍有 `0 * * * *`；相同条目存在 PM2 保存文件 | 当时没有活 PID 不等于取消未来派发，必须纳入生产者范围 |
| 文件清理实际代码 | 线上文件与候选 `src/files/cleanup-cron.ts` SHA256 都为 `5fe36b8971563f9e8c3aa384fca9d8ff259af5fc5cc66af3a375c36e4eab59fc`，调用 storage.delete 和 taskFiles UPDATE | 是会写文件/数据库的任务，不可仅凭外层启动脚本未出现 DELETE 字样忽略 |
| 其他 Holaday 进程 | Vultr headed-browser 子树16个进程，VNC子树4个进程，另有 akshare Python服务 | 需要区分业务写入/外部执行依赖与保留服务；不能全局停止 PM2 或直接排除不认识的对象 |
| 启动持久化 | Vultr pm2-root active+enabled；阿里云 pm2-root inactive+enabled，但独立 daemon 仍活着且有保存条目 | 不能只检查 systemd active 就推断有无管理器或重启来源 |

两次 ss 采样在目标端口仅见 LISTEN；这不是持续排空、外部工作结束或未来不派发的证明。本次不查询业务数据库，不核对历史订单，不读取浏览器页面或登录资料。

PM2 6.0.14 的本机安装源码默认停止值为 1600ms / SIGINT，但允许环境覆盖；本次没有将源码默认值冒充 daemon 最终有效配置。

## 2. 实际入口与当前解析能力的差异

- Vultr `/etc/nginx/sites-enabled/holaday` → `/etc/nginx/sites-available/holaday`，UID0/0644。文件 SHA256：`c2372d3ed03847c794e3e49501ee5890a12e9c2c876b95dfadeeee585340897f`。
- 阿里云 `hd-pay.orangebench.tech` → `/etc/nginx/sites-available/hd-pay.orangebench.tech`，UID0/0644。SHA256：`ffe595e8fc106be4fc4148bc054e348dcc05d59c773efe30e7b090bdad590261`。
- 阿里云 `hd-app.orangebench.tech` → `/opt/holaday-edge/releases/20260905035410-30748/ops/aliyun-edge/nginx-hd-app.conf`，实际文件 UID501/0644。SHA256：`65973c9afc53c484ce7e2becbe013de3622adeb6d77723a29cefd1ef6dfcec4c`。不能当作 `/etc/nginx` 内 root 私有可覆写原文件。
- 现有配置含多 listen、多 server_name、TLS include、静态 try_files、正则资源 location；Vultr 还存在直接到6080的 `/vnc/`。现有窄 nginx fence parser 会拒绝这些形态，这是未适配，不应简单删除其拒绝检查。
- 大陆入口 `/api/`、screencast、VNC WS、`/ws` 转发到 Vultr；只改其中一个入口不能证明全部业务写入已隔离。

此处文件摘要来自原文件字节。`nginx -T` 输出分段带额外换行，其分段摘要仅用于输出一致性，不等于原文件摘要。

## 3. 固定修正清单（部分本地实现，不是生产授权）

后续本地进展：第1项的管理器/网关完整身份、首次helper和660000ms显式超时适配已实现，含整批停止预算校验。254项脚本回归、Python7+4及Linux组件实测通过；详细边界见checkpoint。第2项启动来源、第3项实际nginx和第4项接线整体验证仍未完成。当前仍拒绝 memoryRestart 非零和 cron 存在的对象，不把真实配置归零。

1. **实际身份适配**：首次路径区分 main/worker、管理器、网关完整树；精确绑定观测的 UID/exe/cwd/启动时间和批准对象。不能全局允许 root/任意exe，也不能改普通升级或候选 UID998 规则。核清默认/显式停止超时与重启来源。
2. **完整生产者处理**：把无当前 PID 但有未来调度的 files-cron 纳入；注销 worker 的 memory restart 与长超时按真实配置处理。其他浏览器/VNC/akshare服务需明确保持或纳入，不能“未知即无关”。
3. **真实入口隔离**：以两个站点和支付入口的实际拓扑设计最小配置变更与回退；保留静态资源/TLS/现有路径，不用任意 nginx 文本重写。单独覆盖旁路端口、现有 WS 与内部转发；4011 无 nginx 路由不能替代防火墙/安全组证明。
4. **接线后整体验证**：将这些现场形态转成脱敏 fixture，实际 host/journal/evidence/readiness 接通后，再做隔离 Linux/MySQL 全流程与整分支审查。现有成功数字不作为该步骤已完成的依据。

部署时仍需重新采样并逐一批准实际操作对象、配置摘要、窗口及恢复方式。本次不扩大为支付重构、浏览器重写或全局服务整改。

## 4. 证据与边界

### 后续本地启动来源核验（不是生产变更）

在一次性、无网络、私有PID容器内，以本次新建 `/tmp/holaday-pm2-startup-*` 专用PM2_HOME运行PM2 6.0.14。日志 `/tmp/holaday-task4-pm2-startup-characterization.log`，脚本在本计划QA目录 `pm2-startup-characterization.mjs`，退出0：

1. `stop <id> --watch` 后，带加速cron的测试进程确实再次启动，无关测试进程PID不变。
2. `delete <id>` 后跨过两个cron时点未再出现目标，其他进程不受该操作影响；但主保存文件和备份保存文件仍有该目标。
3. 仅该专用测试daemon的恢复会从未改主文件重新启动目标；故意破坏测试主文件时，备用文件也能单独恢复目标。
4. 在测试主备文件中移除该目标后，再恢复只启动保留的无关测试应用。此处是原理验证，不是具有生产文件保护、独立主备比较和journal绑定的实际适配器。
5. 对真实Worker.js控制定时器/异步采样边界：旧内存采样能对仍登记为stopped的对象调用reload；从其内部注册表移除后则不再调用。该项是依赖行为测试，不冒充真实生产内存竞态重现。

这解释了为何不能把 memoryRestart 填零、把 PID0 当永久停用，也不能用一次 `pm2 save` 当作精确清理证明。核验当时尚未写入生产路径；后续用户已批准本地实现，主备文件处理和真实journal已完成隔离验证，现场运行注册删除与全host组合仍未实现。

**已获准本地实现的最小策略：** 仅首次切换，在入口/未结工作/精确对象核验通过并完成私密备份后，按批准唯一PM2 id移除旧对象运行注册；同时精确移除主备启动文件中已批准、摘要绑定的旧对象条目。每个文件单独核对原始摘要与保留条目，不能把一份文件整体覆盖另一份；无关应用、daemon、systemd保持不动，不运行全局delete/kill/save。每个副作用前记录intent，不确定结果不自动重试/回启旧版。完整树、存活监听及各启动来源再次复核后才能迁移。

这是从“停止”扩展到“移除旧注册及定向修改自启动记录”的操作策略，用户已回复“允许”确认本地实现和隔离测试，不再重复请求；不授权修改线上服务。部署时仍逐项批准实际对象、文件摘要、维护窗口和恢复责任。现场删除入口未接完前，首次runtime对cron/memory非零的阻断保持不变。

脱敏原始结果保存在本计划忽略目录 `.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/qa/host-audit-20260926/`：

| 文件 | SHA256 |
| --- | --- |
| vultr.json | `0deec7f0ae1b9f259227dc4fc1bc5ee69f080df16e170d7f5aa97ed8daf687dc` |
| aliyun.json | `dfd5b2a8301572010ad94a5d3cb3a8dff266d241a817b04c754132b03aa3f0d0` |
| vultr-followup.json | `0dfffbf21757a825eaec5e1f06b0146511c3da518479f53074c7313c5a74b143` |
| aliyun-followup.json | `da2410abb92b00ef217de6887046a727b6ba673bc3c042a78a1a918fdad74280` |
| vultr-metadata.json | `465cc17e959aac9f700f48ee670fd239407190f7786f914abac1bf35665a15d9` |

五次 SSH 均完成，严格验证已知主机指纹，使用已有凭据且未输出凭据；只读取 `/proc`、ss、PM2 jlist/保存元数据、systemd元数据、nginx -T 和指定脚本/代码摘要。未上传或执行部署程序、reload/stop/restart 服务、修改线上配置、连接业务数据库、创建/查询/扣款/退款支付、改变额度、UI、模型路由或扩展。只读诊断可能产生正常 SSH/服务日志，不宣称服务器字节级无变化。

本轮没有修改产品或停止实现，也没有重跑上轮已通过测试；243项通过属于上一轮记录。Task 4 仍未完成，未提交/push/merge/deploy。
