# MCP-FS 能力清单

> MCP-FS (Model Context Protocol Filesystem) 是本项目的内置 MCP 工具系统，支持加载任意符合 MCP 规范的服务器。
> 共集成 **42 个 MCP 服务器**、**273+ 个工具**。

## 快速使用

```bash
# 列出所有可用工具
mcpfs_discover regenerate=true

# 调用单个工具
mcpfs tool="server-name/tool_name" args={...}

# 读取某个工具的 TypeScript 接口文件（含参数定义）
mcpfs_read tool="server-name/tool_name"

# 执行自定义 TypeScript 代码（可组合多个工具调用）
mcpfs_exec
```

---

## 工具分类索引

| 分类 | 服务器 |
|------|--------|
| 🧰 开发工具 | claude-code, git, github, semgrep |
| 🎨 UI 组件 | 21st-dev-magic |
| 🗄️ 数据库 | postgres, sqlite, sqlite-Docs |
| 📄 文档/知识库 | deepwiki, mcp-deepwiki, qmd, rs-docs |
| 📚 文档抓取 | 3FS-Docs, freertos, git-rule, menhir-Docs, sqlite-Docs, ttt |
| 🔍 搜索 | exa, grep, fetch, alma-Fetch |
| 🌐 浏览器 | playwright, mobile-mcp |
| 📊 图表 | mcp-server-chart, vchart-mcp-server, mermaid, mindmap |
| 🧠 推理 | sequential-thinking, sequentialthinking |
| ⏰ 时间 | time-mcp |
| 🗺️ 地图 | amap-maps |
| 💹 金融 | investor |
| 📈 股票/市场 | tung-shing |
| 💰 Web3 | web3-research-mcp |
| 🧮 计算 | WolframAlphaServer |
| 🎓 学术 | arxiv-mcp-server, leetcode |
| 🎬 媒体 | youtube-transcript |
| 👨‍💻 编码 | git-rule, filesystem |
| 📋 任务管理 | taskmaster |
| 📦 包/文档 | rs-docs |
| 🔬 代码搜索 | grep |
| 🏗️ 项目管理 | github |
| 📖 阅读 | yysread |
| 🧪 安全 | semgrep |

---

## 1. `21st-dev-magic` — UI 组件生成 (4 tools)

> 通过 21st.dev 生成高质量 React UI 组件

| 工具 | 功能 |
|------|------|
| `21st_magic_component_builder` | 根据用户需求生成 UI 组件代码（按钮、表单、弹窗、表格等） |
| `logo_search` | 搜索公司 logo，支持 JSX/TSX/SVG 格式 |
| `21st_magic_component_inspiration` | 浏览 21st.dev 上的组件获取灵感（不生成代码） |
| `21st_magic_component_refiner` | 重新设计/改进现有 UI 组件 |

## 2. `3FS-Docs` — 3FS 文档 (4 tools)

> DeepSeek 3FS 分布式文件系统文档

| 工具 | 功能 |
|------|------|
| `fetch_3FS_documentation` | 获取 3FS 完整文档 |
| `search_3FS_documentation` | 语义搜索 3FS 文档 |
| `search_3FS_code` | 搜索 3FS 源代码（GitHub API） |
| `fetch_generic_url_content` | 抓取任意 URL 内容 |

## 3. `alma-Context7` — Context7 文档查询 (2 tools)

> 查询任意编程库/框架的最新文档和代码示例

| 工具 | 功能 |
|------|------|
| `resolve-library-id` | 根据包名解析 Context7 库 ID |
| `query-docs` | 查询指定库的文档和代码示例 |

## 4. `alma-Fetch` — 通用网页抓取 (1 tool)

> 获取 URL 内容并提取为 Markdown

| 工具 | 功能 |
|------|------|
| `fetch` | 获取 URL 内容并提取为 Markdown |

## 5. `amap-maps` — 高德地图 (12 tools)

> 高德地图 API，支持地理编码、路径规划、搜索等服务

