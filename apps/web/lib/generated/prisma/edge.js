
Object.defineProperty(exports, "__esModule", { value: true });

const {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientRustPanicError,
  PrismaClientInitializationError,
  PrismaClientValidationError,
  NotFoundError,
  getPrismaClient,
  sqltag,
  empty,
  join,
  raw,
  skip,
  Decimal,
  Debug,
  objectEnumValues,
  makeStrictEnum,
  Extensions,
  warnOnce,
  defineDmmfProperty,
  Public,
  getRuntime
} = require('./runtime/edge.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = PrismaClientKnownRequestError;
Prisma.PrismaClientUnknownRequestError = PrismaClientUnknownRequestError
Prisma.PrismaClientRustPanicError = PrismaClientRustPanicError
Prisma.PrismaClientInitializationError = PrismaClientInitializationError
Prisma.PrismaClientValidationError = PrismaClientValidationError
Prisma.NotFoundError = NotFoundError
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = sqltag
Prisma.empty = empty
Prisma.join = join
Prisma.raw = raw
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = Extensions.getExtensionContext
Prisma.defineExtension = Extensions.defineExtension

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}





/**
 * Enums
 */
exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.OrganizationScalarFieldEnum = {
  id: 'id',
  name: 'name',
  slug: 'slug',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  organizationId: 'organizationId',
  email: 'email',
  name: 'name',
  role: 'role',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AgentJobScalarFieldEnum = {
  id: 'id',
  organizationId: 'organizationId',
  name: 'name',
  description: 'description',
  status: 'status',
  triggerType: 'triggerType',
  cronExpression: 'cronExpression',
  timezone: 'timezone',
  endpointUrl: 'endpointUrl',
  httpMethod: 'httpMethod',
  headersJson: 'headersJson',
  maxDurationSeconds: 'maxDurationSeconds',
  maxRetries: 'maxRetries',
  retryBackoffSeconds: 'retryBackoffSeconds',
  requireApprovalBeforeRun: 'requireApprovalBeforeRun',
  requireApprovalBeforeExternalAction: 'requireApprovalBeforeExternalAction',
  createdByUserId: 'createdByUserId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AgentRunScalarFieldEnum = {
  id: 'id',
  organizationId: 'organizationId',
  agentJobId: 'agentJobId',
  status: 'status',
  triggerSource: 'triggerSource',
  startedAt: 'startedAt',
  finishedAt: 'finishedAt',
  durationMs: 'durationMs',
  attemptNumber: 'attemptNumber',
  idempotencyKey: 'idempotencyKey',
  inputJson: 'inputJson',
  outputJson: 'outputJson',
  errorMessage: 'errorMessage',
  totalTokens: 'totalTokens',
  estimatedCostUsd: 'estimatedCostUsd',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AgentRunStepScalarFieldEnum = {
  id: 'id',
  organizationId: 'organizationId',
  agentRunId: 'agentRunId',
  stepIndex: 'stepIndex',
  stepType: 'stepType',
  name: 'name',
  status: 'status',
  inputJson: 'inputJson',
  outputJson: 'outputJson',
  errorMessage: 'errorMessage',
  tokensUsed: 'tokensUsed',
  estimatedCostUsd: 'estimatedCostUsd',
  startedAt: 'startedAt',
  finishedAt: 'finishedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ApprovalRequestScalarFieldEnum = {
  id: 'id',
  organizationId: 'organizationId',
  agentRunId: 'agentRunId',
  agentRunStepId: 'agentRunStepId',
  status: 'status',
  title: 'title',
  message: 'message',
  requestedBySystem: 'requestedBySystem',
  requestedAt: 'requestedAt',
  decidedAt: 'decidedAt',
  decidedByUserId: 'decidedByUserId',
  decisionReason: 'decisionReason'
};

exports.Prisma.BudgetPolicyScalarFieldEnum = {
  id: 'id',
  organizationId: 'organizationId',
  agentJobId: 'agentJobId',
  maxTokensPerRun: 'maxTokensPerRun',
  maxCostUsdPerRun: 'maxCostUsdPerRun',
  maxRunsPerDay: 'maxRunsPerDay',
  maxRunsPerMonth: 'maxRunsPerMonth',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  organizationId: 'organizationId',
  actorUserId: 'actorUserId',
  entityType: 'entityType',
  entityId: 'entityId',
  action: 'action',
  metadataJson: 'metadataJson',
  createdAt: 'createdAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};

exports.Prisma.JsonNullValueFilter = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull,
  AnyNull: Prisma.AnyNull
};
exports.UserRole = exports.$Enums.UserRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER'
};

exports.JobStatus = exports.$Enums.JobStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED'
};

