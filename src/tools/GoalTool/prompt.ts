export const CREATE_GOAL_DESCRIPTION = `Create a new goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks. The goal tracks autonomous task pursuit across multiple turns with token budget tracking. Set token_budget only when an explicit token budget is requested. Fails if a goal already exists for this thread.`

export const CREATE_GOAL_PROMPT = `Use create_goal when the user explicitly asks you to pursue a long-running objective autonomously. The goal system provides:
- Persistent tracking of the objective across turns
- Token budget monitoring and accounting
- Auto-continuation prompts that guide you back to the objective
- Completion auditing to ensure the objective is actually achieved

Only create a goal when explicitly requested. Do not create goals for ordinary single-turn tasks.`

export const GET_GOAL_DESCRIPTION = `Get the current goal for this thread, including status, budgets, token and elapsed-time usage, and remaining token budget.`

export const GET_GOAL_PROMPT = `Use get_goal to check the current goal status, token usage, and remaining budget. Call this when you need to know how much budget remains or what the current objective is.`

export const UPDATE_GOAL_DESCRIPTION = `Update the existing goal. Use this tool only to mark the goal achieved (status "complete"). You cannot use this tool to pause, resume, or budget-limit a goal; those status changes are controlled by the user or system. When marking a budgeted goal achieved, report the final token usage from the tool result to the user.`

export const UPDATE_GOAL_PROMPT = `Use update_goal only to mark the existing goal as complete. The model can only set status to "complete". Do NOT:
- Mark a goal complete merely because the budget is nearly exhausted
- Mark a goal complete because you are stopping work
- Use this to pause or resume a goal (those are user-controlled)

Before marking complete, perform a thorough completion audit against the objective's requirements.`
