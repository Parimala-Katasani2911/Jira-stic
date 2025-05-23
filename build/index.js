import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import JiraClient from "jira-client";
import 'dotenv/config';
// Tool definitions
const tools = [
    {
        name: "create-issue",
        description: "Create a new Jira issue",
        parameters: {
            projectKey: { type: "string", required: true },
            summary: { type: "string", required: true },
            issueType: { type: "string", required: true },
            description: { type: "string", required: false },
            assignee: { type: "string", required: false },
            labels: { type: "array", items: { type: "string" }, required: false },
            components: { type: "array", items: { type: "string" }, required: false },
            priority: { type: "string", required: false },
            parent: { type: "string", required: false },
            reporter: { type: "string", required: false },
        },
    },
    {
        name: "get-issues",
        description: "Get issues for a Jira project",
        parameters: {
            projectKey: { type: "string", required: true },
            jql: { type: "string", required: false },
        },
    },
];
// Load Jira credentials from environment variables
const JIRA_HOST = process.env.JIRA_HOST;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error("Set JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN env vars");
}
const jira = new JiraClient({
    protocol: "https",
    host: JIRA_HOST,
    username: JIRA_EMAIL,
    password: JIRA_API_TOKEN,
    apiVersion: "3",
    strictSSL: true,
});
// Create an MCP server instance
const server = new McpServer({
    name: "jira-mcp-sse",
    description: "A server that provides Jira issue management via SSE",
    version: "1.0.0",
    tools,
});
// Tool implementations
server.tool("create-issue", "Create a new Jira issue", async (params) => {
    const { projectKey, summary, issueType, description, assignee, labels, components, priority, parent, reporter, } = params;
    // Get accountId for assignee if specified (Jira Cloud API requires accountId)
    let assigneeId;
    if (assignee) {
        const users = await jira.searchUsers({ query: assignee });
        assigneeId = users && users[0] ? users[0].accountId : undefined;
    }
    // Get accountId for reporter if specified
    let reporterId;
    if (reporter) {
        const users = await jira.searchUsers({ query: reporter });
        reporterId = users && users[0] ? users[0].accountId : undefined;
    }
    const fields = {
        project: { key: projectKey },
        summary,
        issuetype: { name: issueType },
    };
    if (description)
        fields.description = description;
    if (assigneeId)
        fields.assignee = { accountId: assigneeId };
    if (reporterId)
        fields.reporter = { accountId: reporterId };
    if (labels)
        fields.labels = labels;
    if (components)
        fields.components = components.map((name) => ({ name }));
    if (priority)
        fields.priority = { name: priority };
    if (parent)
        fields.parent = { key: parent };
    const response = await jira.addNewIssue({ fields });
    return {
        content: [
            {
                type: "text",
                text: `Issue created: [${response.key}](https://${JIRA_HOST}/browse/${response.key})`,
            },
        ],
    };
});
server.tool("get-issues", "Get issues for a Jira project", async (params) => {
    const { projectKey, jql } = params;
    const query = jql
        ? `project = ${projectKey} AND ${jql}`
        : `project = ${projectKey}`;
    const response = await jira.searchJira(query, {
        maxResults: 100,
        fields: [
            "summary",
            "description",
            "status",
            "priority",
            "assignee",
            "issuetype",
            "parent",
            "subtasks",
        ],
    });
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(response.issues.map((issue) => ({
                    key: issue.key,
                    summary: issue.fields.summary,
                    status: issue.fields.status?.name,
                    priority: issue.fields.priority?.name,
                    assignee: issue.fields.assignee?.displayName,
                    issueType: issue.fields.issuetype?.name,
                    url: `https://${JIRA_HOST}/browse/${issue.key}`,
                })), null, 2),
            },
        ],
    };
});
// Set up Express and SSE transport
const app = express();
const transports = {};
app.get("/sse", async (req, res) => {
    const host = req.get("host");
    const fullUri = `https://${host}/jira`;
    const transport = new SSEServerTransport(fullUri, res);
    transports[transport.sessionId] = transport;
    res.on("close", () => {
        delete transports[transport.sessionId];
    });
    await server.connect(transport);
});
// Root endpoint
app.get("/", (req, res) => {
    res.send("Jira MCP SSE server is running.");
});
// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Jira MCP SSE server listening on port http://localhost:${PORT}`);
});