exports.TriggerType = exports.$Enums.TriggerType = {
  MANUAL: 'MANUAL',
  CRON: 'CRON'
};

exports.HttpMethod = exports.$Enums.HttpMethod = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE'
};

exports.RunStatus = exports.$Enums.RunStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMEOUT: 'TIMEOUT'
};

exports.TriggerSource = exports.$Enums.TriggerSource = {
  MANUAL: 'MANUAL',
  SCHEDULE: 'SCHEDULE',
  RETRY: 'RETRY'
};

exports.StepType = exports.$Enums.StepType = {
  LLM_CALL: 'LLM_CALL',
  TOOL_CALL: 'TOOL_CALL',
  HTTP_CALL: 'HTTP_CALL',
  APPROVAL_GATE: 'APPROVAL_GATE',
  SYSTEM: 'SYSTEM',
  ERROR: 'ERROR'
};

exports.StepStatus = exports.$Enums.StepStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'
};

exports.ApprovalStatus = exports.$Enums.ApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED'
};

exports.Prisma.ModelName = {
  Organization: 'Organization',
  User: 'User',
  AgentJob: 'AgentJob',
  AgentRun: 'AgentRun',
  AgentRunStep: 'AgentRunStep',
  ApprovalRequest: 'ApprovalRequest',
  BudgetPolicy: 'BudgetPolicy',
  AuditLog: 'AuditLog'
};
/**
 * Create the Client
 */
