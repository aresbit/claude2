import type { Command } from '../../commands.js'

const goal = {
  type: 'local' as const,
  name: 'goal',
  description: 'Manage autonomous goals — /goal <objective> to create, /goal to view, /goal pause|resume|clear',
  aliases: [],
  supportsNonInteractive: true,
  load: () => import('./goal.js'),
} satisfies Command

export default goal