| 工具 | 功能 |
|------|------|
| `maps_regeocode` | 经纬度 → 行政区划地址 |
| `maps_geo` | 结构化地址 → 经纬度坐标 |
| `maps_ip_location` | IP 定位 |
| `maps_weather` | 查询指定城市天气 |
| `maps_search_detail` | POI 详细信息查询 |
| `maps_bicycling` | 骑行路径规划（最长 500km） |
| `maps_direction_walking` | 步行路径规划（最长 100km） |
| `maps_direction_driving` | 驾车路径规划 |
| `maps_direction_transit_integrated` | 公交路径规划（支持跨城） |
| `maps_distance` | 距离测量（驾车/步行/球面） |
| `maps_text_search` | 关键词 POI 搜索 |
| `maps_around_search` | 周边 POI 搜索 |

## 6. `arxiv-mcp-server` — arXiv 学术论文 (10 tools)

> 搜索、下载、阅读 arXiv 论文，支持语义搜索和引用图谱

| 工具 | 功能 |
|------|------|
| `search_papers` | 高级搜索 arXiv 论文 |
| `download_paper` | 下载论文全文 |
| `list_papers` | 列出已下载的论文 |
| `read_paper` | 阅读已下载的论文全文 |
| `get_abstract` | 获取论文摘要和元数据 |
| `semantic_search` | 在已下载论文中做语义搜索 |
| `reindex` | 重建本地语义索引 |
| `citation_graph` | 查询论文引用关系（Semantic Scholar） |
| `watch_topic` | 设置研究主题监控 |
| `check_alerts` | 检查监控主题的新论文 |

## 7. `claude-code` — Claude Code 内核 (15 tools)

> Claude Code 自身工具集，这也是本项目正在使用的工具

| 工具 | 功能 |
|------|------|
| `read` | 读取文件内容 |
| `write` | 写入文件 |
| `edit` | 精确字符串替换编辑 |
| `multi_edit` | 单个文件的多处编辑 |
| `directory_tree` | 递归目录树 |
| `grep` | 正则搜索文件内容 |
| `content_replace` | 跨文件模式替换 |
| `grep_ast` | AST 感知的代码搜索 |
| `notebook_read` | 读取 Jupyter Notebook |
| `notebook_edit` | 编辑 Jupyter Notebook |
| `run_command` | 执行 shell 命令 |
| `todo_read` | 读取任务列表 |
| `todo_write` | 写入任务列表 |
| `think` | 思考推理 |
| `batch` | 批量并行执行多个工具 |

## 8. `deepwiki` — GitHub 仓库百科 (3 tools)

> 从 deepwiki.com 获取 GitHub 仓库文档

| 工具 | 功能 |
|------|------|
| `read_wiki_structure` | 获取仓库文档主题列表 |
| `read_wiki_contents` | 查看仓库文档内容 |
| `ask_question` | 基于仓库文档问答 |

## 9. `exa` — Exa 网络搜索 (1 tool)

| 工具 | 功能 |
|------|------|
| `exa_search` | 使用 Exa API 搜索网络 |

## 10. `fetch` — 通用网页抓取 (1 tool)

| 工具 | 功能 |
|------|------|
| `fetch` | 获取 URL 内容并提取为 Markdown |

## 11. `filesystem` — 文件系统 (14 tools)

> 安全的文件读写操作，限制在允许目录范围内

| 工具 | 功能 |
|------|------|
| `read_file` | 读取文件（已弃用，使用 read_text_file） |
| `read_text_file` | 读取文本文件 |
| `read_media_file` | 读取图片/音频文件（base64） |
| `read_multiple_files` | 同时读取多个文件 |
| `write_file` | 写入文件 |
| `edit_file` | 基于行的编辑 |
| `create_directory` | 创建目录 |
| `list_directory` | 列出目录内容 |
| `list_directory_with_sizes` | 列出目录内容（含大小） |
| `directory_tree` | 递归目录树（JSON） |
| `move_file` | 移动/重命名文件 |
| `search_files` | 搜索文件 |
| `get_file_info` | 获取文件元数据 |
| `list_allowed_directories` | 列出允许访问的目录 |

## 12. `freertos` — FreeRTOS 文档 (4 tools)

> FreeRTOS 实时操作系统文档

