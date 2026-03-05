#!/usr/bin/env node

/**
 * iMessage MCP Server
 *
 * Enables sending iMessages and SMS messages through macOS Messages app
 * and searching contacts from the Contacts app.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ============================================================================
// Constants
// ============================================================================

const CHARACTER_LIMIT = 25000;

// ============================================================================
// Zod Schemas
// ============================================================================

const SendMessageInputSchema = z.object({
  recipient: z.string().min(1),
  message: z.string().min(1).max(10000)
});

const SearchContactsInputSchema = z.object({
  query: z.string().min(1).max(200)
});

// Type definitions
type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
type SearchContactsInput = z.infer<typeof SearchContactsInputSchema>;

// ============================================================================
// Utility Functions
// ============================================================================

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

async function runAppleScript(script: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    return stdout.trim();
  } catch (error) {
    const message = getErrorMessage(error);
    // Provide actionable error messages
    if (message.includes("Not authorized")) {
      throw new Error(
        "Messages app access denied. Check System Preferences > Privacy > Automation " +
        "to ensure your terminal/Claude has permission to control Messages app."
      );
    }
    if (message.includes("Connection is invalid")) {
      throw new Error("Messages app is not running. Please open the Messages app first.");
    }
    throw new Error(`AppleScript error: ${message}`);
  }
}

/**
 * Escape AppleScript special characters to prevent injection
 */
function escapeAppleScript(str: string): string {
  return str
    .replace(/\\/g, "\\\\")    // Escape backslashes first
    .replace(/"/g, '\\"')      // Escape double quotes
    .replace(/\r/g, "\\r")     // Escape carriage returns
    .replace(/\n/g, "\\n");    // Escape newlines
}

/**
 * Normalize phone number to +1XXXXXXXXXX format for Messages app compatibility
 */
function normalizePhoneNumber(recipient: string): string {
  // If it's an email address, return as-is
  if (recipient.includes("@")) {
    return recipient;
  }

  // Strip all non-digit characters
  const digits = recipient.replace(/\D/g, "");

  // Add +1 country code if not present
  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // If already has +, return with country code
  if (recipient.startsWith("+")) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

/**
 * Send a message via Messages app. Messages app automatically routes through
 * the appropriate service (iMessage for Apple IDs, SMS for phone numbers).
 */
async function sendMessage(
  recipient: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const normalizedRecipient = normalizePhoneNumber(recipient);
  const escapedMessage = escapeAppleScript(message);
  const escapedRecipient = escapeAppleScript(normalizedRecipient);

  try {
    const script = `
      tell application "Messages"
        send "${escapedMessage}" to buddy "${escapedRecipient}"
      end tell
    `;

    await runAppleScript(script);
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Search contacts by name, phone, or email
 */
async function searchContacts(query: string): Promise<Array<{name: string; phones: string[]; emails: string[]}>> {
  const escapedQuery = query.replace(/"/g, '\\"');

  const script = `
    tell application "Contacts"
      set output to "["
      set isFirst to true
      repeat with p in every person
        set personName to (name of p as text)
        set matchFound to false

        if (personName contains "${escapedQuery}") then
          set matchFound to true
        else
          repeat with ph in phones of p
            if ((value of ph as text) contains "${escapedQuery}") then
              set matchFound to true
              exit repeat
            end if
          end repeat

          if not matchFound then
            repeat with em in emails of p
              if ((value of em as text) contains "${escapedQuery}") then
                set matchFound to true
                exit repeat
              end if
            end repeat
          end if
        end if

        if matchFound then
          if not isFirst then
            set output to output & ","
          end if
          set output to output & "{"
          set output to output & "\\"name\\":\\"" & personName & "\\","
          set output to output & "\\"phones\\":["
          set firstPhone to true
          repeat with ph in phones of p
            if not firstPhone then
              set output to output & ","
            end if
            set output to output & "\\"" & (value of ph as text) & "\\""
            set firstPhone to false
          end repeat
          set output to output & "],"
          set output to output & "\\"emails\\":["
          set firstEmail to true
          repeat with em in emails of p
            if not firstEmail then
              set output to output & ","
            end if
            set output to output & "\\"" & (value of em as text) & "\\""
            set firstEmail to false
          end repeat
          set output to output & "]"
          set output to output & "}"
          set isFirst to false
        end if
      end repeat
      return output & "]"
    end tell
  `;

  try {
    const results = await runAppleScript(script);
    return JSON.parse(results);
  } catch (error) {
    throw new Error(`Failed to search contacts: ${getErrorMessage(error)}`);
  }
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new McpServer({
  name: "imessage-mcp-server",
  version: "1.0.0"
});

// Register send_message tool
server.tool(
  "imessage_send_message",
  SendMessageInputSchema.shape as any,
  { title: "Send Message via iMessage/SMS" },
  async (params: SendMessageInput) => {
    try {
      const result = await sendMessage(params.recipient, params.message);

      if (result.success) {
        return {
          content: [
            {
              type: "text",
              text: `Message sent successfully to ${params.recipient}`
            }
          ]
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Failed to send message to ${params.recipient}: ${result.error || "Unknown error"}`
            }
          ],
          isError: true
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${getErrorMessage(error)}`
          }
        ],
        isError: true
      };
    }
  }
);

// Register search_contacts tool
server.tool(
  "imessage_search_contacts",
  SearchContactsInputSchema.shape as any,
  { title: "Search Contacts" },
  async (params: SearchContactsInput) => {
    try {
      const results = await searchContacts(params.query);

      if (!results || results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No contacts found matching "${params.query}"`
            }
          ]
        };
      }

      // Format results as markdown for readability
      const lines = [`# Contact Search Results: "${params.query}"`];
      lines.push(`Found ${results.length} contact(s):`);
      lines.push("");

      for (const contact of results) {
        lines.push(`## ${contact.name}`);
        if (contact.phones && contact.phones.length > 0) {
          lines.push(`**Phone**: ${contact.phones.join(", ")}`);
        }
        if (contact.emails && contact.emails.length > 0) {
          lines.push(`**Email**: ${contact.emails.join(", ")}`);
        }
        lines.push("");
      }

      const textContent = lines.join("\n");

      // Check character limit
      if (textContent.length > CHARACTER_LIMIT) {
        return {
          content: [
            {
              type: "text",
              text: textContent.substring(0, CHARACTER_LIMIT) +
                `\n\n[Truncated - Search returned too many results. Refine your query to see all matches.]`
            }
          ]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: textContent
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${getErrorMessage(error)}`
          }
        ],
        isError: true
      };
    }
  }
);

// ============================================================================
// Server Startup
// ============================================================================

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("iMessage MCP server started successfully");
  } catch (error) {
    console.error("Server error:", getErrorMessage(error));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", getErrorMessage(error));
  process.exit(1);
});
