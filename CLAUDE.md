# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An MCP server that enables Claude to send iMessages and SMS messages via macOS, search contacts, and access contact information through AppleScript integration. The server bridges MCP protocol with native macOS messaging services.

## Key Commands

```bash
# Build the TypeScript project
npm run build

# Watch mode for development
npm run watch

# Test with MCP Inspector (interactive tool to test tools/resources)
npm run inspector
```

## Architecture

**Single TypeScript file structure** (`src/index.ts`):
- **AppleScript wrapper** (`runAppleScript`): Executes native AppleScript commands via `osascript`
- **Service detection** (`getAvailableServices`): Determines whether iMessage or SMS is available on the system
- **Smart message routing** (`sendMessageSmart`): Intelligently chooses between iMessage and SMS based on recipient and availability
- **MCP Server setup** (`main`): Initializes server with resources (contacts) and tools (search_contacts, send_message)

**Resources**:
- `contacts://all` - Exposes all contacts from macOS Contacts app

**Tools**:
- `search_contacts` - Search contacts by name, phone, or email
- `send_message` - Send message to a recipient (automatically routes through available service)

## Important Implementation Details

1. **Phone Number Normalization**: The `normalizeSMSNumber` function removes +1 country codes for SMS compatibility. SMS has stricter format requirements than iMessage.

2. **Service Routing Strategy**: `sendMessageSmart` prefers SMS for phone numbers when available (more reliable), falls back to iMessage. Email recipients always use iMessage.

3. **AppleScript Error Handling**: AppleScript execution errors are caught and returned as readable error messages to help users troubleshoot permission/configuration issues.

## Development Workflow

Use the MCP Inspector to test changes interactively:
```bash
npm run watch  # In one terminal
npm run inspector  # In another - opens interactive testing UI
```

This allows you to test tools and resources in real-time without rebuilding the Claude Desktop config.

## Deployment

After making changes:
1. `npm run build` - Compiles TypeScript to JavaScript
2. Update Claude Desktop config to point to `build/index.js`
3. Restart Claude Desktop to pick up changes