| 工具 | 功能 |
|------|------|
| `fetch_FreeRTOS_documentation` | 获取 FreeRTOS 完整文档 |
| `search_FreeRTOS_documentation` | 语义搜索 FreeRTOS 文档 |
| `search_FreeRTOS_code` | 搜索 FreeRTOS 源代码 |
| `fetch_generic_url_content` | 抓取任意 URL 内容 |

## 13. `git` — Git 操作 (12 tools)

> 完整的 Git 操作工具集

| 工具 | 功能 |
|------|------|
| `git_status` | 查看工作区状态 |
| `git_diff_unstaged` | 查看未暂存的变更 |
| `git_diff_staged` | 查看已暂存的变更 |
| `git_diff` | 查看分支/提交间差异 |
| `git_commit` | 提交变更 |
| `git_add` | 暂存文件 |
| `git_reset` | 取消暂存 |
| `git_log` | 查看提交日志 |
| `git_create_branch` | 创建分支 |
| `git_checkout` | 切换分支 |
| `git_show` | 查看提交内容 |
| `git_branch` | 列出分支 |

## 14. `git-rule` — Git Flight Rules 文档 (4 tools)

> Git 飞行规则文档

| 工具 | 功能 |
|------|------|
| `fetch_git_flight_rules_docs` | 获取 Git 飞行规则完整文档 |
| `search_git_flight_rules_docs` | 语义搜索 |
| `search_git_flight_rules_code` | 搜索代码示例 |
| `fetch_generic_url_content` | 抓取任意 URL 内容 |

## 15. `github` — GitHub API (26 tools)

> 完整的 GitHub 操作

| 工具 | 功能 |
|------|------|
| `create_or_update_file` | 创建/更新仓库文件 |
| `search_repositories` | 搜索仓库 |
| `create_repository` | 创建新仓库 |
| `get_file_contents` | 获取文件内容 |
| `push_files` | 批量推送文件 |
| `create_issue` | 创建 Issue |
| `create_pull_request` | 创建 PR |
| `fork_repository` | Fork 仓库 |
| `create_branch` | 创建分支 |
| `list_commits` | 列出提交记录 |
| `list_issues` | 列出 Issues |
| `update_issue` | 更新 Issue |
| `add_issue_comment` | 添加评论 |
| `search_code` | 搜索代码 |
| `search_issues` | 搜索 Issues/PRs |
| `search_users` | 搜索用户 |
| `get_issue` | 获取 Issue 详情 |
| `get_pull_request` | 获取 PR 详情 |
| `list_pull_requests` | 列出 PRs |
| `create_pull_request_review` | 创建 PR Review |
| `merge_pull_request` | 合并 PR |
| `get_pull_request_files` | 获取 PR 变更文件 |
| `get_pull_request_status` | 获取 PR 状态检查 |
| `update_pull_request_branch` | 更新 PR 分支 |
| `get_pull_request_comments` | 获取 PR 评论 |
| `get_pull_request_reviews` | 获取 PR Reviews |

## 16. `grep` — GitHub 代码搜索 (1 tool)

| 工具 | 功能 |
|------|------|
| `searchGitHub` | 从 GitHub 百万开源仓库中搜索代码示例 |

## 17. `investor` — 金融/投资分析 (17 tools)

> 全面的金融数据，包括股票、期权、新闻、情绪指标等

| 工具 | 功能 |
|------|------|
| `get_ticker_data` | 获取股票综合报告 |
| `get_price_history` | 获取历史价格数据 |
| `get_financial_statements` | 获取财务报表 |
| `get_earnings_history` | 获取盈利历史 |
| `get_ticker_news_tool` | 获取 Yahoo Finance 新闻 |
| `super_option_tool` | 期权数据分析和 Greeks |
| `get_top25_holders` | 获取 Top 25 机构持仓 |
| `get_insider_trades` | 获取内幕交易 |
| `get_overall_sentiment_tool` | 市场情绪指标（恐惧贪婪指数、RSI 等） |
| `get_historical_fng_tool` | 历史恐惧贪婪指数 |
| `analyze_fng_trend` | 分析恐惧贪婪指数趋势 |
| `calculate` | 数学计算（支持 numpy） |
| `get_current_time` | 获取当前时间 |
| `get_fred_series` | 获取 FRED 经济数据系列 |
| `search_fred_series` | 搜索 FRED 数据系列 |
| `cnbc_news_feed` | CNBC 财经新闻 |
| `social_media_feed` | Reddit 热门股票讨论 |

