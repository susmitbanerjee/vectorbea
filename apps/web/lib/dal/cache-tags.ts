export const PROMPTS_TAG = "prompts";
export const WORKSPACES_TAG = "workspaces";

export function workspaceTag(workspaceId: string) {
  return `workspace-${workspaceId}`;
}

export function promptTag(promptId: string) {
  return `prompt-${promptId}`;
}

export function organizationTag(organizationId: string) {
  return `organization-${organizationId}`;
}
