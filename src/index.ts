#!/usr/bin/env node

/**
 * An MCP server that uses AppleScript to send iMessages and interact with Contacts.
 * It provides tools to:
 * - Send iMessages through the Messages app
 * - View contacts through the Contacts app
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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
    throw new Error(`AppleScript error: ${getErrorMessage(error)}`);
  }
}

// Function to normalize phone number for SMS compatibility
function normalizePhoneNumber(recipient: string): string {
  // Remove +1 country code for SMS compatibility with US carriers
  if (recipient.startsWith("+1")) {
    return recipient.substring(2);
  }
  return recipient;
}

// Enhanced send message function with SMS fallback
async function sendMessageWithFallback(recipient: string, message: string): Promise<{success: boolean, serviceUsed: string, error?: string}> {
  const escapedMessage = message.replace(/"/g, '\\"');
  const escapedRecipient = recipient.replace(/"/g, '\\"');
  
  // Try iMessage first
  try {
    const imessageScript = `
      tell application "Messages"
        try
          send "${escapedMessage}" to buddy "${escapedRecipient}" of (service 1 whose service type = iMessage)
          return "SUCCESS"
        on error
          return "FAILED"
        end try
      end tell
    `;
    
    const result = await runAppleScript(imessageScript);
    if (result === "SUCCESS") {
      return {success: true, serviceUsed: "iMessage"};
    }
  } catch (error) {
    // Continue to SMS fallback
  }
  
  // Fall back to SMS
  try {
    const normalizedRecipient = normalizePhoneNumber(escapedRecipient);
    const smsScript = `
      tell application "Messages"
        try
          send "${escapedMessage}" to buddy "${normalizedRecipient}" of (service 1 whose service type = SMS)
          return "SUCCESS"
        on error errorMessage
          return "FAILED: " & errorMessage
        end try
      end tell
    `;
    
    const result = await runAppleScript(smsScript);
    if (result === "SUCCESS") {
      return {success: true, serviceUsed: "SMS"};
    } else {
      return {success: false, serviceUsed: "SMS", error: result};
    }
  } catch (error) {
    return {success: false, serviceUsed: "SMS", error: getErrorMessage(error)};
  }
}

const server = new Server(
  {
    name: "iMessage-AppleScript-Server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "contacts://all",
        mimeType: "application/json",
        name: "All Contacts",
        description: "List of all contacts from the Contacts app",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri !== "contacts://all") {
    throw new Error(`Unknown resource: ${request.params.uri}`);
  }

  const script = `
    tell application "Contacts"
      set output to "["
      repeat with p in every person
        if output is not "[" then
          set output to output & ","
        end if
        set output to output & "{"
        set output to output & "\\"name\\":\\"" & (name of p as text) & "\\","
        set output to output & "\\"phones\\":["
        set firstPhone to true
        repeat with ph in phones of p
          if not firstPhone then
            set output to output & ","
          end if
          set output to output & "\\"" & (value of ph) & "\\""
          set firstPhone to false
        end repeat
        set output to output & "],"
        set output to output & "\\"emails\\":["
        set firstEmail to true
        repeat with em in emails of p
          if not firstEmail then
            set output to output & ","
          end if
          set output to output & "\\"" & (value of em) & "\\""
          set firstEmail to false
        end repeat
        set output to output & "]"
        set output to output & "}"
      end repeat
      return output & "]"
    end tell
  `;

  try {
    const contacts = await runAppleScript(script);
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: contacts,
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to fetch contacts: ${getErrorMessage(error)}`);
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "send_imessage",
        description: "Send a message using Messages app (tries iMessage first, falls back to SMS)",
        inputSchema: {
          type: "object",
          properties: {
            recipient: {
              type: "string",
              description: "Phone number or email of the recipient",
            },
            message: {
              type: "string",
              description: "Message content to send",
            },
          },
          required: ["recipient", "message"],
        },
      },
      {
        name: "search_contacts",
        description: "Search contacts by name, phone, or email",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "send_imessage": {
      const recipient = String(request.params.arguments?.recipient);
      const message = String(request.params.arguments?.message);

      if (!recipient || !message) {
        throw new Error("Recipient and message are required");
      }

      try {
        const result = await sendMessageWithFallback(recipient, message);
        
        if (result.success) {
          return {
            content: [
              {
                type: "text",
                text: `Message sent successfully to ${recipient} via ${result.serviceUsed}`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Failed to send message to ${recipient}: ${result.error || 'Unknown error'}`,
              },
            ],
            isError: true,
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to send message: ${getErrorMessage(error)}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "search_contacts": {
      const query = String(request.params.arguments?.query).toLowerCase();

      const script = `
        tell application "Contacts"
          set output to "["
          set isFirst to true
          repeat with p in every person
            if ((name of p as text) contains "${query}") then
              if not isFirst then
                set output to output & ","
              end if
              set output to output & "{"
              set output to output & "\\"name\\":\\"" & (name of p as text) & "\\","
              set output to output & "\\"phones\\":["
              set firstPhone to true
              repeat with ph in phones of p
                if not firstPhone then
                  set output to output & ","
                end if
                set output to output & "\\"" & (value of ph) & "\\""
                set firstPhone to false
              end repeat
              set output to output & "],"
              set output to output & "\\"emails\\":["
              set firstEmail to true
              repeat with em in emails of p
                if not firstEmail then
                  set output to output & ","
                end if
                set output to output & "\\"" & (value of em) & "\\""
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
        return {
          content: [
            {
              type: "text",
              text: results,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Search failed: ${getErrorMessage(error)}`,
            },
          ],
          isError: true,
        };
      }
    }

    default:
      throw new Error("Unknown tool");
  }
});

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("iMessage AppleScript MCP server started");
  } catch (error) {
    console.error("Server error:", error);
    process.exit(1);
  }
}

main();
