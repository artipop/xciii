#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const KAITEN_BASE_URL = 'https://vinokurov.kaiten.ru/api/latest'
const SERVER_VERSION = '0.1.0'

const server = new McpServer({
  name: 'kaiten',
  version: SERVER_VERSION
})

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

async function kaitenRequest(path: string, init: RequestInit = {}): Promise<ToolResult> {
  const token = process.env.KAITEN_TOKEN
  if (!token) {
    return errorResult('Error: KAITEN_TOKEN is not set')
  }

  console.error(
    `[kaiten] using token ${token.slice(0, 4)}...${token.slice(-4)} (len=${token.length})`
  )

  const response = await fetch(`${KAITEN_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Kaiten-Client': 'kaiten-mcp',
      'X-Kaiten-Client-Version': SERVER_VERSION,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    }
  })

  if (!response.ok) {
    const body = await response.text()
    return errorResult(`Error: API returned HTTP ${response.status} ${body ?? ''}`)
  }

  const raw = await response.text()
  if (!raw) {
    return { content: [{ type: 'text', text: 'OK' }] }
  }
  return { content: [{ type: 'text', text: JSON.stringify(JSON.parse(raw), null, 2) }] }
}

server.registerTool(
  'get_card',
  {
    description: 'Fetch a Kaiten card by its numeric ID',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID')
    }
  },
  async ({ cardId }) => kaitenRequest(`/cards/${cardId}`)
)

server.registerTool(
  'update_card',
  {
    description:
      'Update a Kaiten card — title, description, or move it to a different column/lane/board',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID'),
      title: z.string().optional().describe('New card title'),
      description: z.string().optional().describe('New card description'),
      columnId: z.number().optional().describe('Move card to this column ID'),
      laneId: z.number().optional().describe('Move card to this lane ID'),
      boardId: z.number().optional().describe('Move card to this board ID'),
      sortOrder: z
        .number()
        .positive()
        .optional()
        .describe('Position within the column/lane')
    }
  },
  async ({ cardId, title, description, columnId, laneId, boardId, sortOrder }) =>
    kaitenRequest(`/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title,
        description,
        column_id: columnId,
        lane_id: laneId,
        board_id: boardId,
        sort_order: sortOrder
      })
    })
)

server.registerTool(
  'get_columns',
  {
    description: 'List the columns of a Kaiten board',
    inputSchema: {
      boardId: z.string().describe('Kaiten board ID')
    }
  },
  async ({ boardId }) => kaitenRequest(`/boards/${boardId}/columns`)
)

server.registerTool(
  'get_comments',
  {
    description: 'List comments on a Kaiten card',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID')
    }
  },
  async ({ cardId }) => kaitenRequest(`/cards/${cardId}/comments`)
)

server.registerTool(
  'add_comment',
  {
    description: 'Add a comment to a Kaiten card',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID'),
      text: z.string().min(1).max(4096).describe('Comment text')
    }
  },
  async ({ cardId, text }) =>
    kaitenRequest(`/cards/${cardId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text })
    })
)

server.registerTool(
  'update_comment',
  {
    description: 'Update an existing comment on a Kaiten card',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID'),
      commentId: z.string().describe('Comment ID'),
      text: z.string().max(4096).describe('New comment text')
    }
  },
  async ({ cardId, commentId, text }) =>
    kaitenRequest(`/cards/${cardId}/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ text })
    })
)

server.registerTool(
  'add_checklist',
  {
    description: 'Create a checklist on a Kaiten card',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID'),
      name: z.string().min(1).max(1024).describe('Checklist name'),
      sortOrder: z.number().positive().optional().describe('Checklist position')
    }
  },
  async ({ cardId, name, sortOrder }) =>
    kaitenRequest(`/cards/${cardId}/checklists`, {
      method: 'POST',
      body: JSON.stringify({ name, sort_order: sortOrder })
    })
)

server.registerTool(
  'get_checklist',
  {
    description: 'Fetch a checklist and its items from a Kaiten card',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID'),
      checklistId: z.string().describe('Checklist ID')
    }
  },
  async ({ cardId, checklistId }) =>
    kaitenRequest(`/cards/${cardId}/checklists/${checklistId}`)
)

server.registerTool(
  'update_checklist',
  {
    description: 'Rename or reorder a checklist on a Kaiten card',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID'),
      checklistId: z.string().describe('Checklist ID'),
      name: z.string().min(1).max(1024).optional().describe('New checklist name'),
      sortOrder: z.number().positive().optional().describe('New checklist position')
    }
  },
  async ({ cardId, checklistId, name, sortOrder }) =>
    kaitenRequest(`/cards/${cardId}/checklists/${checklistId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, sort_order: sortOrder })
    })
)

server.registerTool(
  'add_checklist_item',
  {
    description: 'Add an item to a Kaiten card checklist',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID'),
      checklistId: z.string().describe('Checklist ID'),
      text: z.string().min(1).max(4096).describe('Item text'),
      sortOrder: z.number().positive().optional().describe('Item position'),
      checked: z.boolean().optional().describe('Whether the item starts checked'),
      dueDate: z.string().optional().describe('Due date, format YYYY-MM-DD'),
      responsibleId: z.number().optional().describe('Assigned user ID')
    }
  },
  async ({ cardId, checklistId, text, sortOrder, checked, dueDate, responsibleId }) =>
    kaitenRequest(`/cards/${cardId}/checklists/${checklistId}/items`, {
      method: 'POST',
      body: JSON.stringify({
        text,
        sort_order: sortOrder,
        checked,
        due_date: dueDate,
        responsible_id: responsibleId
      })
    })
)

server.registerTool(
  'update_checklist_item',
  {
    description:
      'Update a checklist item on a Kaiten card — edit text, reorder, mark checked/unchecked, set due date or assignee',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID'),
      checklistId: z.string().describe('Checklist ID'),
      itemId: z.string().describe('Checklist item ID'),
      text: z.string().max(4096).optional().describe('New item text'),
      sortOrder: z.number().positive().optional().describe('New item position'),
      checked: z.boolean().optional().describe('Mark item as checked/unchecked'),
      dueDate: z
        .string()
        .nullable()
        .optional()
        .describe('Due date, format YYYY-MM-DD, or null to clear'),
      responsibleId: z
        .number()
        .nullable()
        .optional()
        .describe('Assigned user ID, or null to unassign')
    }
  },
  async ({
    cardId,
    checklistId,
    itemId,
    text,
    sortOrder,
    checked,
    dueDate,
    responsibleId
  }) =>
    kaitenRequest(`/cards/${cardId}/checklists/${checklistId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        text,
        sort_order: sortOrder,
        checked,
        due_date: dueDate,
        responsible_id: responsibleId
      })
    })
)

server.registerTool(
  'delete_checklist_item',
  {
    description: 'Delete an item from a Kaiten card checklist',
    inputSchema: {
      cardId: z.string().describe('Kaiten card ID'),
      checklistId: z.string().describe('Checklist ID'),
      itemId: z.string().describe('Checklist item ID')
    }
  },
  async ({ cardId, checklistId, itemId }) =>
    kaitenRequest(`/cards/${cardId}/checklists/${checklistId}/items/${itemId}`, {
      method: 'DELETE'
    })
)

await server.connect(new StdioServerTransport())
