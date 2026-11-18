# GitHub / Sheets 真实站点验收前置核对

本记录完成只读源文件比对、文件校验器准备及本机已安装扩展盘点。尚未运行候选App/项目插件的真实站点任务，不是账号、物理操作或上线验收通过。

机器摘要：[browser-real-site-preflight-20261118.json](evidence/browser-real-site-preflight-20261118.json)。精确测试表URL、源文件、用例提示词、预期摘要和校验器保存在既有私有恢复目录的 `release-readiness-20261118/real-site-preflight`，不公开账号或业务数据。

## 原始文件与预期统计

GitHub读取固定合并提交 `91ba3cd6b7b208231f60265a7bb805ae7a5af2cf` 的 `docs/reports/evidence/pr360-premerge-20261118.json`。网络连接器返回的7560字节与该Git对象逐字节一致，SHA256为 `159dc809f6ae1341317b1dd8e917c11fa4ad27f6808ebd336139f0f99b706be0`。

后续摘要CSV按批次列出8行：5个initialTestMeasurements、core_recheck、focused_unit、separate_sql。不同批次保留独立身份，不求重叠批次总数；首轮backend的4个失败、core批次的1个失败保留，后续51/51和独立SQL1/1不改写旧批次。源中未给出的files/pending复核字段留空。给实际任务的提示词只规定栏目及来源，不预填隐藏的数值答案。

Google Sheets元数据确认只有 `RawData` 一个工作表；API原生导出完整匹配100条序号1–100，amount为序号+0.25，合计5075.00。原生CSV是1000字节、100个CRLF且无末尾换行，SHA256为 `f0a91ea82ffde445b25c0cd413d3426f757ba2292aa16435d3ddab540cb86331`。最初本地模板是901字节、LF且有末尾换行，二者字节不同而数据一致。

实际插件验收必须分别记录下载事件/存储/历史下载的原始字节hash与解析后的数据，不用本地模板hash强行代替原始下载hash。API导出hash仅是前置参考，尚未宣称浏览器下载字节相同。最终汇总的data_rows与amount_sum必须来自该任务真实统计回执。

本地文件比对器的7个样例通过：GitHub及两种换行CSV共3个正例；修改JSON原始字节、把core批次伪报全绿、漏掉最后一条记录、错误汇总金额共4个反例均拒绝。它仅证明文件比对规则有效，不证明项目插件、账号或物理输入已验。

## 实际安装状态

安装文件元数据显示Google Chrome 157.0.8103.79；尚未将这个磁盘版本冒充运行实例版本。原生Chrome扩展管理页只读核对结果如下：

| 扩展 | 版本 / 状态 | 实际ID / 来源 |
| --- | --- | --- |
| HOLA DAY | 0.0.1，停用 | `pfcicombbnhpjmiopcaccngbidlkgfpl`，主工作树dist未打包安装 |
| HOLA DAY · Local QA | 0.0.3，启用 | `hjpkgiddhiolmmibeaeegpmmogjmalji`，20260925历史QA目录未打包安装 |
| 已冻结正式候选 | 0.0.5，未安装到此次核对的配置 | ZIP摘要仍为`311647dacb6a47c34c6c9a164301c4eab7af50d9836a85b640a697f905395185`；没有固定public key，未猜测安装ID |

本次另开扩展信息标签页，没有加载、重载、启停扩展或更改浏览器设置，没有复制日常profile。旧的已加载0.0.3不能当作当前0.0.5候选的实际运行证据。

Chrome官方从137起移除了正式品牌构建的`--load-extension`入口；既有Chromium147脚手架的启动方式不能直接当作Chrome157可用证明。后续使用官方支持的测试安装方式和独立配置，并记录实际加载ID/版本/来源，不更改日常配置以绕过验证。[Chrome官方说明](https://developer.chrome.com/blog/extension-news-june-2025)

## 主体与剩余边界

Google Sheets当前可见账号控件仍是本地化显示名/邮箱、以authuser索引的链接和不透明头像URL，尚不足以核实稳定账号主体；没有将内部编码应用数据或账号内部接口当作主体证明，没有配置猜测的生产probe。

仍需在候选App/实际项目插件中完成两个任务、各一次原始下载、主机完整读取/统计、生成文件、历史双文件下载及真实来源/hash核对；还需任务标签页、人工接管/断连、原页输入/焦点和物理操作证据。真实账号保存/重建/撤销/切换、稳定主体、生产运行身份与维护窗口绑定保持未完成。

用户已单独批准的测试KMS仅创建1把并启用。CloudShell的11次以内合成加解密尝试/3次状态检查申请仍待明确回复，当前真实加解密0、外部模型调用0；没有因此提前运行或上线。
