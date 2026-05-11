# DeepSeek 前缀优化开关使用指南

## 概述

DeepSeek API 提供**自动字节前缀缓存**（Automatic Byte-Prefix Caching）机制，缓存命中时输入 token 成本仅为未命中时的约 **10%**。然而，该缓存仅在连续请求的**精确字节前缀**匹配时才会触发。常规的 Agent 循环会不断重排、注入时间戳或改写消息内容，导致缓存命中率极低（通常 <20%）。

本特性通过**三区上下文分区**（Three-Region Context Partition）策略，从结构上保证请求间的字节前缀一致性，将缓存命中率提升至 **80%+**。

## 工作原理

```
┌─────────────────────────────────────────────┐
│  发送给 DeepSeek API 的请求体                │
│                                              │
│  ┌─ 不可变前缀 (Immutable Prefix) ──────────┐ │
│  │ 系统提示词 (system prompt)               │ │
│  │ 工具定义 (tool schemas)                  │ │
│  │ 始终排在最前，永不被重写                  │ │
│  └──────────────────────────────────────────┘ │
│  ┌─ 只追加日志 (Append-Only Log) ───────────┐ │
│  │ user₁ → assistant₁ → tool_results₁       │ │
│  │ user₂ → assistant₂ → tool_results₂       │ │
│  │ 单调增长，只追加不修改                    │ │
│  └──────────────────────────────────────────┘ │
│  ┌─ 当前回合 (Current Turn) ────────────────┐ │
│  │ 最新的用户消息 + 新内容                   │ │
│  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘

  ┌─ 易失暂存 (Volatile Scratch) ─────────────┐
  │ 推理轨迹、临时计划状态（仅用于TUI展示）     │
  │ 永远不发送给 API                            │
  └──────────────────────────────────────────────┘
```

### 三个区域的职责

| 区域 | 内容 | 生命周期 | 是否随请求发送 |
|------|------|----------|:--------------:|
| **不可变前缀** | 系统提示词 + 工具定义 | 整个会话内不变（/compact 或工具变动时重建） | 是 |
| **只追加日志** | 对话历史 | 单调增长，仅在 /compact 时整段替换 | 是 |
| **易失暂存** | 推理轨迹、临时笔记 | 每回合重置 | 否 |

### 为什么这样设计

DeepSeek 的服务端缓存按请求体的**精确字节前缀**匹配。不可变前缀始终排在消息数组最前面，只追加日志从不修改已有条目——因此第 N 回合的前 N-1 条消息与第 N-1 回合完全一致，缓存自然命中。

## 启用条件

优化器在以下条件**同时满足**时自动启用：

1. `ANTHROPIC_BASE_URL` 指向已知的 DeepSeek 端点（`api.deepseek.com`、`api.deepseek.ai` 或包含 `deepseek-api.` 的域名），或 `ANTHROPIC_MODEL` 以 `deepseek` 开头
2. `CLAUDE_CODE_DISABLE_DEEPSEEK_PREFIX_OPT` **未设置**

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLAUDE_CODE_DISABLE_DEEPSEEK_PREFIX_OPT` | 未设置 | 设为 `1` / `true` / `yes` / `on` 禁用前缀优化 |
| `ANTHROPIC_BASE_URL` | (已有) | 主要检测信号，hostname 匹配 DeepSeek 域名时触发 |
| `ANTHROPIC_MODEL` | (已有) | 备用检测信号，模型名以 `deepseek` 开头时触发 |

## 使用方式

### 自动模式（推荐）

无需任何额外配置。当你已经通过 `ANTHROPIC_BASE_URL` 指向 DeepSeek API 时，优化器自动生效：

```bash
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_MODEL=deepseek-v4-pro
# 优化器自动启用，无需额外操作
bun run dev
```

### 验证是否启用

启动后在对话中观察以下信号：

1. **系统日志**（stderr 输出）：启动时出现 `[DeepSeekOpt] initialized — prefix fingerprint: xxxxx` 表示优化器已加载
2. **缓存命中率**：每个 API 请求结束后，日志中会记录缓存命中指标

### 手动禁用

如果你使用 DeepSeek 但出于调试目的想暂时关闭优化：

```bash
export CLAUDE_CODE_DISABLE_DEEPSEEK_PREFIX_OPT=1
bun run dev
```

关闭后，系统恢复为标准 Anthropic 行为（发送 `cache_control` 块、不强制消息排序）。

### 自定义代理

如果你使用 LiteLLM 等代理将请求转发到 DeepSeek（模型中转），可以通过设置模型名来触发检测：

```bash
# 代理地址，hostname 不包含 deepseek → 不会被自动检测
export ANTHROPIC_BASE_URL=https://my-proxy.example.com/v1

# 但模型名以 deepseek 开头 → 触发备用检测
export ANTHROPIC_MODEL=deepseek-v4-pro

# 优化器照样生效
bun run dev
```

## 缓存效果对比

| 场景 | 无优化 | 启用优化 |
|------|--------|----------|
| 缓存命中率 | <20% | ~80-90% |
| 输入 token 成本（每百万） | $0.139（全量） | ~$0.028（命中部分） |
| 100 回合会话输入成本 | ~$2.78 | ~$0.56 |
| 连续使用一个月 | ~$200+ | ~$50-80 |

*数据基于 DeepSeek V4 定价结构估算，实际效果取决于会话长度和消息模式。*

## 注意事项

1. **/compact 会临时打破缓存**：上下文折叠时会整体替换对话历史，导致下一回合缓存未命中。这是预期行为——牺牲一次缓存命中换取可用的上下文窗口，之后缓存立即恢复。

2. **工具变动会重建前缀**：MCP 工具连接/断开时会更新不可变前缀的哈希值，下一次请求产生一次缓存未命中。

3. **与 Anthropic API 无关**：此优化仅在连接到 DeepSeek API 时激活。连接到 `api.anthropic.com` 或其他 Anthropic 兼容端点时不受影响。

4. **与 CLAUDE_CODE_EXTRA_BODY 兼容**：自定义额外请求体参数不受影响，优化器仅控制消息结构和缓存标记。

## 架构参考

本实现参考了 [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) 项目的三区缓存架构：

- `ImmutablePrefix` — 不可变前缀的哈希与固定
- `AppendOnlyLog` — 只追加日志的约束保证
- `VolatileScratch` — 易失暂存区的分离策略

详见 [ARCHITECTURE.md](https://github.com/esengine/DeepSeek-Reasonix/blob/main/docs/ARCHITECTURE.md)

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/utils/model/providers.ts` | DeepSeek API 检测 + 开关逻辑 |
| `src/services/api/deepseekOptimizer.ts` | 三区上下文分区核心实现 |
| `src/services/api/claude.ts` | API 层集成点（去除 cache_control、记录缓存指标） |
