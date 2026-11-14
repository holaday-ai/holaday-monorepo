成对记录 30 对，可对比 26 对（模型：qwen3.8-max）

| 类别 | 可对比对数 | legacy 成功 | unified 成功 |
|---|---|---|---|
| ai_web_app | 4 | 4/4（100%） | 3/4（75%） |
| ecommerce | 5 | 1/5（20%） | 3/5（60%） |
| form | 5 | 2/5（40%） | 4/5（80%） |
| login_wall | 4 | 3/4（75%） | 4/4（100%） |
| multipage | 3 | 1/3（33%） | 3/3（100%） |
| table | 5 | 4/5（80%） | 5/5（100%） |
| **合计** | 26 | 15/26（58%） | 22/26（85%） |

可对比任务的 token 合计：legacy 418930，unified 599592

| 任务 | 类别 | 模型 | legacy | unified | 是否计入 |
|---|---|---|---|---|---|
| be-01（paired-38max） | ecommerce | qwen3.8-max | ❌ browser · handoff:login | ❌ browser · handoff:login | 计入 |
| be-02（paired-38max） | ecommerce | qwen3.8-max | ❌ browser · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ✅ none · handoff:login | 计入 |
| be-03（paired-38max） | ecommerce | qwen3.8-max | ✅ none | ✅ none | 计入 |
| be-04（paired-38max） | ecommerce | qwen3.8-max | ❌ browser · handoff:login | ❌ browser · handoff:login | 计入 |
| be-05（paired-38max） | ecommerce | qwen3.8-max | ❌ browser · handoff:login | ✅ none | 计入 |
| be-06（paired-38max） | form | qwen3.8-max | ✅ none | ✅ none | 计入 |
| be-07（paired-38max） | form | qwen3.8-max | ❌ browser · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ❌ browser · 超过最大步数仍未完成，请把任务拆小一些再试。 | 计入 |
| be-08（paired-38max） | form | qwen3.8-max | ❌ browser · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ✅ none | 计入 |
| be-09（paired-38max） | form | qwen3.8-max | ✅ none | ✅ none | 计入 |
| be-10（paired-38max） | form | qwen3.8-max | ❌ browser · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ✅ none | 计入 |
| be-11（paired-38max） | table | qwen3.8-max | ❌ browser | ✅ none | 计入 |
| be-12（paired-38max） | table | qwen3.8-max | ✅ none | ✅ none | 计入 |
| be-13（paired-38max） | table | qwen3.8-max | ✅ none | ✅ none | 计入 |
| be-14（paired-38max） | table | qwen3.8-max | ✅ none | ✅ none | 计入 |
| be-15（paired-38max） | table | qwen3.8-max | ✅ none | ✅ none | 计入 |
| be-16（paired-38max） | multipage | qwen3.8-max | ✅ none | ❌ model_layer · 模型服务暂时不可用，请稍后重试。 | 不计入 |
| be-17（paired-38max） | multipage | qwen3.8-max | ✅ none | ✅ none | 计入 |
| be-18（paired-38max） | multipage | qwen3.8-max | ❌ browser · handoff:login | ✅ none | 计入 |
| be-19（paired-38max） | multipage | qwen3.8-max | ❌ browser · handoff:login | ✅ none | 计入 |
| be-20（paired-38max） | multipage | qwen3.8-max | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ✅ none | 不计入 |
| be-21（paired-38max） | login_wall | qwen3.8-max | ❌ browser · initial screenshot failed after 3 attemp | ✅ none · handoff:login | 计入 |
| be-22（paired-38max） | login_wall | qwen3.8-max | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ✅ none · handoff:permission | 不计入 |
| be-23（paired-38max） | login_wall | qwen3.8-max | ✅ none · handoff:other | ✅ none | 计入 |
| be-24（paired-38max） | login_wall | qwen3.8-max | ✅ none · handoff:login | ✅ none · handoff:login | 计入 |
| be-25（paired-38max） | login_wall | qwen3.8-max | ✅ none · handoff:login | ✅ none · handoff:login | 计入 |
| be-26（paired-38max） | ai_web_app | qwen3.8-max | ✅ none · handoff:other | ✅ none · handoff:captcha | 计入 |
| be-27（paired-38max） | ai_web_app | qwen3.8-max | ✅ none · handoff:login | ✅ none · handoff:login | 计入 |
| be-28（paired-38max） | ai_web_app | qwen3.8-max | ✅ none · handoff:login | ❌ browser · 无法完成任务：打开 doubao.com 后被重定向至安全拦截页（doubao- | 计入 |
| be-29（paired-38max） | ai_web_app | qwen3.8-max | ✅ none | ❌ model_layer · 模型服务暂时不可用，请稍后重试。 | 不计入 |
| be-30（paired-38max） | ai_web_app | qwen3.8-max | ✅ none · handoff:login | ✅ none | 计入 |
