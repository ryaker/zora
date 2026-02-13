/**
 * R20: Real-world Gemini CLI output samples for tool parsing tests.
 *
 * These fixtures represent the output formats that the Gemini CLI
 * can produce when it encounters tool calls in its response.
 */

// XML-style tool call (common in Gemini responses)
export const XML_TOOL_CALL_SAMPLE = `
Here's my analysis of the file:

<tool_call name="Read">{"file_path": "/home/user/project/src/index.ts"}</tool_call>

Let me check the contents.
`;

// Multiple XML tool calls
export const MULTI_XML_TOOL_CALL_SAMPLE = `
I'll read both files:

<tool_call name="Read">{"file_path": "/home/user/project/src/a.ts"}</tool_call>

And the second one:

<tool_call name="Read">{"file_path": "/home/user/project/src/b.ts"}</tool_call>
`;

// Markdown JSON tool call
export const MARKDOWN_JSON_TOOL_CALL_SAMPLE = `
Let me write a new file:

\`\`\`json
{"tool": "Write", "arguments": {"file_path": "/home/user/project/output.txt", "content": "Hello World"}}
\`\`\`

Done!
`;

// Multiple markdown JSON tool calls
export const MULTI_MARKDOWN_JSON_TOOL_CALL_SAMPLE = `
I need to edit multiple files:

\`\`\`json
{"tool": "Write", "arguments": {"file_path": "/tmp/a.txt", "content": "File A"}}
\`\`\`

\`\`\`json
{"tool": "Write", "arguments": {"file_path": "/tmp/b.txt", "content": "File B"}}
\`\`\`
`;

// Plain text with no tool calls
export const NO_TOOL_CALL_SAMPLE = `
The answer to your question is 42. This is a straightforward text response
with no tool invocations whatsoever.
`;

// Malformed XML tool call (bad JSON inside)
export const MALFORMED_XML_TOOL_CALL_SAMPLE = `
<tool_call name="Read">{bad json here}</tool_call>
`;

// Malformed JSON in markdown (missing closing brace)
export const MALFORMED_MARKDOWN_JSON_SAMPLE = `
\`\`\`json
{"tool": "Write", "arguments": {"file_path": "/tmp/test.txt"
\`\`\`
`;

// Mixed: XML takes priority over markdown JSON
export const MIXED_FORMAT_SAMPLE = `
<tool_call name="Bash">{"command": "ls -la"}</tool_call>

Also this:

\`\`\`json
{"tool": "Write", "arguments": {"file_path": "/tmp/test.txt", "content": "hello"}}
\`\`\`
`;

// Edge case: single-quoted XML attribute
export const SINGLE_QUOTED_XML_SAMPLE = `
<tool_call name='Glob'>{"pattern": "**/*.ts"}</tool_call>
`;
