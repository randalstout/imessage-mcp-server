# iMessage MCP Server

An MCP (Model Context Protocol) server that enables Claude to send iMessages and SMS messages through macOS Messages app and search contacts from the Contacts app.

## Features

- **Send Messages**: Send iMessages or SMS through the Messages app with automatic service routing
- **Search Contacts**: Search contacts by name, phone number, or email from Contacts app
- **Smart Phone Number Normalization**: Handles various phone number formats
- **Service-Agnostic Routing**: Messages app automatically chooses between SMS and iMessage based on recipient

## Installation

### Prerequisites

- Node.js 18+
- macOS with Messages app
- Terminal access with Messages app automation enabled (System Preferences > Privacy > Automation)

### Setup

```bash
# Install dependencies
npm install

# Build the server
npm run build

# Test with MCP Inspector
npm run inspector
```

## Tools

### `imessage_send_message`

Send a message through the Messages app.

**Parameters:**
- `recipient` (string): Phone number or email address
  - Phone formats: `214-212-5050`, `2142125050`, `+12142125050`, `(214) 212-5050`
  - Email: `user@example.com`
- `message` (string): Message content (max 10,000 characters)

**Example:**
```
Send "Hello John" to 214-212-5050
Send "Meeting at 3pm" to john@example.com
```

### `imessage_search_contacts`

Search for contacts by name, phone number, or email.

**Parameters:**
- `query` (string): Search term (name, phone, or email partial match)

**Example:**
```
Search for "John"
Search for "214-212-5050"
Search for "john@example.com"
```

## Architecture

**Single File Structure** (`src/index.ts`):
- **AppleScript Integration**: Executes native AppleScript via `osascript`
- **Input Validation**: Zod schemas for runtime validation
- **Phone Number Normalization**: Converts any format to `+1XXXXXXXXXX`
- **AppleScript Injection Protection**: Escapes special characters

## Configuration

### Claude Desktop

Update `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "imessage-mcp-server": {
      "command": "node",
      "args": ["/path/to/dist/index.js"]
    }
  }
}
```

Then restart Claude Desktop.

## Development

```bash
# Watch mode for development
npm run dev

# Build TypeScript
npm run build

# Start the server
npm start

# Run MCP Inspector
npm run inspector
```

## Error Handling

The server provides actionable error messages:

- **"Messages app access denied"**: Check System Preferences > Privacy > Automation
- **"Messages app is not running"**: Open the Messages app
- **Invalid recipient format**: Ensure valid phone number or email

## Implementation Details

### Phone Number Normalization

The server normalizes phone numbers to the format Messages app requires:
- `10-digit numbers` → `+1XXXXXXXXXX`
- `11-digit numbers starting with 1` → `+1XXXXXXXXXX`
- `Numbers with +` → `+XXXXXXXXXX`

### Service Routing

Messages app automatically routes messages through:
- **iMessage** for email addresses and registered iMessage accounts
- **SMS** for phone numbers (when iMessage not available)

The server uses service-agnostic routing to let Messages app decide the best service.

### Security

- All AppleScript parameters are sanitized to prevent injection
- Special characters (backslashes, quotes, newlines) are escaped
- Input validation with Zod schemas

## Testing

Run evaluations to verify functionality:

```bash
npm run inspector
```

Test cases in `evaluations.xml` cover:
- Various phone number formats
- Email address messaging
- Contact search by name, phone, and email
- Special characters in messages
- Multi-line messages

## Permissions Required

The server needs macOS automation permissions:

1. Open System Preferences
2. Go to Privacy > Automation
3. Grant permission to Terminal (or Claude) for Messages and Contacts apps

## Build Output

- Source: `src/index.ts`
- Compiled: `dist/index.js`
- Type Definitions: `dist/index.d.ts`

## Version

1.0.0 - MCP Best Practices Compliant

## SDK & Dependencies

- `@modelcontextprotocol/sdk`: ^1.6.1
- `zod`: ^3.23.8
- TypeScript: ^5.7.2
