成对记录 21 对，可对比 3 对（模型：qwen3.7-plus）

| 类别 | 可对比对数 | legacy 成功 | unified 成功 |
|---|---|---|---|
| table | 3 | 3/3（100%） | 3/3（100%） |
| **合计** | 3 | 3/3（100%） | 3/3（100%） |

可对比任务的 token 合计：legacy 111824，unified 61537

| 任务 | 类别 | 模型 | legacy | unified | 是否计入 |
|---|---|---|---|---|---|
| be-01（full-paired） | ecommerce | qwen3-vl-235b-a22b-instruct | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ❌ model_layer · 模型服务暂时不可用，请稍后重试。 | 不计入 |
| be-02（full-paired） | ecommerce | qwen3-vl-235b-a22b-instruct | ✅ none · handoff:login | ❌ model_layer | 不计入 |
| be-03（full-paired） | ecommerce | qwen3-vl-235b-a22b-instruct | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ❌ model_layer | 不计入 |
| be-04（full-paired） | ecommerce | qwen3-vl-235b-a22b-instruct | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ❌ model_layer | 不计入 |
| be-05（full-paired） | ecommerce | qwen3-vl-235b-a22b-instruct | ❌ browser · initial screenshot failed after 3 attemp | ❌ model_layer · 模型服务暂时不可用，请稍后重试。 | 不计入 |
| be-06（full-paired） | form | qwen3-vl-235b-a22b-instruct | ❌ environment · harness: page.goto: net::ERR_TIMED_OUT a | ❌ model_layer · 模型服务暂时不可用，请稍后重试。 | 不计入 |
| be-07（full-paired） | form | qwen3-vl-235b-a22b-instruct | ❌ model_layer · 任务执行中遇到了问题，正在尝试其他方式完成。如果持续失败，请尝试换一种方式描述您 | ❌ model_layer · 模型服务暂时不可用，请稍后重试。 | 不计入 |
| be-08（full-paired） | form | qwen3.6-flash | ✅ none | ❌ model_layer · 模型服务暂时不可用，请稍后重试。 | 不计入 |
| be-09（full-paired） | form | qwen3.6-flash | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ❌ model_layer · 模型服务暂时不可用，请稍后重试。 | 不计入 |
| be-10（full-paired） | form | qwen3.6-flash | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ✅ none | 不计入 |
| be-11（full-paired） | table | qwen3.6-flash | ❌ model_layer · 任务执行中遇到了问题，正在尝试其他方式完成。如果持续失败，请尝试换一种方式描述您 | ❌ browser | 不计入 |
| be-12（full-paired） | table | qwen3.6-flash | ✅ none | ❌ model_layer · 模型服务暂时不可用，请稍后重试。 | 不计入 |
| be-13（full-paired） | table | qwen3.6-flash | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ✅ none | 不计入 |
| be-14（full-paired） | table | qwen3.6-flash | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ❌ browser | 不计入 |
| be-15（full-paired） | table | qwen3.6-flash | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ❌ model_layer | 不计入 |
| be-16（full-paired） | multipage | qwen3.6-flash | ✅ none | ❌ model_layer · 模型服务暂时不可用，请稍后重试。 | 不计入 |
| be-06（smoke-paired） | form | qwen3.7-plus | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ✅ none | 不计入 |
| be-10（smoke-paired） | form | qwen3.7-plus | ❌ model_layer · 模型响应超时，本次执行已停止；已完成动作不会自动重放。 | ✅ none | 不计入 |
| be-12（smoke-paired） | table | qwen3.7-plus | ✅ none | ✅ none | 计入 |
| be-14（smoke-paired） | table | qwen3.7-plus | ✅ none | ✅ none | 计入 |
| be-15（smoke-paired） | table | qwen3.7-plus | ✅ none | ✅ none | 计入 |
