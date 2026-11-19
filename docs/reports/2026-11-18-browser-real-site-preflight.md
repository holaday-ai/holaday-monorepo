# GitHub / Sheets 真实站点验收前置核对

本记录完成只读源文件比对、文件校验器准备、本机已安装扩展盘点及独立Chrome157候选加载检查。尚未运行候选App/项目插件的真实站点任务，不是账号、物理操作或上线验收通过。

机器摘要：[browser-real-site-preflight-20261118.json](evidence/browser-real-site-preflight-20261118.json)。精确测试表URL、源文件、用例提示词、预期摘要和校验器保存在既有私有恢复目录的 `release-readiness-20261118/real-site-preflight`，不公开账号或业务数据。

随后完成的不依赖AWS的Chrome157本机检查另见[完整App与协作协议验收](2026-11-18-browser-chrome157-local-acceptance.md)：文件闭环1/1、协议14/14，均为回环站点/合成账号/当前源码QA扩展。它补充本机功能证据，不改写本记录中真实GitHub/Sheets任务与账号仍未验的状态。

## 人工登录与真实模型连通更新

用户已报告GitHub登录完成；Google在原自动化窗口被拒绝，截图同时显示Chrome同步登录入口。Google官方说明，软件自动控制的浏览器可能无法登录；本轮没有隐藏自动化标志、关闭安全保护或复制现有登录状态，而是通过正常Chrome界面新建独立的`Holaday 验收`资料，由用户从测试表网页人工登录。[Google官方说明](https://support.google.com/accounts/answer/7675428?co=GENIE.Platform%3DDesktop&hl=zh-Hans)

已实际观察到该独立资料中的原生测试表标题及RawData页签；Chrome版本页显示的正常进程命令行不含自动化/远程调试参数。已取消切换到日常既有资料的提示、跳过可选头像设置，未执行开启Chrome同步操作。截图只留私有恢复目录，不记录完整OAuth/GDS跳转URL或其中的临时参数。此项证明Google人工网页登录完成；GitHub仍为用户报告，稳定主体、项目插件连接及云端账号恢复没有因此通过。

随后完成1次实际阿里云模型SDK连通检查：使用冻结2f22be1d的messages adapter/transport/route/env模块，相关4文件hash与冻结清单一致。原服务器内部沿用现有CN工作区凭据，请求及真实响应通过既有SSH通道返回本机SDK；凭据值不返回、不复制，不修改生产配置或新建凭据。固定合成文本、最多32输出token、无重试，qwen3.8-flash返回HTTP200，使用29输入/1输出token。接着补充禁止HTTP重定向的防护，语法及3项本地范围/预算拒绝检查通过，没有为防护整理重复收费请求。

以上仅证明真实模型通道可用。候选App/SQL/项目插件与该通道尚未接成真实站点任务，实际GitHub JSON/Sheets CSV交付次数仍为0。后续复用已准备的临时测试传输，不将合成模型、连接器读取或一次连通检查冒充两站验收。详见[机器证据](evidence/browser-real-site-login-and-model-20261118.json)。Goal已由用户恢复并经接口核实为active，继续推进；先不合并、不上线。

真实任务所需的新本机MySQL8.0.46实例已另行准备，限制384MiB/CPU0.5、端口仅绑定回环地址；从已捕获的只读快照装入96张表结构，业务行复制0。它是下一步完整App/真实模型/站点联合验收的空结构模板，尚未运行两站任务；此前迁移与SQL测试证据仍保留原批次，没有重新运行或冒充本次联合验收。

## 原始文件与预期统计

GitHub读取固定合并提交 `91ba3cd6b7b208231f60265a7bb805ae7a5af2cf` 的 `docs/reports/evidence/pr360-premerge-20261118.json`。网络连接器返回的7560字节与该Git对象逐字节一致，SHA256为 `159dc809f6ae1341317b1dd8e917c11fa4ad27f6808ebd336139f0f99b706be0`。

后续摘要CSV按批次列出8行：5个initialTestMeasurements、core_recheck、focused_unit、separate_sql。不同批次保留独立身份，不求重叠批次总数；首轮backend的4个失败、core批次的1个失败保留，后续51/51和独立SQL1/1不改写旧批次。源中未给出的files/pending复核字段留空。给实际任务的提示词只规定栏目及来源，不预填隐藏的数值答案。

Google Sheets元数据确认只有 `RawData` 一个工作表；API原生导出完整匹配100条序号1–100，amount为序号+0.25，合计5075.00。原生CSV是1000字节、100个CRLF且无末尾换行，SHA256为 `f0a91ea82ffde445b25c0cd413d3426f757ba2292aa16435d3ddab540cb86331`。最初本地模板是901字节、LF且有末尾换行，二者字节不同而数据一致。

实际插件验收必须分别记录下载事件/存储/历史下载的原始字节hash与解析后的数据，不用本地模板hash强行代替原始下载hash。API导出hash仅是前置参考，尚未宣称浏览器下载字节相同。最终汇总的data_rows与amount_sum必须来自该任务真实统计回执。

本地文件比对器的7个样例通过：GitHub及两种换行CSV共3个正例；修改JSON原始字节、把core批次伪报全绿、漏掉最后一条记录、错误汇总金额共4个反例均拒绝。它仅证明文件比对规则有效，不证明项目插件、账号或物理输入已验。

## 实际安装状态

日常配置的原生Chrome扩展管理页只读核对结果如下；该次只读盘点仅核实磁盘版本，后续独立实例的运行版本另列：

| 扩展 | 版本 / 状态 | 实际ID / 来源 |
| --- | --- | --- |
| HOLA DAY | 0.0.1，停用 | `pfcicombbnhpjmiopcaccngbidlkgfpl`，主工作树dist未打包安装 |
| HOLA DAY · Local QA | 0.0.3，启用 | `hjpkgiddhiolmmibeaeegpmmogjmalji`，20260925历史QA目录未打包安装 |
| 已冻结正式候选 | 0.0.5，未安装到此次核对的配置 | ZIP摘要仍为`311647dacb6a47c34c6c9a164301c4eab7af50d9836a85b640a697f905395185`；没有固定public key，未猜测安装ID |

本次另开扩展信息标签页，没有加载、重载、启停扩展或更改浏览器设置，没有复制日常profile。旧的已加载0.0.3不能当作当前0.0.5候选的实际运行证据。

Chrome官方从137起移除了正式品牌构建的`--load-extension`入口；既有Chromium147脚手架的启动方式不能直接当作Chrome157可用证明。[Chrome官方说明](https://developer.chrome.com/blog/extension-news-june-2025)

## 独立Chrome157候选加载检查

实际启动一份空配置、headless的正式Google Chrome，`Browser.getVersion`核实运行版本为`Chrome/157.0.8103.79`。按Chrome官方测试示例，通过独占私有pipe及`Extensions.loadUnpacked`加载上述冻结ZIP的原始字节；未开放调试端口，未使用旧load-extension参数、关闭Web安全或复制日常profile。[Chrome官方加载示例](https://github.com/GoogleChrome/chrome-launcher/blob/main/test/load-extension-test.ts)

本次固定解压路径的实际ID为`olmdjdkljgkmpodheoanlfaahnfllopj`。扩展列表确认启用，后台实际返回HOLA DAY、0.0.5、MV3及相同ID；新配置中无应用access token。没有manifest public key，因此该ID不作为其他安装路径的预期ID。

前两次检查失败并保留原始证据：后台目标已存在，但脚本尚未加载完，直接求值时`chrome`为undefined。对照本地Playwright1.59.1的worker初始化顺序，增加Runtime初始化/恢复和有界就绪等待。第三次同一候选字节、同一浏览器模式下，记录到executionContextCreated及workerScriptLoaded，第二次状态读取已具备runtime/storage，再读取实际manifest与空登录状态通过。修改仅涉及私有检查脚本，扩展及App代码均未改动；没有将检查脚本的初始化时序误报为产品缺陷。

最终检查退出0，用时6.43秒；检查前空闲内存点样本39%，不代表峰值占用。自有浏览器正常退出0，空配置目录已删除；日常配置未更改。私有恢复目录保留两次失败、最终回执、脚本及候选逐文件hash。此结果仅证明候选加载和后台API可读，不证明完整App、真实网站、账号或物理设备操作通过。实际AWS加解密及模型调用均为0。

## 主体与剩余边界

Google Sheets当前可见账号控件仍是本地化显示名/邮箱、以authuser索引的链接和不透明头像URL，尚不足以核实稳定账号主体；没有将内部编码应用数据或账号内部接口当作主体证明，没有配置猜测的生产probe。

仍需在候选App/实际项目插件中完成两个任务、各一次原始下载、主机完整读取/统计、生成文件、历史双文件下载及真实来源/hash核对；还需任务标签页、人工接管/断连、原页输入/焦点和物理操作证据。真实账号保存/重建/撤销/切换、稳定主体、生产运行身份与维护窗口绑定保持未完成。

用户已单独批准的测试KMS仅创建1把并启用，随后明确批准CloudShell固定包验收：11次以内加解密尝试/3次状态检查，新增调用/传输预算0.01美元。已打开us-east-2 CloudShell，但当次AWS账户验证阻止环境创建；包未上传、终端命令0、真实加解密0，该次CloudShell尝试未调用模型。后续另有上述1次真实模型SDK连通检查，不改写CloudShell原始记录。详见[当次尝试](evidence/browser-vault-cloudshell-attempt-20261118.json)；不重复请求已取得的运行授权，未上线。