const config = {
  "generator": {
    "name": "client",
    "provider": {
      "fromEnvVar": null,
      "value": "prisma-client-js"
    },
    "output": {
      "value": "C:\\Users\\Admin\\Downloads\\vectorbee\\apps\\web\\lib\\generated\\prisma",
      "fromEnvVar": null
    },
    "config": {
      "engineType": "library"
    },
    "binaryTargets": [
      {
        "fromEnvVar": null,
        "value": "windows",
        "native": true
      }
    ],
    "previewFeatures": [],
    "sourceFilePath": "C:\\Users\\Admin\\Downloads\\vectorbee\\prisma\\schema.prisma",
    "isCustomOutput": true
  },
  "relativeEnvPaths": {
    "rootEnvPath": null
  },
  "relativePath": "../../../../../prisma",
  "clientVersion": "5.22.0",
  "engineVersion": "605197351a3c8bdd595af2d2a9bc3025bca48ea2",
  "datasourceNames": [
    "db"
  ],
  "activeProvider": "postgresql",
  "postinstall": false,
  "inlineDatasources": {
    "db": {
      "url": {
        "fromEnvVar": "DATABASE_URL",
        "value": null
      }
    }
  },
  "inlineSchema": "// Vectorbea Agent Scheduler — Prisma Schema\n// PostgreSQL + Prisma ORM\n//\n// Prisma client is generated into apps/web/lib/generated/prisma so the\n// Next.js app can import it from \"@/lib/generated/prisma\".\n\ngenerator client {\n  provider = \"prisma-client-js\"\n  output   = \"../apps/web/lib/generated/prisma\"\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\n// ─────────────────────────────────────────────────────────────────────────────\n// Enums\n// ─────────────────────────────────────────────────────────────────────────────\n\nenum UserRole {\n  OWNER\n  ADMIN\n  MEMBER\n  VIEWER\n}\n\nenum JobStatus {\n  ACTIVE\n  PAUSED\n  ARCHIVED\n}\n\nenum TriggerType {\n  MANUAL\n  CRON\n}\n\nenum HttpMethod {\n  GET\n  POST\n  PUT\n  PATCH\n  DELETE\n}\n\nenum RunStatus {\n  QUEUED\n  RUNNING\n  WAITING_FOR_APPROVAL\n  SUCCEEDED\n  FAILED\n  CANCELLED\n  TIMEOUT\n}\n\nenum TriggerSource {\n  MANUAL\n  SCHEDULE\n  RETRY\n}\n\nenum StepType {\n  LLM_CALL\n  TOOL_CALL\n  HTTP_CALL\n  APPROVAL_GATE\n  SYSTEM\n  ERROR\n}\n\nenum StepStatus {\n  PENDING\n  RUNNING\n  SUCCEEDED\n  FAILED\n  SKIPPED\n}\n\nenum ApprovalStatus {\n  PENDING\n  APPROVED\n  REJECTED\n  EXPIRED\n}\n\n// ─────────────────────────────────────────────────────────────────────────────\n// Organization\n// Multi-tenant root. Every other entity is scoped to an Organization.\n// ─────────────────────────────────────────────────────────────────────────────\n\nmodel Organization {\n  id        String   @id @default(cuid())\n  name      String\n  slug      String   @unique\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  // Relations\n  users            User[]\n  agentJobs        AgentJob[]\n  agentRuns        AgentRun[]\n  agentRunSteps    AgentRunStep[]\n  approvalRequests ApprovalRequest[]\n  budgetPolicies   BudgetPolicy[]\n  auditLogs        AuditLog[]\n\n  @@map(\"organizations\")\n}\n\n// ─────────────────────────────────────────────────────────────────────────────\n// User\n// Scoped to an Organization. Auth is handled by Supabase; this record stores\n// profile + role data that Supabase doesn't own.\n// ─────────────────────────────────────────────────────────────────────────────\n\nmodel User {\n  id             String   @id @default(cuid())\n  organizationId String   @map(\"organization_id\")\n  email          String\n  name           String?\n  role           UserRole @default(MEMBER)\n  createdAt      DateTime @default(now()) @map(\"created_at\")\n  updatedAt      DateTime @updatedAt @map(\"updated_at\")\n\n  // Relations\n  organization      Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)\n  createdJobs       AgentJob[]        @relation(\"JobCreatedBy\")\n  approvalDecisions ApprovalRequest[] @relation(\"ApprovalDecidedBy\")\n  auditLogs         AuditLog[]        @relation(\"AuditActor\")\n\n  @@unique([organizationId, email])\n  @@index([organizationId])\n  @@index([email])\n  @@map(\"users\")\n}\n\n// ─────────────────────────────────────────────────────────────────────────────\n// AgentJob\n// A named, configured job definition. Separates \"what to run\" from \"when it ran\".\n// ─────────────────────────────────────────────────────────────────────────────\n\nmodel AgentJob {\n  id             String      @id @default(cuid())\n  organizationId String      @map(\"organization_id\")\n  name           String\n  description    String?\n  status         JobStatus   @default(ACTIVE)\n  triggerType    TriggerType @map(\"trigger_type\")\n\n  // Schedule — only relevant when triggerType = CRON\n  cronExpression String? @map(\"cron_expression\")\n  timezone       String  @default(\"UTC\")\n\n  // Endpoint the worker calls when executing this job\n  endpointUrl String     @map(\"endpoint_url\")\n  httpMethod  HttpMethod @default(POST) @map(\"http_method\")\n  headersJson Json?      @map(\"headers_json\")\n\n  // Execution limits\n  maxDurationSeconds  Int @default(300) @map(\"max_duration_seconds\")\n  maxRetries          Int @default(3) @map(\"max_retries\")\n  retryBackoffSeconds Int @default(60) @map(\"retry_backoff_seconds\")\n\n  // Approval gates\n  requireApprovalBeforeRun            Boolean @default(false) @map(\"require_approval_before_run\")\n  requireApprovalBeforeExternalAction Boolean @default(false) @map(\"require_approval_before_external_action\")\n\n  createdByUserId String   @map(\"created_by_user_id\")\n  createdAt       DateTime @default(now()) @map(\"created_at\")\n  updatedAt       DateTime @updatedAt @map(\"updated_at\")\n\n  // Relations\n  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)\n  createdBy    User          @relation(\"JobCreatedBy\", fields: [createdByUserId], references: [id])\n  runs         AgentRun[]\n  budgetPolicy BudgetPolicy?\n\n  @@index([organizationId])\n  @@index([organizationId, status])\n  // Partial index: only index rows that have a cron expression (scheduling hot path)\n  @@index([cronExpression], map: \"idx_agent_jobs_cron_expression\")\n  @@map(\"agent_jobs\")\n}\n\n// ─────────────────────────────────────────────────────────────────────────────\n// AgentRun\n// A single execution of an AgentJob. Each retry creates a new run with an\n// incremented attemptNumber. idempotencyKey prevents duplicate executions.\n// ─────────────────────────────────────────────────────────────────────────────\n\nmodel AgentRun {\n  id             String        @id @default(cuid())\n  organizationId String        @map(\"organization_id\")\n  agentJobId     String        @map(\"agent_job_id\")\n  status         RunStatus     @default(QUEUED)\n  triggerSource  TriggerSource @map(\"trigger_source\")\n\n  // Timing\n  startedAt  DateTime? @map(\"started_at\")\n  finishedAt DateTime? @map(\"finished_at\")\n  durationMs Int?      @map(\"duration_ms\")\n\n  // Attempt tracking — retries increment this counter\n  attemptNumber  Int    @default(1) @map(\"attempt_number\")\n  idempotencyKey String @map(\"idempotency_key\")\n\n  // Payload\n  inputJson    Json?   @map(\"input_json\")\n  outputJson   Json?   @map(\"output_json\")\n  errorMessage String? @map(\"error_message\")\n\n  // Cost tracking\n  totalTokens      Int?     @map(\"total_tokens\")\n  estimatedCostUsd Decimal? @map(\"estimated_cost_usd\") @db.Decimal(12, 6)\n\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  // Relations\n  organization     Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)\n  agentJob         AgentJob          @relation(fields: [agentJobId], references: [id], onDelete: Cascade)\n  steps            AgentRunStep[]\n  approvalRequests ApprovalRequest[]\n\n  @@unique([agentJobId, idempotencyKey])\n  @@index([organizationId])\n  @@index([agentJobId])\n  @@index([organizationId, status])\n  @@index([createdAt])\n  @@map(\"agent_runs\")\n}\n\n// ─────────────────────────────────────────────────────────────────────────────\n// AgentRunStep\n// Individual steps within a run (LLM calls, tool calls, approval gates, etc.).\n// Enables fine-grained observability and per-step cost attribution.\n// ─────────────────────────────────────────────────────────────────────────────\n\nmodel AgentRunStep {\n  id             String     @id @default(cuid())\n  organizationId String     @map(\"organization_id\")\n  agentRunId     String     @map(\"agent_run_id\")\n  stepIndex      Int        @map(\"step_index\")\n  stepType       StepType   @map(\"step_type\")\n  name           String\n  status         StepStatus @default(PENDING)\n\n  // Payload\n  inputJson    Json?   @map(\"input_json\")\n  outputJson   Json?   @map(\"output_json\")\n  errorMessage String? @map(\"error_message\")\n\n  // Cost\n  tokensUsed       Int?     @map(\"tokens_used\")\n  estimatedCostUsd Decimal? @map(\"estimated_cost_usd\") @db.Decimal(12, 6)\n\n  // Timing\n  startedAt  DateTime? @map(\"started_at\")\n  finishedAt DateTime? @map(\"finished_at\")\n\n  createdAt DateTime @default(now()) @map(\"created_at\")\n\n  // Relations\n  organization     Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)\n  agentRun         AgentRun          @relation(fields: [agentRunId], references: [id], onDelete: Cascade)\n  approvalRequests ApprovalRequest[]\n\n  @@unique([agentRunId, stepIndex])\n  @@index([agentRunId])\n  @@index([organizationId])\n  @@map(\"agent_run_steps\")\n}\n\n// ─────────────────────────────────────────────────────────────────────────────\n// ApprovalRequest\n// Created when a run (or step) requires human sign-off before proceeding.\n// A run in WAITING_FOR_APPROVAL state polls for its open approval request.\n// ─────────────────────────────────────────────────────────────────────────────\n\nmodel ApprovalRequest {\n  id             String         @id @default(cuid())\n  organizationId String         @map(\"organization_id\")\n  agentRunId     String         @map(\"agent_run_id\")\n  agentRunStepId String?        @map(\"agent_run_step_id\")\n  status         ApprovalStatus @default(PENDING)\n\n  title   String\n  message String\n\n  // True when triggered automatically by the system (e.g. external action gate)\n  // False when a human operator created it manually\n  requestedBySystem Boolean  @default(true) @map(\"requested_by_system\")\n  requestedAt       DateTime @default(now()) @map(\"requested_at\")\n\n  // Decision\n  decidedAt       DateTime? @map(\"decided_at\")\n  decidedByUserId String?   @map(\"decided_by_user_id\")\n  decisionReason  String?   @map(\"decision_reason\")\n\n  // Relations\n  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)\n  agentRun     AgentRun      @relation(fields: [agentRunId], references: [id], onDelete: Cascade)\n  agentRunStep AgentRunStep? @relation(fields: [agentRunStepId], references: [id], onDelete: SetNull)\n  decidedBy    User?         @relation(\"ApprovalDecidedBy\", fields: [decidedByUserId], references: [id], onDelete: SetNull)\n\n  @@index([organizationId])\n  @@index([agentRunId])\n  @@index([organizationId, status])\n  @@map(\"approval_requests\")\n}\n\n// ─────────────────────────────────────────────────────────────────────────────\n// BudgetPolicy\n// Per-job cost controls. The worker enforces these before and during execution.\n// One-to-one with AgentJob.\n// ─────────────────────────────────────────────────────────────────────────────\n\nmodel BudgetPolicy {\n  id             String @id @default(cuid())\n  organizationId String @map(\"organization_id\")\n  agentJobId     String @unique @map(\"agent_job_id\")\n\n  maxTokensPerRun  Int?     @map(\"max_tokens_per_run\")\n  maxCostUsdPerRun Decimal? @map(\"max_cost_usd_per_run\") @db.Decimal(12, 6)\n  maxRunsPerDay    Int?     @map(\"max_runs_per_day\")\n  maxRunsPerMonth  Int?     @map(\"max_runs_per_month\")\n\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  // Relations\n  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)\n  agentJob     AgentJob     @relation(fields: [agentJobId], references: [id], onDelete: Cascade)\n\n  @@index([organizationId])\n  @@map(\"budget_policies\")\n}\n\n// ─────────────────────────────────────────────────────────────────────────────\n// AuditLog\n// Immutable append-only record of all significant actions in the system.\n// actorUserId is null for system-initiated actions (scheduler, worker).\n// ─────────────────────────────────────────────────────────────────────────────\n\nmodel AuditLog {\n  id             String  @id @default(cuid())\n  organizationId String  @map(\"organization_id\")\n  actorUserId    String? @map(\"actor_user_id\")\n\n  // What was acted on\n  entityType String @map(\"entity_type\")\n  entityId   String @map(\"entity_id\")\n\n  // What happened (e.g. \"job.created\", \"run.started\", \"approval.rejected\")\n  action String\n\n  // Arbitrary context — keep it small, store IDs not full objects\n  metadataJson Json? @map(\"metadata_json\")\n\n  createdAt DateTime @default(now()) @map(\"created_at\")\n\n  // Relations\n  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)\n  actor        User?        @relation(\"AuditActor\", fields: [actorUserId], references: [id], onDelete: SetNull)\n\n  @@index([organizationId])\n  @@index([organizationId, entityType, entityId])\n  @@index([organizationId, createdAt])\n  @@map(\"audit_logs\")\n}\n",
  "inlineSchemaHash": "e929f00072daf75feca7d4027337cb19d193fbf4e918f82621c79013074cf511",
  "copyEngine": true
}
config.dirname = '/'

