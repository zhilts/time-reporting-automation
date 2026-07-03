#!/usr/bin/env node

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  const request = JSON.parse(input);

  if (request.protocol_version !== 1) {
    throw new Error(`Unsupported protocol_version: ${request.protocol_version}`);
  }

  if (request.operation === "sync") {
    // Replace this with a target-specific bridge: MCP tools, REST API, CLI, etc.
    process.stdout.write(JSON.stringify({
      uploaded_keys: [],
      reused_existing_keys: [],
      deleted_record_ids: []
    }));
    return;
  }

  if (request.operation === "reset") {
    process.stdout.write(JSON.stringify({
      deleted_record_ids: []
    }));
    return;
  }

  throw new Error(`Unsupported operation: ${request.operation}`);
});
