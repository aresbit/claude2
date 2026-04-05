import { registerBundledSkill } from '../bundledSkills.js'
import type { ToolUseContext } from '../../Tool.js'

const TOOL_ADD_GUIDE = `# Claude Tool Add Skill

Comprehensive guide for adding new built-in tools to Claude Code CLI.

## When to Use This Skill

Use this skill when you need to:
1. Create a new built-in tool for Claude Code
2. Understand the tool architecture and implementation patterns
3. Follow step-by-step instructions for tool development
4. Reference existing tool examples and best practices

## Tool Architecture Overview

Claude Code tools are defined in \`src/tools/\` directory. Each tool is a directory containing:
- \`ToolNameTool.ts\` - Main tool definition
- Optionally \`UI.tsx\` for custom rendering
- Optionally \`prompt.ts\` for tool-specific prompts

Tools are registered in \`src/tools.ts\` and become available via the tool system.

## Step-by-Step Tool Creation

### 1. Create Tool Directory

Create a new directory under \`src/tools/\` with your tool name (PascalCase + "Tool" suffix).
Example: \`src/tools/MyNewToolTool/\`

### 2. Define Tool Interface

Create \`MyNewToolTool.ts\` with the following structure:

\`\`\`typescript
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { AssistantMessage } from '../../types/message.js'
import type { ToolCallProgress } from '../../Tool.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    // Define your input parameters here
    param1: z.string().describe('Description of param1'),
    param2: z.number().optional().describe('Description of param2'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    message: z.string().describe('Status message'),
    // Add additional output fields as needed
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const MyNewToolTool = buildTool({
  name: 'mynewtool',
  searchHint: 'brief description for search',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Clear description of what this tool does'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false // Set to true if tool can run concurrently
  },
  isReadOnly() {
    return false // Set to true if tool doesn't modify state
  },
  async call(input, context, canUseTool, parentMessage, onProgress) {
    // Implement tool logic here
    // You can use other tools via canUseTool()
    // Report progress via onProgress if needed

    return {
      success: true,
      message: 'Operation completed successfully',
    }
  },
})
\`\`\`

### 3. Add Tool Registration

Edit \`src/tools.ts\` to import and register your tool:

1. Add import statement near other imports:
   \`\`\`typescript
   import { MyNewToolTool } from './tools/MyNewToolTool/MyNewToolTool.js'
   \`\`\`

2. Add tool to \`getAllBaseTools()\` function array:
   \`\`\`typescript
   export function getAllBaseTools(): Tools {
     return [
       // ... existing tools
       MyNewToolTool,
       // ... more tools
     ]
   }
   \`\`\`

### 4. Implement Tool Logic

The \`call()\` method is where your tool's functionality lives. Key considerations:

- **Permissions**: Check if your tool needs special permissions
- **Progress Reporting**: Use \`onProgress\` for long-running operations
- **Error Handling**: Return meaningful error messages
- **Tool Composition**: Use \`canUseTool\` to call other tools if needed

### 5. Add Custom UI (Optional)

If your tool needs custom rendering in the terminal, create \`UI.tsx\`:

\`\`\`tsx
import React from 'react'
import type { ToolResult } from '../../Tool.js'
import type { Output } from './MyNewToolTool.js'

export function renderToolResultMessage(result: ToolResult<Output>) {
  // Custom rendering logic
  return <Text>Custom result display</Text>
}
\`\`\`

## Best Practices

### Naming Conventions
- Tool directory: \`PascalCaseTool\` (e.g., \`MyNewToolTool\`)
- Tool name: \`lowercase-kebab-case\` (e.g., \`mynewtool\`)
- File naming: Match tool name (e.g., \`MyNewToolTool.ts\`)

### Input/Output Design
- Use Zod schemas for validation
- Provide clear descriptions for each parameter
- Design output that's useful for both humans and other tools

### Security Considerations
- Validate all inputs
- Sanitize file paths and commands
- Respect permission system

### Performance
- Keep \`maxResultSizeChars\` appropriate for your output
- Implement \`isConcurrencySafe()\` correctly
- Use progress reporting for long operations

## Example Tools

Study these existing tools for reference:

1. **AutoresearchTool** - Simple tool with agent integration
2. **BashTool** - Complex tool with security considerations
3. **FileEditTool** - File manipulation with custom UI
4. **SkillTool** - Tool that invokes other skills

Each demonstrates different patterns and best practices.

## Testing Your Tool

1. **Build the project**: \`bun run build\`
2. **Run in dev mode**: \`bun run dev\`
3. **Test tool invocation**: Use the tool in conversation
4. **Verify permissions**: Test with different permission modes

## Common Pitfalls

1. **Missing import in tools.ts** - Tool won't appear
2. **Incorrect Zod schema** - Validation errors
3. **Not handling errors** - Unclear failure messages
4. **Ignoring concurrency safety** - Potential race conditions

## Next Steps

After creating your tool:
1. Test thoroughly
2. Document tool usage
3. Consider adding to tool presets if widely useful
4. Update CLAUDE.md if tool is significant addition

## Getting Help

If you encounter issues:
1. Review existing tool implementations
2. Check \`src/Tool.js\` for base tool interface
3. Examine error messages in dev mode
4. Refer to Claude Code documentation

Remember: Tools should be focused, secure, and follow the existing patterns for consistency.
`