## 18. `leetcode` — LeetCode 刷题 (7 tools)

| 工具 | 功能 |
|------|------|
| `get-daily-challenge` | 获取每日一题 |
| `get-problem` | 获取题目详情 |
| `search-problems` | 搜索题目 |
| `get-user-profile` | 获取用户信息 |
| `get-user-submissions` | 获取用户提交记录 |
| `get-contest-details` | 获取竞赛详情 |
| `get-user-contest-ranking` | 获取用户竞赛排名 |

## 19. `mcp-deepwiki` — DeepWiki 获取 (1 tool)

| 工具 | 功能 |
|------|------|
| `deepwiki_fetch` | 获取 deepwiki.com 仓库文档 |

## 20. `mcp-server-chart` — 图表生成 (25 tools)

> 生成各种类型的图表（基于 VChart）

| 工具 | 功能 |
|------|------|
| `generate_area_chart` | 面积图 |
| `generate_bar_chart` | 水平柱状图 |
| `generate_boxplot_chart` | 箱线图 |
| `generate_column_chart` | 柱状图 |
| `generate_district_map` | 区域分布地图 |
| `generate_dual_axes_chart` | 双轴组合图 |
| `generate_fishbone_diagram` | 鱼骨图（因果分析） |
| `generate_flow_diagram` | 流程图 |
| `generate_funnel_chart` | 漏斗图 |
| `generate_histogram_chart` | 直方图 |
| `generate_line_chart` | 折线图 |
| `generate_liquid_chart` | 液态图（百分比） |
| `generate_mind_map` | 思维导图 |
| `generate_network_graph` | 网络关系图 |
| `generate_organization_chart` | 组织架构图 |
| `generate_path_map` | 路线图 |
| `generate_pie_chart` | 饼图 |
| `generate_pin_map` | 点标记地图 |
| `generate_radar_chart` | 雷达图 |
| `generate_sankey_chart` | 桑基图（流量） |
| `generate_scatter_chart` | 散点图 |
| `generate_treemap_chart` | 矩形树图 |
| `generate_venn_chart` | 韦恩图 |
| `generate_violin_chart` | 小提琴图 |
| `generate_word_cloud_chart` | 词云图 |

## 21. `menhir-Docs` — Menhir 文档 (4 tools)

> Menhir OCaml 解析器生成器文档

| 工具 | 功能 |
|------|------|
| `fetch_menhir_documentation` | 获取完整文档 |
| `search_menhir_documentation` | 语义搜索 |
| `search_menhir_code` | 搜索代码 |
| `fetch_generic_url_content` | 抓取任意 URL |

## 22. `mermaid` — Mermaid 图表 (1 tool)

| 工具 | 功能 |
|------|------|
| `generate_mermaid_diagram` | 生成 Mermaid 格式图表（流程图、时序图、类图等） |

## 23. `mindmap` — 思维导图 (1 tool)

| 工具 | 功能 |
|------|------|
| `convert_markdown_to_mindmap` | 将 Markdown 内容转换为思维导图 |

## 24. `mobile-mcp` — 移动设备控制 (19 tools)

> 通过 ADT 控制 Android 设备

| 工具 | 功能 |
|------|------|
| `mobile_list_available_devices` | 列出可用设备 |
| `mobile_list_apps` | 列出已安装应用 |
| `mobile_launch_app` | 启动应用 |
| `mobile_terminate_app` | 关闭应用 |
| `mobile_install_app` | 安装应用 |
| `mobile_uninstall_app` | 卸载应用 |
| `mobile_get_screen_size` | 获取屏幕尺寸 |
| `mobile_click_on_screen_at_coordinates` | 点击屏幕坐标 |
| `mobile_double_tap_on_screen` | 双击屏幕 |
| `mobile_long_press_on_screen_at_coordinates` | 长按屏幕 |
| `mobile_list_elements_on_screen` | 列出屏幕元素 |
| `mobile_press_button` | 按键 |
| `mobile_open_url` | 打开 URL |
| `mobile_swipe_on_screen` | 滑动屏幕 |
| `mobile_type_keys` | 输入文本 |
| `mobile_save_screenshot` | 保存截图 |
| `mobile_take_screenshot` | 截图 |
| `mobile_set_orientation` | 设置屏幕方向 |
| `mobile_get_orientation` | 获取屏幕方向 |

