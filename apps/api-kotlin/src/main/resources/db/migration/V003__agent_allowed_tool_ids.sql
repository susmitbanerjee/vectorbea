-- Add allowed_tool_ids array to agents table.
-- Stores the list of tool IDs an agent is permitted to call.
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS allowed_tool_ids TEXT[] NOT NULL DEFAULT '{}';