export function registerClaudeToolAddSkill(): void {
  registerBundledSkill({
    name: 'claude-tool-add-skill',
    description: 'Comprehensive guide for adding new built-in tools to Claude Code CLI. Use when: (1) Creating a new tool for Claude Code, (2) Understanding tool architecture and implementation patterns, (3) Following step-by-step instructions for tool development, (4) Referencing existing tool examples and best practices.',
    aliases: ['tool-add', 'add-tool', 'create-tool'],
    argumentHint: '[topic] - Optional topic to focus on (e.g., "ui", "permissions", "testing")',
    userInvocable: true,
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit'],
    async getPromptForCommand(args: string, context: ToolUseContext) {
      let prompt = TOOL_ADD_GUIDE

      if (args.trim()) {
        const topic = args.trim().toLowerCase()
        prompt += `\n\n## Focus Topic: ${args.trim()}\n`

        if (topic.includes('ui') || topic.includes('render')) {
          prompt += `\n### Custom UI Development\n\nFor custom UI components, study:\n1. \`src/tools/FileEditTool/UI.tsx\` - Custom editor interface\n2. \`src/tools/BashTool/UI.tsx\` - Command output rendering\n3. \`src/ink/\` - Ink framework components\n\nKey patterns:\n- Use React components with Ink\n- Implement \`renderToolResultMessage\` function\n- Style with Ink's \`<Text>\` component\n- Handle different result states (success, error, progress)`
        }

        if (topic.includes('permission') || topic.includes('security')) {
          prompt += `\n### Permissions and Security\n\nSecurity considerations:\n1. Validate all user inputs\n2. Sanitize file paths and commands\n3. Respect the permission system\n4. Implement \`checkPermissions\` method if needed\n\nStudy \`src/tools/BashTool/\` for security patterns.`
        }

        if (topic.includes('test') || topic.includes('debug')) {
          prompt += `\n### Testing and Debugging\n\nTesting strategies:\n1. Manual testing in dev mode\n2. Build verification with \`bun run build\`\n3. Error handling testing\n4. Permission mode testing\n\nUse \`Read\` and \`Grep\` tools to examine existing tool tests.`
        }

        if (topic.includes('schema') || topic.includes('zod')) {
          prompt += `\n### Schema Design\n\nZod schema best practices:\n1. Use \`lazySchema()\` for circular references\n2. Provide clear \`.describe()\` messages\n3. Validate input ranges and formats\n4. Define optional vs required fields clearly\n\nSee \`src/utils/lazySchema.js\` for implementation.`
        }
      }

      return [{ type: 'text', text: prompt }]
    },
  })
}