## 25. `playwright` — 浏览器自动化 (22 tools)

> 完整的基于 Playwright 的浏览器控制

| 工具 | 功能 |
|------|------|
| `browser_navigate` | 导航到 URL |
| `browser_snapshot` | 获取页面无障碍快照 |
| `browser_take_screenshot` | 截图 |
| `browser_click` | 点击元素 |
| `browser_fill_form` | 填写表单 |
| `browser_type` | 输入文本 |
| `browser_select_option` | 选择下拉选项 |
| `browser_hover` | 悬停元素 |
| `browser_drag` | 拖放 |
| `browser_press_key` | 按键 |
| `browser_close` | 关闭页面 |
| `browser_resize` | 调整窗口大小 |
| `browser_navigate_back` | 返回上一页 |
| `browser_tabs` | 管理标签页 |
| `browser_console_messages` | 获取控制台消息 |
| `browser_network_requests` | 获取网络请求 |
| `browser_evaluate` | 执行 JavaScript |
| `browser_run_code` | 运行 Playwright 代码片段 |
| `browser_file_upload` | 文件上传 |
| `browser_handle_dialog` | 处理对话框 |
| `browser_wait_for` | 等待条件 |
| `browser_install` | 安装浏览器 |

## 26. `postgres` — PostgreSQL 查询 (1 tool)

| 工具 | 功能 |
|------|------|
| `query` | 执行只读 SQL 查询 |

## 27. `qmd` — QMD 知识库 (6 tools)

> 本地知识库全文搜索和向量检索

| 工具 | 功能 |
|------|------|
| `search` | BM25 关键词全文搜索 |
| `vsearch` | 向量语义相似搜索 |
| `query` | BM25 + 向量 + LLM 重排序最高质量搜索 |
| `get` | 获取文档内容 |
| `multi_get` | 批量获取文档 |
| `status` | 查看索引状态 |

## 28. `rs-docs` — Rust 文档 (4 tools)

| 工具 | 功能 |
|------|------|
| `docs_rs_search_crates` | 搜索 Rust crate |
| `docs_rs_readme` | 获取 crate README |
| `docs_rs_get_item` | 获取 crate 内特定项的文档 |
| `docs_rs_search_in_crate` | 在 crate 内搜索类型/方法 |

## 29. `semgrep` — Semgrep 代码扫描 (1 tool)

| 工具 | 功能 |
|------|------|
| `deprecation_notice` | 弃用通知工具 |

## 30. `sequential-thinking` — 思维链推理 (1 tool)

| 工具 | 功能 |
|------|------|
| `sequentialthinking` | 通过有序思维步骤进行动态反射式问题求解 |

## 31. `sequentialthinking` — 思维链推理增强版 (3 tools)

| 工具 | 功能 |
|------|------|
| `sequentialthinking_tools` | 记录推理步骤，可选推荐工具 |
| `get_thinking_history` | 查看历史推理记录 |
| `clear_thinking_history` | 清除推理历史 |

## 32. `sqlite` — SQLite 数据库 (2 tools)

| 工具 | 功能 |
|------|------|
| `executeQuery` | 执行读写 SQL 查询 |
| `executeSafeQuery` | 执行只读 SQL 查询 |

## 33. `sqlite-Docs` — SQLite 文档 (4 tools)

| 工具 | 功能 |
|------|------|
| `fetch_sqlite_documentation` | 获取 SQLite 完整文档 |
| `search_sqlite_documentation` | 语义搜索 |
| `search_sqlite_code` | 搜索 SQLite 源代码 |
| `fetch_generic_url_content` | 抓取任意 URL |

