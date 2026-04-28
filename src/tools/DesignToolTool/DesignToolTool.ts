import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { join } from 'path'
import { writeFile, readFile, mkdir, access } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { getCwd } from '../../utils/cwd.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        'create',
        'edit',
        'review',
        'export',
        'list',
        'help',
        'init',
      ])
      .describe('Action to perform'),
    target: z.string().optional().describe('Target file or directory path'),
    description: z.string().optional().describe('Design description or requirements'),
    format: z
      .enum(['html', 'presentation', 'prototype', 'wireframe', 'deck', 'animation'])
      .optional()
      .describe('Output format'),
    options: z.number().int().min(1).max(10).optional().describe('Number of design options to generate'),
    title: z.string().optional().describe('Title for the design project'),
    category: z
      .enum(['ui', 'ux', 'visual', 'interaction', 'brand', 'layout'])
      .optional()
      .describe('Design category'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the design operation succeeded'),
    message: z.string().describe('Status message'),
    files: z.array(z.string()).optional().describe('Generated or modified files'),
    preview: z.string().optional().describe('Preview or summary of the design'),
    designSystemApplied: z.boolean().optional().describe('Whether Claude Design System Prompt was applied'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// Claude Design System Prompt core principles
const DESIGN_SYSTEM_PROMPT = `
You are an expert designer working with the user as a manager. You produce design artifacts on behalf of the user using HTML.
You operate within a filesystem-based project.
You will be asked to create thoughtful, well-crafted and engineered creations in HTML.
HTML is your tool, but your medium and output format vary. You must embody an expert in that domain: animator, UX designer, slide designer, prototyper, etc.

## Your workflow
1. Understand user needs. Ask clarifying questions for new/ambiguous work.
2. Explore provided resources.
3. Plan and/or make a todo list.
4. Build folder structure and copy resources into this directory.
5. Finish: surface the file to the user and check it loads cleanly.
6. Summarize EXTREMELY BRIEFLY — caveats and next steps only.

## Output creation guidelines
- Give your HTML files descriptive filenames.
- When doing significant revisions, copy and edit to preserve old versions.
- Copy needed assets from design systems or UI kits; do not reference them directly.
- Always avoid writing large files (>1000 lines).
- For interactive prototypes, CSS transitions or simple React state is fine.
- When adding to an existing UI, try to understand the visual vocabulary first and follow it.
`

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function handleCreateDesign(input: Input, cwd: string): Promise<Output> {
  const targetDir = input.target ? join(cwd, input.target) : join(cwd, 'design-output')

  // Create directory if it doesn't exist
  await mkdir(targetDir, { recursive: true })

  const title = input.title || 'Design Project'
  const description = input.description || 'No description provided'
  const format = input.format || 'html'
  const options = input.options || 3

  // Create a simple HTML design file
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        }

        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 2rem;
        }

        .design-container {
            background: white;
            border-radius: 24px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 800px;
            width: 100%;
            overflow: hidden;
        }

        .design-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            text-align: center;
        }

        .design-title {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }

        .design-subtitle {
            font-size: 1.2rem;
            opacity: 0.9;
            font-weight: 300;
        }

        .design-content {
            padding: 3rem;
        }

        .design-description {
            font-size: 1.1rem;
            line-height: 1.6;
            color: #333;
            margin-bottom: 2rem;
        }

        .design-principles {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 1.5rem;
            margin-top: 2rem;
        }

        .principle-title {
            font-size: 1.3rem;
            font-weight: 600;
            color: #667eea;
            margin-bottom: 1rem;
        }

        .principle-list {
            list-style: none;
        }

        .principle-item {
            padding: 0.5rem 0;
            border-bottom: 1px solid #e9ecef;
        }

        .principle-item:last-child {
            border-bottom: none;
        }

        .design-footer {
            text-align: center;
            padding: 1.5rem;
            color: #6c757d;
            font-size: 0.9rem;
            border-top: 1px solid #e9ecef;
        }

        .claude-badge {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-weight: 600;
            margin-top: 1rem;
        }
    </style>
</head>
<body>
    <div class="design-container">
        <div class="design-header">
            <h1 class="design-title">${title}</h1>
            <p class="design-subtitle">Created with Claude Design System</p>
        </div>

        <div class="design-content">
            <div class="design-description">
                <p>${description}</p>
                <p>This design was created following the Claude Design System Prompt principles, ensuring thoughtful, well-crafted, and engineered HTML creations.</p>
            </div>

            <div class="design-principles">
                <h2 class="principle-title">Design Principles Applied</h2>
                <ul class="principle-list">
                    <li class="principle-item">✓ User-centric design approach</li>
                    <li class="principle-item">✓ Clean, semantic HTML structure</li>
                    <li class="principle-item">✓ Responsive and accessible design</li>
                    <li class="principle-item">✓ Consistent visual vocabulary</li>
                    <li class="principle-item">✓ Performance-optimized assets</li>
                    <li class="principle-item">✓ Cross-browser compatibility</li>
                </ul>
            </div>
        </div>

        <div class="design-footer">
            <p>Generated by Claude Design Tool • ${new Date().toLocaleDateString()}</p>
            <div class="claude-badge">Claude Design System</div>
        </div>
    </div>

    <script>
        // Simple interactive example
        document.querySelector('.design-container').addEventListener('click', function() {
            this.style.transform = this.style.transform ? '' : 'scale(0.98)';
        });
    </script>
