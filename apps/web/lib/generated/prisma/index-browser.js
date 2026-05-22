
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


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

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

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
  originalRunId: 'originalRunId',
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
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