## 34. `taskmaster` — 任务管理 (7 tools)

> 基于 PRD 的结构化任务分解和管理

| 工具 | 功能 |
|------|------|
| `get_tasks` | 获取所有任务 |
| `next_task` | 查找下一个待办任务 |
| `get_task` | 获取任务详情 |
| `set_task_status` | 设置任务状态 |
| `update_subtask` | 追加子任务信息 |
| `parse_prd` | 从 PRD 文档解析生成任务 |
| `expand_task` | 将任务拆分为子任务 |

## 35. `time-mcp` — 时间工具 (6 tools)

| 工具 | 功能 |
|------|------|
| `current_time` | 获取当前日期时间 |
| `relative_time` | 获取相对时间 |
| `days_in_month` | 获取月份天数 |
| `get_timestamp` | 获取时间戳 |
| `convert_time` | 时区转换 |
| `get_week_year` | 获取周数和 ISO 周 |

## 36. `ttt` — TTT 文档 (4 tools)

> Jserv TTT 项目文档

| 工具 | 功能 |
|------|------|
| `fetch_ttt_documentation` | 获取完整文档 |
| `search_ttt_documentation` | 语义搜索 |
| `search_ttt_code` | 搜索代码 |
| `fetch_generic_url_content` | 抓取任意 URL |

## 37. `tung-shing` — 通胜黄历 (1 tool)

| 工具 | 功能 |
|------|------|
| `get-tung-shing` | 获取通胜黄历（公历、农历、宜忌、吉凶、冲煞） |

## 38. `vchart-mcp-server` — VChart 图表 (10 tools)

> 基于 VChart 的图表生成

| 工具 | 功能 |
|------|------|
| `generate_cartesian_chart` | 笛卡尔图表（折线/面积/柱状/瀑布图） |
| `generate_polar_chart` | 极坐标图表（玫瑰/雷达/饼图） |
| `generate_hierarchical_chart` | 层级图表（旭日/矩形树图） |
| `generate_progress_chart` | 进度图表 |
| `generate_wordcloud_venn` | 词云/韦恩图 |
| `generate_scatter_chart` | 散点图 |
| `generate_range_column_chart` | 范围柱状图 |
| `generate_dual_axis_chart` | 双轴组合图 |
| `generate_sankey_chart` | 桑基图 |
| `generate_heatmap_chart` | 热力图 |

## 39. `web3-research-mcp` — Web3 研究 (9 tools)

> 区块链和 Web3 领域研究工具

| 工具 | 功能 |
|------|------|
| `search` | 搜索 Web3 相关信息 |
| `create-research-plan` | 创建研究计划 |
| `research-with-keywords` | 关键词研究 |
| `update-status` | 更新状态 |
| `fetch-content` | 获取内容 |
| `search-source` | 搜索来源 |
| `list-resources` | 列出资源 |
| `research-source` | 研究特定来源 |
| `research-token` | 研究代币/Token |

## 40. `WolframAlphaServer` — WolframAlpha 计算 (1 tool)

| 工具 | 功能 |
|------|------|
| `query_wolfram` | 自然语言查询 WolframAlpha（数学/科学/事实计算） |

## 41. `youtube-transcript` — YouTube 字幕 (1 tool)

| 工具 | 功能 |
|------|------|
| `get_transcript` | 提取 YouTube 视频字幕 |

## 42. `yysread` — URL 阅读 (1 tool)

| 工具 | 功能 |
|------|------|
| `read_url_content_as_markdown` | 将 URL 内容读取为 Markdown |

---

## 附录：MCP-FS 工作原理

MCP-FS 通过桥接层 (`bridge.mjs`) 使用 JSON-RPC 2.0 协议与 MCP 服务器通信：

```
Claude Code → mcpfs 工具 → bridge.mjs (JSON-RPC) → MCP Server (stdio/http/sse)
```

- 所有工具定义存储在 `~/.claude/mcp-fs/servers/<server-name>/manifest.json`
- 重新扫描导入：`bun run scripts/chatwise-to-mcpfs.ts`
- 重新生成 .ts 包装器：在 Claude Code 中使用 `mcpfs_discover regenerate=true`