config.runtimeDataModel = JSON.parse("{\"models\":{\"Organization\":{\"dbName\":\"organizations\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"cuid\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"slug\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"users\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"User\",\"relationName\":\"OrganizationToUser\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentJobs\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentJob\",\"relationName\":\"AgentJobToOrganization\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentRuns\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentRun\",\"relationName\":\"AgentRunToOrganization\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentRunSteps\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentRunStep\",\"relationName\":\"AgentRunStepToOrganization\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvalRequests\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ApprovalRequest\",\"relationName\":\"ApprovalRequestToOrganization\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"budgetPolicies\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"BudgetPolicy\",\"relationName\":\"BudgetPolicyToOrganization\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"auditLogs\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AuditLog\",\"relationName\":\"AuditLogToOrganization\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"User\":{\"dbName\":\"users\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"cuid\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"organizationId\",\"dbName\":\"organization_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"email\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"role\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"UserRole\",\"default\":\"MEMBER\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"organization\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Organization\",\"relationName\":\"OrganizationToUser\",\"relationFromFields\":[\"organizationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdJobs\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentJob\",\"relationName\":\"JobCreatedBy\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvalDecisions\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ApprovalRequest\",\"relationName\":\"ApprovalDecidedBy\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"auditLogs\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AuditLog\",\"relationName\":\"AuditActor\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"organizationId\",\"email\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"organizationId\",\"email\"]}],\"isGenerated\":false},\"AgentJob\":{\"dbName\":\"agent_jobs\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"cuid\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"organizationId\",\"dbName\":\"organization_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"JobStatus\",\"default\":\"ACTIVE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"triggerType\",\"dbName\":\"trigger_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"TriggerType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"cronExpression\",\"dbName\":\"cron_expression\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"timezone\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"UTC\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"endpointUrl\",\"dbName\":\"endpoint_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"httpMethod\",\"dbName\":\"http_method\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"HttpMethod\",\"default\":\"POST\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"headersJson\",\"dbName\":\"headers_json\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"maxDurationSeconds\",\"dbName\":\"max_duration_seconds\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":300,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"maxRetries\",\"dbName\":\"max_retries\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":3,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"retryBackoffSeconds\",\"dbName\":\"retry_backoff_seconds\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":60,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"requireApprovalBeforeRun\",\"dbName\":\"require_approval_before_run\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"requireApprovalBeforeExternalAction\",\"dbName\":\"require_approval_before_external_action\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdByUserId\",\"dbName\":\"created_by_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"organization\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Organization\",\"relationName\":\"AgentJobToOrganization\",\"relationFromFields\":[\"organizationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdBy\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"User\",\"relationName\":\"JobCreatedBy\",\"relationFromFields\":[\"createdByUserId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"runs\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentRun\",\"relationName\":\"AgentJobToAgentRun\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"budgetPolicy\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"BudgetPolicy\",\"relationName\":\"AgentJobToBudgetPolicy\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"AgentRun\":{\"dbName\":\"agent_runs\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"cuid\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"organizationId\",\"dbName\":\"organization_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentJobId\",\"dbName\":\"agent_job_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"RunStatus\",\"default\":\"QUEUED\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"triggerSource\",\"dbName\":\"trigger_source\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"TriggerSource\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"startedAt\",\"dbName\":\"started_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"finishedAt\",\"dbName\":\"finished_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"durationMs\",\"dbName\":\"duration_ms\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"attemptNumber\",\"dbName\":\"attempt_number\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":1,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"idempotencyKey\",\"dbName\":\"idempotency_key\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"inputJson\",\"dbName\":\"input_json\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"outputJson\",\"dbName\":\"output_json\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"errorMessage\",\"dbName\":\"error_message\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"totalTokens\",\"dbName\":\"total_tokens\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"estimatedCostUsd\",\"dbName\":\"estimated_cost_usd\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"organization\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Organization\",\"relationName\":\"AgentRunToOrganization\",\"relationFromFields\":[\"organizationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentJob\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentJob\",\"relationName\":\"AgentJobToAgentRun\",\"relationFromFields\":[\"agentJobId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"steps\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentRunStep\",\"relationName\":\"AgentRunToAgentRunStep\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvalRequests\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ApprovalRequest\",\"relationName\":\"AgentRunToApprovalRequest\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"agentJobId\",\"idempotencyKey\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"agentJobId\",\"idempotencyKey\"]}],\"isGenerated\":false},\"AgentRunStep\":{\"dbName\":\"agent_run_steps\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"cuid\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"organizationId\",\"dbName\":\"organization_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentRunId\",\"dbName\":\"agent_run_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"stepIndex\",\"dbName\":\"step_index\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"stepType\",\"dbName\":\"step_type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"StepType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"StepStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"inputJson\",\"dbName\":\"input_json\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"outputJson\",\"dbName\":\"output_json\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"errorMessage\",\"dbName\":\"error_message\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"tokensUsed\",\"dbName\":\"tokens_used\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"estimatedCostUsd\",\"dbName\":\"estimated_cost_usd\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"startedAt\",\"dbName\":\"started_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"finishedAt\",\"dbName\":\"finished_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"organization\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Organization\",\"relationName\":\"AgentRunStepToOrganization\",\"relationFromFields\":[\"organizationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentRun\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentRun\",\"relationName\":\"AgentRunToAgentRunStep\",\"relationFromFields\":[\"agentRunId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"approvalRequests\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ApprovalRequest\",\"relationName\":\"AgentRunStepToApprovalRequest\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"agentRunId\",\"stepIndex\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"agentRunId\",\"stepIndex\"]}],\"isGenerated\":false},\"ApprovalRequest\":{\"dbName\":\"approval_requests\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"cuid\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"organizationId\",\"dbName\":\"organization_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentRunId\",\"dbName\":\"agent_run_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentRunStepId\",\"dbName\":\"agent_run_step_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"ApprovalStatus\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"title\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"message\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"requestedBySystem\",\"dbName\":\"requested_by_system\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":true,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"requestedAt\",\"dbName\":\"requested_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"decidedAt\",\"dbName\":\"decided_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"decidedByUserId\",\"dbName\":\"decided_by_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"decisionReason\",\"dbName\":\"decision_reason\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"organization\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Organization\",\"relationName\":\"ApprovalRequestToOrganization\",\"relationFromFields\":[\"organizationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentRun\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentRun\",\"relationName\":\"AgentRunToApprovalRequest\",\"relationFromFields\":[\"agentRunId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentRunStep\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentRunStep\",\"relationName\":\"AgentRunStepToApprovalRequest\",\"relationFromFields\":[\"agentRunStepId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"SetNull\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"decidedBy\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"User\",\"relationName\":\"ApprovalDecidedBy\",\"relationFromFields\":[\"decidedByUserId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"SetNull\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"BudgetPolicy\":{\"dbName\":\"budget_policies\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"cuid\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"organizationId\",\"dbName\":\"organization_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentJobId\",\"dbName\":\"agent_job_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"maxTokensPerRun\",\"dbName\":\"max_tokens_per_run\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"maxCostUsdPerRun\",\"dbName\":\"max_cost_usd_per_run\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Decimal\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"maxRunsPerDay\",\"dbName\":\"max_runs_per_day\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"maxRunsPerMonth\",\"dbName\":\"max_runs_per_month\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"organization\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Organization\",\"relationName\":\"BudgetPolicyToOrganization\",\"relationFromFields\":[\"organizationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"agentJob\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"AgentJob\",\"relationName\":\"AgentJobToBudgetPolicy\",\"relationFromFields\":[\"agentJobId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"AuditLog\":{\"dbName\":\"audit_logs\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"cuid\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"organizationId\",\"dbName\":\"organization_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"actorUserId\",\"dbName\":\"actor_user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"entityType\",\"dbName\":\"entity_type\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"entityId\",\"dbName\":\"entity_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"action\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"metadataJson\",\"dbName\":\"metadata_json\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Json\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"organization\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Organization\",\"relationName\":\"AuditLogToOrganization\",\"relationFromFields\":[\"organizationId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"actor\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"User\",\"relationName\":\"AuditActor\",\"relationFromFields\":[\"actorUserId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"SetNull\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false}},\"enums\":{\"UserRole\":{\"values\":[{\"name\":\"OWNER\",\"dbName\":null},{\"name\":\"ADMIN\",\"dbName\":null},{\"name\":\"MEMBER\",\"dbName\":null},{\"name\":\"VIEWER\",\"dbName\":null}],\"dbName\":null},\"JobStatus\":{\"values\":[{\"name\":\"ACTIVE\",\"dbName\":null},{\"name\":\"PAUSED\",\"dbName\":null},{\"name\":\"ARCHIVED\",\"dbName\":null}],\"dbName\":null},\"TriggerType\":{\"values\":[{\"name\":\"MANUAL\",\"dbName\":null},{\"name\":\"CRON\",\"dbName\":null}],\"dbName\":null},\"HttpMethod\":{\"values\":[{\"name\":\"GET\",\"dbName\":null},{\"name\":\"POST\",\"dbName\":null},{\"name\":\"PUT\",\"dbName\":null},{\"name\":\"PATCH\",\"dbName\":null},{\"name\":\"DELETE\",\"dbName\":null}],\"dbName\":null},\"RunStatus\":{\"values\":[{\"name\":\"QUEUED\",\"dbName\":null},{\"name\":\"RUNNING\",\"dbName\":null},{\"name\":\"WAITING_FOR_APPROVAL\",\"dbName\":null},{\"name\":\"SUCCEEDED\",\"dbName\":null},{\"name\":\"FAILED\",\"dbName\":null},{\"name\":\"CANCELLED\",\"dbName\":null},{\"name\":\"TIMEOUT\",\"dbName\":null}],\"dbName\":null},\"TriggerSource\":{\"values\":[{\"name\":\"MANUAL\",\"dbName\":null},{\"name\":\"SCHEDULE\",\"dbName\":null},{\"name\":\"RETRY\",\"dbName\":null}],\"dbName\":null},\"StepType\":{\"values\":[{\"name\":\"LLM_CALL\",\"dbName\":null},{\"name\":\"TOOL_CALL\",\"dbName\":null},{\"name\":\"HTTP_CALL\",\"dbName\":null},{\"name\":\"APPROVAL_GATE\",\"dbName\":null},{\"name\":\"SYSTEM\",\"dbName\":null},{\"name\":\"ERROR\",\"dbName\":null}],\"dbName\":null},\"StepStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"RUNNING\",\"dbName\":null},{\"name\":\"SUCCEEDED\",\"dbName\":null},{\"name\":\"FAILED\",\"dbName\":null},{\"name\":\"SKIPPED\",\"dbName\":null}],\"dbName\":null},\"ApprovalStatus\":{\"values\":[{\"name\":\"PENDING\",\"dbName\":null},{\"name\":\"APPROVED\",\"dbName\":null},{\"name\":\"REJECTED\",\"dbName\":null},{\"name\":\"EXPIRED\",\"dbName\":null}],\"dbName\":null}},\"types\":{}}")
defineDmmfProperty(exports.Prisma, config.runtimeDataModel)
config.engineWasm = undefined

config.injectableEdgeEnv = () => ({
  parsed: {
    DATABASE_URL: typeof globalThis !== 'undefined' && globalThis['DATABASE_URL'] || typeof process !== 'undefined' && process.env && process.env.DATABASE_URL || undefined
  }
})

if (typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined) {
  Debug.enable(typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined)
}

const PrismaClient = getPrismaClient(config)
exports.PrismaClient = PrismaClient
Object.assign(exports, Prisma)