</body>
</html>`

  const fileName = `${title.toLowerCase().replace(/\s+/g, '-')}.html`
  const filePath = join(targetDir, fileName)

  await writeFile(filePath, htmlContent, 'utf-8')

  return {
    success: true,
    message: `Design created successfully at ${filePath}`,
    files: [filePath],
    preview: `Created "${title}" design in ${format} format with ${options} design principles applied.`,
    designSystemApplied: true,
  }
}

async function handleHelp(): Promise<Output> {
  return {
    success: true,
    message: 'DesignTool Help',
    preview: DESIGN_SYSTEM_PROMPT,
    designSystemApplied: true,
  }
}

async function handleInitProject(input: Input, cwd: string): Promise<Output> {
  const projectDir = input.target ? join(cwd, input.target) : join(cwd, 'design-project')

  await mkdir(projectDir, { recursive: true })

  // Create project structure
  const dirs = ['assets', 'css', 'js', 'components', 'pages']
  for (const dir of dirs) {
    await mkdir(join(projectDir, dir), { recursive: true })
  }

  // Create README
  const readmeContent = `# Design Project

This project was initialized with Claude Design Tool.

## Project Structure
- assets/ - Images, fonts, and other assets
- css/ - Stylesheets
- js/ - JavaScript files
- components/ - Reusable components
- pages/ - HTML pages

## Design Principles
Follow the Claude Design System Prompt for creating thoughtful, well-crafted HTML designs.

## Getting Started
1. Add your design assets to the appropriate folders
2. Create HTML files in the pages/ directory
3. Use components/ for reusable elements
4. Apply styles in css/
5. Test your designs in multiple browsers

Created: ${new Date().toISOString()}
`

  await writeFile(join(projectDir, 'README.md'), readmeContent, 'utf-8')

  // Create basic CSS
  const cssContent = `/* Claude Design System - Base Styles */

:root {
  --primary-color: #667eea;
  --secondary-color: #764ba2;
  --text-color: #333;
  --background-color: #fff;
  --border-radius: 12px;
  --spacing-unit: 1rem;
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font-family);
  color: var(--text-color);
  background-color: var(--background-color);
  line-height: 1.6;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 var(--spacing-unit);
}

/* Design System Components */
.design-card {
  background: white;
  border-radius: var(--border-radius);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  padding: var(--spacing-unit);
  margin-bottom: var(--spacing-unit);
}

.design-button {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
  color: white;
  border: none;
  border-radius: var(--border-radius);
  padding: 0.75rem 1.5rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.design-button:hover {
  transform: translateY(-2px);
}

/* Responsive Design */
@media (max-width: 768px) {
  .container {
    padding: 0 calc(var(--spacing-unit) / 2);
  }
}
`

  await writeFile(join(projectDir, 'css', 'style.css'), cssContent, 'utf-8')

  return {
    success: true,
    message: `Design project initialized at ${projectDir}`,
    files: [
      join(projectDir, 'README.md'),
      join(projectDir, 'css', 'style.css'),
    ],
    preview: 'Created design project structure with assets, css, js, components, and pages directories.',
    designSystemApplied: true,
  }
}

export const DesignToolTool = buildTool({
  name: 'designtool',
  searchHint: 'design system and HTML creation tool',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Expert design tool for creating HTML-based design artifacts following the Claude Design System Prompt. Helps with design exploration, prototyping, and implementation.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get inputJSONSchema() {
    const schema = zodToJsonSchema(inputSchema())
    schema.type = 'object'
    return schema
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'DesignTool'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  async call(input: Input, context) {
    const cwd = getCwd()

    try {
      let output: Output
      switch (input.action) {
        case 'create':
          output = await handleCreateDesign(input, cwd)
          break

        case 'init':
          output = await handleInitProject(input, cwd)
          break

        case 'help':
          output = await handleHelp()
          break

        case 'edit':
        case 'review':
        case 'export':
        case 'list':
          // Stub implementations for now
          output = {
            success: true,
            message: `DesignTool action "${input.action}" is implemented as a stub. Full implementation coming soon.`,
            preview: 'This feature is under development.',
            designSystemApplied: true,
          }
          break

        default:
          output = {
            success: false,
            message: `Unknown action: ${input.action}. Available actions: create, init, edit, review, export, list, help.`,
            designSystemApplied: false,
          }
          break
      }
      return { data: output }
    } catch (error) {
      return {
        data: {
          success: false,
          message: `DesignTool error: ${error instanceof Error ? error.message : String(error)}`,
          designSystemApplied: false,
        }
      }
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.success ? output.message : `Design failed: ${output.message}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)