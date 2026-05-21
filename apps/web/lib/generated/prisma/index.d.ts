
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model Organization
 * 
 */
export type Organization = $Result.DefaultSelection<Prisma.$OrganizationPayload>
/**
 * Model User
 * 
 */
export type User = $Result.DefaultSelection<Prisma.$UserPayload>
/**
 * Model AgentJob
 * 
 */
export type AgentJob = $Result.DefaultSelection<Prisma.$AgentJobPayload>
/**
 * Model AgentRun
 * 
 */
export type AgentRun = $Result.DefaultSelection<Prisma.$AgentRunPayload>
/**
 * Model AgentRunStep
 * 
 */
export type AgentRunStep = $Result.DefaultSelection<Prisma.$AgentRunStepPayload>
/**
 * Model ApprovalRequest
 * 
 */
export type ApprovalRequest = $Result.DefaultSelection<Prisma.$ApprovalRequestPayload>
/**
 * Model BudgetPolicy
 * 
 */
export type BudgetPolicy = $Result.DefaultSelection<Prisma.$BudgetPolicyPayload>
/**
 * Model AuditLog
 * 
 */
export type AuditLog = $Result.DefaultSelection<Prisma.$AuditLogPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const UserRole: {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER'
};

export type UserRole = (typeof UserRole)[keyof typeof UserRole]


export const JobStatus: {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED'
};

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus]


export const TriggerType: {
  MANUAL: 'MANUAL',
  CRON: 'CRON'
};

export type TriggerType = (typeof TriggerType)[keyof typeof TriggerType]


export const HttpMethod: {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE'
};

export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod]


export const RunStatus: {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMEOUT: 'TIMEOUT'
};

export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus]


export const TriggerSource: {
  MANUAL: 'MANUAL',
  SCHEDULE: 'SCHEDULE',
  RETRY: 'RETRY'
};

export type TriggerSource = (typeof TriggerSource)[keyof typeof TriggerSource]


export const StepType: {
  LLM_CALL: 'LLM_CALL',
  TOOL_CALL: 'TOOL_CALL',
  HTTP_CALL: 'HTTP_CALL',
  APPROVAL_GATE: 'APPROVAL_GATE',
  SYSTEM: 'SYSTEM',
  ERROR: 'ERROR'
};

export type StepType = (typeof StepType)[keyof typeof StepType]


export const StepStatus: {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'
};

export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus]


export const ApprovalStatus: {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED'
};

export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus]

}

export type UserRole = $Enums.UserRole

export const UserRole: typeof $Enums.UserRole

export type JobStatus = $Enums.JobStatus

export const JobStatus: typeof $Enums.JobStatus

export type TriggerType = $Enums.TriggerType

export const TriggerType: typeof $Enums.TriggerType

export type HttpMethod = $Enums.HttpMethod

export const HttpMethod: typeof $Enums.HttpMethod

export type RunStatus = $Enums.RunStatus

export const RunStatus: typeof $Enums.RunStatus

export type TriggerSource = $Enums.TriggerSource

export const TriggerSource: typeof $Enums.TriggerSource

export type StepType = $Enums.StepType

export const StepType: typeof $Enums.StepType

export type StepStatus = $Enums.StepStatus

export const StepStatus: typeof $Enums.StepStatus

export type ApprovalStatus = $Enums.ApprovalStatus

export const ApprovalStatus: typeof $Enums.ApprovalStatus

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Organizations
 * const organizations = await prisma.organization.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Organizations
   * const organizations = await prisma.organization.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb, ExtArgs>

      /**
   * `prisma.organization`: Exposes CRUD operations for the **Organization** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Organizations
    * const organizations = await prisma.organization.findMany()
    * ```
    */
  get organization(): Prisma.OrganizationDelegate<ExtArgs>;

  /**
   * `prisma.user`: Exposes CRUD operations for the **User** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Users
    * const users = await prisma.user.findMany()
    * ```
    */
  get user(): Prisma.UserDelegate<ExtArgs>;

  /**
   * `prisma.agentJob`: Exposes CRUD operations for the **AgentJob** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more AgentJobs
    * const agentJobs = await prisma.agentJob.findMany()
    * ```
    */
  get agentJob(): Prisma.AgentJobDelegate<ExtArgs>;

  /**
   * `prisma.agentRun`: Exposes CRUD operations for the **AgentRun** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more AgentRuns
    * const agentRuns = await prisma.agentRun.findMany()
    * ```
    */
  get agentRun(): Prisma.AgentRunDelegate<ExtArgs>;

  /**
   * `prisma.agentRunStep`: Exposes CRUD operations for the **AgentRunStep** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more AgentRunSteps
    * const agentRunSteps = await prisma.agentRunStep.findMany()
    * ```
    */
  get agentRunStep(): Prisma.AgentRunStepDelegate<ExtArgs>;

  /**
   * `prisma.approvalRequest`: Exposes CRUD operations for the **ApprovalRequest** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more ApprovalRequests
    * const approvalRequests = await prisma.approvalRequest.findMany()
    * ```
    */
  get approvalRequest(): Prisma.ApprovalRequestDelegate<ExtArgs>;

  /**
   * `prisma.budgetPolicy`: Exposes CRUD operations for the **BudgetPolicy** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more BudgetPolicies
    * const budgetPolicies = await prisma.budgetPolicy.findMany()
    * ```
    */
  get budgetPolicy(): Prisma.BudgetPolicyDelegate<ExtArgs>;

  /**
   * `prisma.auditLog`: Exposes CRUD operations for the **AuditLog** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more AuditLogs
    * const auditLogs = await prisma.auditLog.findMany()
    * ```
    */
  get auditLog(): Prisma.AuditLogDelegate<ExtArgs>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 5.22.0
   * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    Organization: 'Organization',
    User: 'User',
    AgentJob: 'AgentJob',
    AgentRun: 'AgentRun',
    AgentRunStep: 'AgentRunStep',
    ApprovalRequest: 'ApprovalRequest',
    BudgetPolicy: 'BudgetPolicy',
    AuditLog: 'AuditLog'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb extends $Utils.Fn<{extArgs: $Extensions.InternalArgs, clientOptions: PrismaClientOptions }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], this['params']['clientOptions']>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, ClientOptions = {}> = {
    meta: {
      modelProps: "organization" | "user" | "agentJob" | "agentRun" | "agentRunStep" | "approvalRequest" | "budgetPolicy" | "auditLog"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Organization: {
        payload: Prisma.$OrganizationPayload<ExtArgs>
        fields: Prisma.OrganizationFieldRefs
        operations: {
          findUnique: {
            args: Prisma.OrganizationFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.OrganizationFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          findFirst: {
            args: Prisma.OrganizationFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.OrganizationFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          findMany: {
            args: Prisma.OrganizationFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>[]
          }
          create: {
            args: Prisma.OrganizationCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          createMany: {
            args: Prisma.OrganizationCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.OrganizationCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>[]
          }
          delete: {
            args: Prisma.OrganizationDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          update: {
            args: Prisma.OrganizationUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          deleteMany: {
            args: Prisma.OrganizationDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.OrganizationUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.OrganizationUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          aggregate: {
            args: Prisma.OrganizationAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateOrganization>
          }
          groupBy: {
            args: Prisma.OrganizationGroupByArgs<ExtArgs>
            result: $Utils.Optional<OrganizationGroupByOutputType>[]
          }
          count: {
            args: Prisma.OrganizationCountArgs<ExtArgs>
            result: $Utils.Optional<OrganizationCountAggregateOutputType> | number
          }
        }
      }
      User: {
        payload: Prisma.$UserPayload<ExtArgs>
        fields: Prisma.UserFieldRefs
        operations: {
          findUnique: {
            args: Prisma.UserFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.UserFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findFirst: {
            args: Prisma.UserFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.UserFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findMany: {
            args: Prisma.UserFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          create: {
            args: Prisma.UserCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          createMany: {
            args: Prisma.UserCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.UserCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          delete: {
            args: Prisma.UserDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          update: {
            args: Prisma.UserUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          deleteMany: {
            args: Prisma.UserDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.UserUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.UserUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          aggregate: {
            args: Prisma.UserAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateUser>
          }
          groupBy: {
            args: Prisma.UserGroupByArgs<ExtArgs>
            result: $Utils.Optional<UserGroupByOutputType>[]
          }
          count: {
            args: Prisma.UserCountArgs<ExtArgs>
            result: $Utils.Optional<UserCountAggregateOutputType> | number
          }
        }
      }
      AgentJob: {
        payload: Prisma.$AgentJobPayload<ExtArgs>
        fields: Prisma.AgentJobFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AgentJobFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentJobPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AgentJobFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentJobPayload>
          }
          findFirst: {
            args: Prisma.AgentJobFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentJobPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AgentJobFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentJobPayload>
          }
          findMany: {
            args: Prisma.AgentJobFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentJobPayload>[]
          }
          create: {
            args: Prisma.AgentJobCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentJobPayload>
          }
          createMany: {
            args: Prisma.AgentJobCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AgentJobCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentJobPayload>[]
          }
          delete: {
            args: Prisma.AgentJobDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentJobPayload>
          }
          update: {
            args: Prisma.AgentJobUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentJobPayload>
          }
          deleteMany: {
            args: Prisma.AgentJobDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AgentJobUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.AgentJobUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentJobPayload>
          }
          aggregate: {
            args: Prisma.AgentJobAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgentJob>
          }
          groupBy: {
            args: Prisma.AgentJobGroupByArgs<ExtArgs>
            result: $Utils.Optional<AgentJobGroupByOutputType>[]
          }
          count: {
            args: Prisma.AgentJobCountArgs<ExtArgs>
            result: $Utils.Optional<AgentJobCountAggregateOutputType> | number
          }
        }
      }
      AgentRun: {
        payload: Prisma.$AgentRunPayload<ExtArgs>
        fields: Prisma.AgentRunFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AgentRunFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AgentRunFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          findFirst: {
            args: Prisma.AgentRunFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AgentRunFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          findMany: {
            args: Prisma.AgentRunFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>[]
          }
          create: {
            args: Prisma.AgentRunCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          createMany: {
            args: Prisma.AgentRunCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AgentRunCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>[]
          }
          delete: {
            args: Prisma.AgentRunDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          update: {
            args: Prisma.AgentRunUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          deleteMany: {
            args: Prisma.AgentRunDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AgentRunUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.AgentRunUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          aggregate: {
            args: Prisma.AgentRunAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgentRun>
          }
          groupBy: {
            args: Prisma.AgentRunGroupByArgs<ExtArgs>
            result: $Utils.Optional<AgentRunGroupByOutputType>[]
          }
          count: {
            args: Prisma.AgentRunCountArgs<ExtArgs>
            result: $Utils.Optional<AgentRunCountAggregateOutputType> | number
          }
        }
      }
      AgentRunStep: {
        payload: Prisma.$AgentRunStepPayload<ExtArgs>
        fields: Prisma.AgentRunStepFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AgentRunStepFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunStepPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AgentRunStepFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunStepPayload>
          }
          findFirst: {
            args: Prisma.AgentRunStepFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunStepPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AgentRunStepFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunStepPayload>
          }
          findMany: {
            args: Prisma.AgentRunStepFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunStepPayload>[]
          }
          create: {
            args: Prisma.AgentRunStepCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunStepPayload>
          }
          createMany: {
            args: Prisma.AgentRunStepCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AgentRunStepCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunStepPayload>[]
          }
          delete: {
            args: Prisma.AgentRunStepDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunStepPayload>
          }
          update: {
            args: Prisma.AgentRunStepUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunStepPayload>
          }
          deleteMany: {
            args: Prisma.AgentRunStepDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AgentRunStepUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.AgentRunStepUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunStepPayload>
          }
          aggregate: {
            args: Prisma.AgentRunStepAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgentRunStep>
          }
          groupBy: {
            args: Prisma.AgentRunStepGroupByArgs<ExtArgs>
            result: $Utils.Optional<AgentRunStepGroupByOutputType>[]
          }
          count: {
            args: Prisma.AgentRunStepCountArgs<ExtArgs>
            result: $Utils.Optional<AgentRunStepCountAggregateOutputType> | number
          }
        }
      }
      ApprovalRequest: {
        payload: Prisma.$ApprovalRequestPayload<ExtArgs>
        fields: Prisma.ApprovalRequestFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ApprovalRequestFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ApprovalRequestPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ApprovalRequestFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ApprovalRequestPayload>
          }
          findFirst: {
            args: Prisma.ApprovalRequestFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ApprovalRequestPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ApprovalRequestFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ApprovalRequestPayload>
          }
          findMany: {
            args: Prisma.ApprovalRequestFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ApprovalRequestPayload>[]
          }
          create: {
            args: Prisma.ApprovalRequestCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ApprovalRequestPayload>
          }
          createMany: {
            args: Prisma.ApprovalRequestCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ApprovalRequestCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ApprovalRequestPayload>[]
          }
          delete: {
            args: Prisma.ApprovalRequestDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ApprovalRequestPayload>
          }
          update: {
            args: Prisma.ApprovalRequestUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ApprovalRequestPayload>
          }
          deleteMany: {
            args: Prisma.ApprovalRequestDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ApprovalRequestUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ApprovalRequestUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ApprovalRequestPayload>
          }
          aggregate: {
            args: Prisma.ApprovalRequestAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateApprovalRequest>
          }
          groupBy: {
            args: Prisma.ApprovalRequestGroupByArgs<ExtArgs>
            result: $Utils.Optional<ApprovalRequestGroupByOutputType>[]
          }
          count: {
            args: Prisma.ApprovalRequestCountArgs<ExtArgs>
            result: $Utils.Optional<ApprovalRequestCountAggregateOutputType> | number
          }
        }
      }
      BudgetPolicy: {
        payload: Prisma.$BudgetPolicyPayload<ExtArgs>
        fields: Prisma.BudgetPolicyFieldRefs
        operations: {
          findUnique: {
            args: Prisma.BudgetPolicyFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BudgetPolicyPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.BudgetPolicyFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BudgetPolicyPayload>
          }
          findFirst: {
            args: Prisma.BudgetPolicyFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BudgetPolicyPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.BudgetPolicyFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BudgetPolicyPayload>
          }
          findMany: {
            args: Prisma.BudgetPolicyFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BudgetPolicyPayload>[]
          }
          create: {
            args: Prisma.BudgetPolicyCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BudgetPolicyPayload>
          }
          createMany: {
            args: Prisma.BudgetPolicyCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.BudgetPolicyCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BudgetPolicyPayload>[]
          }
          delete: {
            args: Prisma.BudgetPolicyDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BudgetPolicyPayload>
          }
          update: {
            args: Prisma.BudgetPolicyUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BudgetPolicyPayload>
          }
          deleteMany: {
            args: Prisma.BudgetPolicyDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.BudgetPolicyUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.BudgetPolicyUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BudgetPolicyPayload>
          }
          aggregate: {
            args: Prisma.BudgetPolicyAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateBudgetPolicy>
          }
          groupBy: {
            args: Prisma.BudgetPolicyGroupByArgs<ExtArgs>
            result: $Utils.Optional<BudgetPolicyGroupByOutputType>[]
          }
          count: {
            args: Prisma.BudgetPolicyCountArgs<ExtArgs>
            result: $Utils.Optional<BudgetPolicyCountAggregateOutputType> | number
          }
        }
      }
      AuditLog: {
        payload: Prisma.$AuditLogPayload<ExtArgs>
        fields: Prisma.AuditLogFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AuditLogFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AuditLogFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          findFirst: {
            args: Prisma.AuditLogFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AuditLogFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          findMany: {
            args: Prisma.AuditLogFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>[]
          }
          create: {
            args: Prisma.AuditLogCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          createMany: {
            args: Prisma.AuditLogCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AuditLogCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>[]
          }
          delete: {
            args: Prisma.AuditLogDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          update: {
            args: Prisma.AuditLogUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          deleteMany: {
            args: Prisma.AuditLogDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AuditLogUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.AuditLogUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          aggregate: {
            args: Prisma.AuditLogAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAuditLog>
          }
          groupBy: {
            args: Prisma.AuditLogGroupByArgs<ExtArgs>
            result: $Utils.Optional<AuditLogGroupByOutputType>[]
          }
          count: {
            args: Prisma.AuditLogCountArgs<ExtArgs>
            result: $Utils.Optional<AuditLogCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
  }


  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type OrganizationCountOutputType
   */

  export type OrganizationCountOutputType = {
    users: number
    agentJobs: number
    agentRuns: number
    agentRunSteps: number
    approvalRequests: number
    budgetPolicies: number
    auditLogs: number
  }

  export type OrganizationCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    users?: boolean | OrganizationCountOutputTypeCountUsersArgs
    agentJobs?: boolean | OrganizationCountOutputTypeCountAgentJobsArgs
    agentRuns?: boolean | OrganizationCountOutputTypeCountAgentRunsArgs
    agentRunSteps?: boolean | OrganizationCountOutputTypeCountAgentRunStepsArgs
    approvalRequests?: boolean | OrganizationCountOutputTypeCountApprovalRequestsArgs
    budgetPolicies?: boolean | OrganizationCountOutputTypeCountBudgetPoliciesArgs
    auditLogs?: boolean | OrganizationCountOutputTypeCountAuditLogsArgs
  }

  // Custom InputTypes
  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationCountOutputType
     */
    select?: OrganizationCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeCountUsersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserWhereInput
  }

  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeCountAgentJobsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentJobWhereInput
  }

  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeCountAgentRunsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentRunWhereInput
  }

  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeCountAgentRunStepsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentRunStepWhereInput
  }

  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeCountApprovalRequestsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ApprovalRequestWhereInput
  }

  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeCountBudgetPoliciesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: BudgetPolicyWhereInput
  }

  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeCountAuditLogsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AuditLogWhereInput
  }


  /**
   * Count Type UserCountOutputType
   */

  export type UserCountOutputType = {
    createdJobs: number
    approvalDecisions: number
    auditLogs: number
  }

  export type UserCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    createdJobs?: boolean | UserCountOutputTypeCountCreatedJobsArgs
    approvalDecisions?: boolean | UserCountOutputTypeCountApprovalDecisionsArgs
    auditLogs?: boolean | UserCountOutputTypeCountAuditLogsArgs
  }

  // Custom InputTypes
  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserCountOutputType
     */
    select?: UserCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountCreatedJobsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentJobWhereInput
  }

  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountApprovalDecisionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ApprovalRequestWhereInput
  }

  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountAuditLogsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AuditLogWhereInput
  }


  /**
   * Count Type AgentJobCountOutputType
   */

  export type AgentJobCountOutputType = {
    runs: number
  }

  export type AgentJobCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    runs?: boolean | AgentJobCountOutputTypeCountRunsArgs
  }

  // Custom InputTypes
  /**
   * AgentJobCountOutputType without action
   */
  export type AgentJobCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJobCountOutputType
     */
    select?: AgentJobCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * AgentJobCountOutputType without action
   */
  export type AgentJobCountOutputTypeCountRunsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentRunWhereInput
  }


  /**
   * Count Type AgentRunCountOutputType
   */

  export type AgentRunCountOutputType = {
    steps: number
    approvalRequests: number
  }

  export type AgentRunCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    steps?: boolean | AgentRunCountOutputTypeCountStepsArgs
    approvalRequests?: boolean | AgentRunCountOutputTypeCountApprovalRequestsArgs
  }

  // Custom InputTypes
  /**
   * AgentRunCountOutputType without action
   */
  export type AgentRunCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunCountOutputType
     */
    select?: AgentRunCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * AgentRunCountOutputType without action
   */
  export type AgentRunCountOutputTypeCountStepsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentRunStepWhereInput
  }

  /**
   * AgentRunCountOutputType without action
   */
  export type AgentRunCountOutputTypeCountApprovalRequestsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ApprovalRequestWhereInput
  }


  /**
   * Count Type AgentRunStepCountOutputType
   */

  export type AgentRunStepCountOutputType = {
    approvalRequests: number
  }

  export type AgentRunStepCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    approvalRequests?: boolean | AgentRunStepCountOutputTypeCountApprovalRequestsArgs
  }

  // Custom InputTypes
  /**
   * AgentRunStepCountOutputType without action
   */
  export type AgentRunStepCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStepCountOutputType
     */
    select?: AgentRunStepCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * AgentRunStepCountOutputType without action
   */
  export type AgentRunStepCountOutputTypeCountApprovalRequestsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ApprovalRequestWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Organization
   */

  export type AggregateOrganization = {
    _count: OrganizationCountAggregateOutputType | null
    _min: OrganizationMinAggregateOutputType | null
    _max: OrganizationMaxAggregateOutputType | null
  }

  export type OrganizationMinAggregateOutputType = {
    id: string | null
    name: string | null
    slug: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type OrganizationMaxAggregateOutputType = {
    id: string | null
    name: string | null
    slug: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type OrganizationCountAggregateOutputType = {
    id: number
    name: number
    slug: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type OrganizationMinAggregateInputType = {
    id?: true
    name?: true
    slug?: true
    createdAt?: true
    updatedAt?: true
  }

  export type OrganizationMaxAggregateInputType = {
    id?: true
    name?: true
    slug?: true
    createdAt?: true
    updatedAt?: true
  }

  export type OrganizationCountAggregateInputType = {
    id?: true
    name?: true
    slug?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type OrganizationAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Organization to aggregate.
     */
    where?: OrganizationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Organizations to fetch.
     */
    orderBy?: OrganizationOrderByWithRelationInput | OrganizationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: OrganizationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Organizations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Organizations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Organizations
    **/
    _count?: true | OrganizationCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: OrganizationMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: OrganizationMaxAggregateInputType
  }

  export type GetOrganizationAggregateType<T extends OrganizationAggregateArgs> = {
        [P in keyof T & keyof AggregateOrganization]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateOrganization[P]>
      : GetScalarType<T[P], AggregateOrganization[P]>
  }




  export type OrganizationGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: OrganizationWhereInput
    orderBy?: OrganizationOrderByWithAggregationInput | OrganizationOrderByWithAggregationInput[]
    by: OrganizationScalarFieldEnum[] | OrganizationScalarFieldEnum
    having?: OrganizationScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: OrganizationCountAggregateInputType | true
    _min?: OrganizationMinAggregateInputType
    _max?: OrganizationMaxAggregateInputType
  }

  export type OrganizationGroupByOutputType = {
    id: string
    name: string
    slug: string
    createdAt: Date
    updatedAt: Date
    _count: OrganizationCountAggregateOutputType | null
    _min: OrganizationMinAggregateOutputType | null
    _max: OrganizationMaxAggregateOutputType | null
  }

  type GetOrganizationGroupByPayload<T extends OrganizationGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<OrganizationGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof OrganizationGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], OrganizationGroupByOutputType[P]>
            : GetScalarType<T[P], OrganizationGroupByOutputType[P]>
        }
      >
    >


  export type OrganizationSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    slug?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    users?: boolean | Organization$usersArgs<ExtArgs>
    agentJobs?: boolean | Organization$agentJobsArgs<ExtArgs>
    agentRuns?: boolean | Organization$agentRunsArgs<ExtArgs>
    agentRunSteps?: boolean | Organization$agentRunStepsArgs<ExtArgs>
    approvalRequests?: boolean | Organization$approvalRequestsArgs<ExtArgs>
    budgetPolicies?: boolean | Organization$budgetPoliciesArgs<ExtArgs>
    auditLogs?: boolean | Organization$auditLogsArgs<ExtArgs>
    _count?: boolean | OrganizationCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["organization"]>

  export type OrganizationSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    slug?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["organization"]>

  export type OrganizationSelectScalar = {
    id?: boolean
    name?: boolean
    slug?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type OrganizationInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    users?: boolean | Organization$usersArgs<ExtArgs>
    agentJobs?: boolean | Organization$agentJobsArgs<ExtArgs>
    agentRuns?: boolean | Organization$agentRunsArgs<ExtArgs>
    agentRunSteps?: boolean | Organization$agentRunStepsArgs<ExtArgs>
    approvalRequests?: boolean | Organization$approvalRequestsArgs<ExtArgs>
    budgetPolicies?: boolean | Organization$budgetPoliciesArgs<ExtArgs>
    auditLogs?: boolean | Organization$auditLogsArgs<ExtArgs>
    _count?: boolean | OrganizationCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type OrganizationIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $OrganizationPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Organization"
    objects: {
      users: Prisma.$UserPayload<ExtArgs>[]
      agentJobs: Prisma.$AgentJobPayload<ExtArgs>[]
      agentRuns: Prisma.$AgentRunPayload<ExtArgs>[]
      agentRunSteps: Prisma.$AgentRunStepPayload<ExtArgs>[]
      approvalRequests: Prisma.$ApprovalRequestPayload<ExtArgs>[]
      budgetPolicies: Prisma.$BudgetPolicyPayload<ExtArgs>[]
      auditLogs: Prisma.$AuditLogPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      slug: string
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["organization"]>
    composites: {}
  }

  type OrganizationGetPayload<S extends boolean | null | undefined | OrganizationDefaultArgs> = $Result.GetResult<Prisma.$OrganizationPayload, S>

  type OrganizationCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<OrganizationFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: OrganizationCountAggregateInputType | true
    }

  export interface OrganizationDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Organization'], meta: { name: 'Organization' } }
    /**
     * Find zero or one Organization that matches the filter.
     * @param {OrganizationFindUniqueArgs} args - Arguments to find a Organization
     * @example
     * // Get one Organization
     * const organization = await prisma.organization.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends OrganizationFindUniqueArgs>(args: SelectSubset<T, OrganizationFindUniqueArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Organization that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {OrganizationFindUniqueOrThrowArgs} args - Arguments to find a Organization
     * @example
     * // Get one Organization
     * const organization = await prisma.organization.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends OrganizationFindUniqueOrThrowArgs>(args: SelectSubset<T, OrganizationFindUniqueOrThrowArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Organization that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationFindFirstArgs} args - Arguments to find a Organization
     * @example
     * // Get one Organization
     * const organization = await prisma.organization.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends OrganizationFindFirstArgs>(args?: SelectSubset<T, OrganizationFindFirstArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Organization that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationFindFirstOrThrowArgs} args - Arguments to find a Organization
     * @example
     * // Get one Organization
     * const organization = await prisma.organization.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends OrganizationFindFirstOrThrowArgs>(args?: SelectSubset<T, OrganizationFindFirstOrThrowArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Organizations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Organizations
     * const organizations = await prisma.organization.findMany()
     * 
     * // Get first 10 Organizations
     * const organizations = await prisma.organization.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const organizationWithIdOnly = await prisma.organization.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends OrganizationFindManyArgs>(args?: SelectSubset<T, OrganizationFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Organization.
     * @param {OrganizationCreateArgs} args - Arguments to create a Organization.
     * @example
     * // Create one Organization
     * const Organization = await prisma.organization.create({
     *   data: {
     *     // ... data to create a Organization
     *   }
     * })
     * 
     */
    create<T extends OrganizationCreateArgs>(args: SelectSubset<T, OrganizationCreateArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Organizations.
     * @param {OrganizationCreateManyArgs} args - Arguments to create many Organizations.
     * @example
     * // Create many Organizations
     * const organization = await prisma.organization.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends OrganizationCreateManyArgs>(args?: SelectSubset<T, OrganizationCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Organizations and returns the data saved in the database.
     * @param {OrganizationCreateManyAndReturnArgs} args - Arguments to create many Organizations.
     * @example
     * // Create many Organizations
     * const organization = await prisma.organization.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Organizations and only return the `id`
     * const organizationWithIdOnly = await prisma.organization.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends OrganizationCreateManyAndReturnArgs>(args?: SelectSubset<T, OrganizationCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Organization.
     * @param {OrganizationDeleteArgs} args - Arguments to delete one Organization.
     * @example
     * // Delete one Organization
     * const Organization = await prisma.organization.delete({
     *   where: {
     *     // ... filter to delete one Organization
     *   }
     * })
     * 
     */
    delete<T extends OrganizationDeleteArgs>(args: SelectSubset<T, OrganizationDeleteArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Organization.
     * @param {OrganizationUpdateArgs} args - Arguments to update one Organization.
     * @example
     * // Update one Organization
     * const organization = await prisma.organization.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends OrganizationUpdateArgs>(args: SelectSubset<T, OrganizationUpdateArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Organizations.
     * @param {OrganizationDeleteManyArgs} args - Arguments to filter Organizations to delete.
     * @example
     * // Delete a few Organizations
     * const { count } = await prisma.organization.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends OrganizationDeleteManyArgs>(args?: SelectSubset<T, OrganizationDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Organizations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Organizations
     * const organization = await prisma.organization.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends OrganizationUpdateManyArgs>(args: SelectSubset<T, OrganizationUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Organization.
     * @param {OrganizationUpsertArgs} args - Arguments to update or create a Organization.
     * @example
     * // Update or create a Organization
     * const organization = await prisma.organization.upsert({
     *   create: {
     *     // ... data to create a Organization
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Organization we want to update
     *   }
     * })
     */
    upsert<T extends OrganizationUpsertArgs>(args: SelectSubset<T, OrganizationUpsertArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Organizations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationCountArgs} args - Arguments to filter Organizations to count.
     * @example
     * // Count the number of Organizations
     * const count = await prisma.organization.count({
     *   where: {
     *     // ... the filter for the Organizations we want to count
     *   }
     * })
    **/
    count<T extends OrganizationCountArgs>(
      args?: Subset<T, OrganizationCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], OrganizationCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Organization.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends OrganizationAggregateArgs>(args: Subset<T, OrganizationAggregateArgs>): Prisma.PrismaPromise<GetOrganizationAggregateType<T>>

    /**
     * Group by Organization.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends OrganizationGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: OrganizationGroupByArgs['orderBy'] }
        : { orderBy?: OrganizationGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, OrganizationGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetOrganizationGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Organization model
   */
  readonly fields: OrganizationFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Organization.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__OrganizationClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    users<T extends Organization$usersArgs<ExtArgs> = {}>(args?: Subset<T, Organization$usersArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findMany"> | Null>
    agentJobs<T extends Organization$agentJobsArgs<ExtArgs> = {}>(args?: Subset<T, Organization$agentJobsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "findMany"> | Null>
    agentRuns<T extends Organization$agentRunsArgs<ExtArgs> = {}>(args?: Subset<T, Organization$agentRunsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findMany"> | Null>
    agentRunSteps<T extends Organization$agentRunStepsArgs<ExtArgs> = {}>(args?: Subset<T, Organization$agentRunStepsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "findMany"> | Null>
    approvalRequests<T extends Organization$approvalRequestsArgs<ExtArgs> = {}>(args?: Subset<T, Organization$approvalRequestsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "findMany"> | Null>
    budgetPolicies<T extends Organization$budgetPoliciesArgs<ExtArgs> = {}>(args?: Subset<T, Organization$budgetPoliciesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "findMany"> | Null>
    auditLogs<T extends Organization$auditLogsArgs<ExtArgs> = {}>(args?: Subset<T, Organization$auditLogsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Organization model
   */ 
  interface OrganizationFieldRefs {
    readonly id: FieldRef<"Organization", 'String'>
    readonly name: FieldRef<"Organization", 'String'>
    readonly slug: FieldRef<"Organization", 'String'>
    readonly createdAt: FieldRef<"Organization", 'DateTime'>
    readonly updatedAt: FieldRef<"Organization", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Organization findUnique
   */
  export type OrganizationFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter, which Organization to fetch.
     */
    where: OrganizationWhereUniqueInput
  }

  /**
   * Organization findUniqueOrThrow
   */
  export type OrganizationFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter, which Organization to fetch.
     */
    where: OrganizationWhereUniqueInput
  }

  /**
   * Organization findFirst
   */
  export type OrganizationFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter, which Organization to fetch.
     */
    where?: OrganizationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Organizations to fetch.
     */
    orderBy?: OrganizationOrderByWithRelationInput | OrganizationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Organizations.
     */
    cursor?: OrganizationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Organizations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Organizations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Organizations.
     */
    distinct?: OrganizationScalarFieldEnum | OrganizationScalarFieldEnum[]
  }

  /**
   * Organization findFirstOrThrow
   */
  export type OrganizationFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter, which Organization to fetch.
     */
    where?: OrganizationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Organizations to fetch.
     */
    orderBy?: OrganizationOrderByWithRelationInput | OrganizationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Organizations.
     */
    cursor?: OrganizationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Organizations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Organizations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Organizations.
     */
    distinct?: OrganizationScalarFieldEnum | OrganizationScalarFieldEnum[]
  }

  /**
   * Organization findMany
   */
  export type OrganizationFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter, which Organizations to fetch.
     */
    where?: OrganizationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Organizations to fetch.
     */
    orderBy?: OrganizationOrderByWithRelationInput | OrganizationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Organizations.
     */
    cursor?: OrganizationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Organizations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Organizations.
     */
    skip?: number
    distinct?: OrganizationScalarFieldEnum | OrganizationScalarFieldEnum[]
  }

  /**
   * Organization create
   */
  export type OrganizationCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * The data needed to create a Organization.
     */
    data: XOR<OrganizationCreateInput, OrganizationUncheckedCreateInput>
  }

  /**
   * Organization createMany
   */
  export type OrganizationCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Organizations.
     */
    data: OrganizationCreateManyInput | OrganizationCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Organization createManyAndReturn
   */
  export type OrganizationCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Organizations.
     */
    data: OrganizationCreateManyInput | OrganizationCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Organization update
   */
  export type OrganizationUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * The data needed to update a Organization.
     */
    data: XOR<OrganizationUpdateInput, OrganizationUncheckedUpdateInput>
    /**
     * Choose, which Organization to update.
     */
    where: OrganizationWhereUniqueInput
  }

  /**
   * Organization updateMany
   */
  export type OrganizationUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Organizations.
     */
    data: XOR<OrganizationUpdateManyMutationInput, OrganizationUncheckedUpdateManyInput>
    /**
     * Filter which Organizations to update
     */
    where?: OrganizationWhereInput
  }

  /**
   * Organization upsert
   */
  export type OrganizationUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * The filter to search for the Organization to update in case it exists.
     */
    where: OrganizationWhereUniqueInput
    /**
     * In case the Organization found by the `where` argument doesn't exist, create a new Organization with this data.
     */
    create: XOR<OrganizationCreateInput, OrganizationUncheckedCreateInput>
    /**
     * In case the Organization was found with the provided `where` argument, update it with this data.
     */
    update: XOR<OrganizationUpdateInput, OrganizationUncheckedUpdateInput>
  }

  /**
   * Organization delete
   */
  export type OrganizationDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter which Organization to delete.
     */
    where: OrganizationWhereUniqueInput
  }

  /**
   * Organization deleteMany
   */
  export type OrganizationDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Organizations to delete
     */
    where?: OrganizationWhereInput
  }

  /**
   * Organization.users
   */
  export type Organization$usersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    where?: UserWhereInput
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    cursor?: UserWhereUniqueInput
    take?: number
    skip?: number
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * Organization.agentJobs
   */
  export type Organization$agentJobsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    where?: AgentJobWhereInput
    orderBy?: AgentJobOrderByWithRelationInput | AgentJobOrderByWithRelationInput[]
    cursor?: AgentJobWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AgentJobScalarFieldEnum | AgentJobScalarFieldEnum[]
  }

  /**
   * Organization.agentRuns
   */
  export type Organization$agentRunsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    where?: AgentRunWhereInput
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    cursor?: AgentRunWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AgentRunScalarFieldEnum | AgentRunScalarFieldEnum[]
  }

  /**
   * Organization.agentRunSteps
   */
  export type Organization$agentRunStepsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    where?: AgentRunStepWhereInput
    orderBy?: AgentRunStepOrderByWithRelationInput | AgentRunStepOrderByWithRelationInput[]
    cursor?: AgentRunStepWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AgentRunStepScalarFieldEnum | AgentRunStepScalarFieldEnum[]
  }

  /**
   * Organization.approvalRequests
   */
  export type Organization$approvalRequestsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    where?: ApprovalRequestWhereInput
    orderBy?: ApprovalRequestOrderByWithRelationInput | ApprovalRequestOrderByWithRelationInput[]
    cursor?: ApprovalRequestWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ApprovalRequestScalarFieldEnum | ApprovalRequestScalarFieldEnum[]
  }

  /**
   * Organization.budgetPolicies
   */
  export type Organization$budgetPoliciesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    where?: BudgetPolicyWhereInput
    orderBy?: BudgetPolicyOrderByWithRelationInput | BudgetPolicyOrderByWithRelationInput[]
    cursor?: BudgetPolicyWhereUniqueInput
    take?: number
    skip?: number
    distinct?: BudgetPolicyScalarFieldEnum | BudgetPolicyScalarFieldEnum[]
  }

  /**
   * Organization.auditLogs
   */
  export type Organization$auditLogsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    where?: AuditLogWhereInput
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    cursor?: AuditLogWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AuditLogScalarFieldEnum | AuditLogScalarFieldEnum[]
  }

  /**
   * Organization without action
   */
  export type OrganizationDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: OrganizationInclude<ExtArgs> | null
  }


  /**
   * Model User
   */

  export type AggregateUser = {
    _count: UserCountAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  export type UserMinAggregateOutputType = {
    id: string | null
    organizationId: string | null
    email: string | null
    name: string | null
    role: $Enums.UserRole | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserMaxAggregateOutputType = {
    id: string | null
    organizationId: string | null
    email: string | null
    name: string | null
    role: $Enums.UserRole | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserCountAggregateOutputType = {
    id: number
    organizationId: number
    email: number
    name: number
    role: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type UserMinAggregateInputType = {
    id?: true
    organizationId?: true
    email?: true
    name?: true
    role?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserMaxAggregateInputType = {
    id?: true
    organizationId?: true
    email?: true
    name?: true
    role?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserCountAggregateInputType = {
    id?: true
    organizationId?: true
    email?: true
    name?: true
    role?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type UserAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which User to aggregate.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Users
    **/
    _count?: true | UserCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UserMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UserMaxAggregateInputType
  }

  export type GetUserAggregateType<T extends UserAggregateArgs> = {
        [P in keyof T & keyof AggregateUser]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUser[P]>
      : GetScalarType<T[P], AggregateUser[P]>
  }




  export type UserGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserWhereInput
    orderBy?: UserOrderByWithAggregationInput | UserOrderByWithAggregationInput[]
    by: UserScalarFieldEnum[] | UserScalarFieldEnum
    having?: UserScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UserCountAggregateInputType | true
    _min?: UserMinAggregateInputType
    _max?: UserMaxAggregateInputType
  }

  export type UserGroupByOutputType = {
    id: string
    organizationId: string
    email: string
    name: string | null
    role: $Enums.UserRole
    createdAt: Date
    updatedAt: Date
    _count: UserCountAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  type GetUserGroupByPayload<T extends UserGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UserGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UserGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UserGroupByOutputType[P]>
            : GetScalarType<T[P], UserGroupByOutputType[P]>
        }
      >
    >


  export type UserSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    email?: boolean
    name?: boolean
    role?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    createdJobs?: boolean | User$createdJobsArgs<ExtArgs>
    approvalDecisions?: boolean | User$approvalDecisionsArgs<ExtArgs>
    auditLogs?: boolean | User$auditLogsArgs<ExtArgs>
    _count?: boolean | UserCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["user"]>

  export type UserSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    email?: boolean
    name?: boolean
    role?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["user"]>

  export type UserSelectScalar = {
    id?: boolean
    organizationId?: boolean
    email?: boolean
    name?: boolean
    role?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type UserInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    createdJobs?: boolean | User$createdJobsArgs<ExtArgs>
    approvalDecisions?: boolean | User$approvalDecisionsArgs<ExtArgs>
    auditLogs?: boolean | User$auditLogsArgs<ExtArgs>
    _count?: boolean | UserCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type UserIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
  }

  export type $UserPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "User"
    objects: {
      organization: Prisma.$OrganizationPayload<ExtArgs>
      createdJobs: Prisma.$AgentJobPayload<ExtArgs>[]
      approvalDecisions: Prisma.$ApprovalRequestPayload<ExtArgs>[]
      auditLogs: Prisma.$AuditLogPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      organizationId: string
      email: string
      name: string | null
      role: $Enums.UserRole
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["user"]>
    composites: {}
  }

  type UserGetPayload<S extends boolean | null | undefined | UserDefaultArgs> = $Result.GetResult<Prisma.$UserPayload, S>

  type UserCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<UserFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: UserCountAggregateInputType | true
    }

  export interface UserDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['User'], meta: { name: 'User' } }
    /**
     * Find zero or one User that matches the filter.
     * @param {UserFindUniqueArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends UserFindUniqueArgs>(args: SelectSubset<T, UserFindUniqueArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one User that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {UserFindUniqueOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends UserFindUniqueOrThrowArgs>(args: SelectSubset<T, UserFindUniqueOrThrowArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first User that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends UserFindFirstArgs>(args?: SelectSubset<T, UserFindFirstArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first User that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends UserFindFirstOrThrowArgs>(args?: SelectSubset<T, UserFindFirstOrThrowArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Users that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Users
     * const users = await prisma.user.findMany()
     * 
     * // Get first 10 Users
     * const users = await prisma.user.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const userWithIdOnly = await prisma.user.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends UserFindManyArgs>(args?: SelectSubset<T, UserFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a User.
     * @param {UserCreateArgs} args - Arguments to create a User.
     * @example
     * // Create one User
     * const User = await prisma.user.create({
     *   data: {
     *     // ... data to create a User
     *   }
     * })
     * 
     */
    create<T extends UserCreateArgs>(args: SelectSubset<T, UserCreateArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Users.
     * @param {UserCreateManyArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const user = await prisma.user.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends UserCreateManyArgs>(args?: SelectSubset<T, UserCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Users and returns the data saved in the database.
     * @param {UserCreateManyAndReturnArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const user = await prisma.user.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Users and only return the `id`
     * const userWithIdOnly = await prisma.user.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends UserCreateManyAndReturnArgs>(args?: SelectSubset<T, UserCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a User.
     * @param {UserDeleteArgs} args - Arguments to delete one User.
     * @example
     * // Delete one User
     * const User = await prisma.user.delete({
     *   where: {
     *     // ... filter to delete one User
     *   }
     * })
     * 
     */
    delete<T extends UserDeleteArgs>(args: SelectSubset<T, UserDeleteArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one User.
     * @param {UserUpdateArgs} args - Arguments to update one User.
     * @example
     * // Update one User
     * const user = await prisma.user.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends UserUpdateArgs>(args: SelectSubset<T, UserUpdateArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Users.
     * @param {UserDeleteManyArgs} args - Arguments to filter Users to delete.
     * @example
     * // Delete a few Users
     * const { count } = await prisma.user.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends UserDeleteManyArgs>(args?: SelectSubset<T, UserDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Users
     * const user = await prisma.user.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends UserUpdateManyArgs>(args: SelectSubset<T, UserUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one User.
     * @param {UserUpsertArgs} args - Arguments to update or create a User.
     * @example
     * // Update or create a User
     * const user = await prisma.user.upsert({
     *   create: {
     *     // ... data to create a User
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the User we want to update
     *   }
     * })
     */
    upsert<T extends UserUpsertArgs>(args: SelectSubset<T, UserUpsertArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserCountArgs} args - Arguments to filter Users to count.
     * @example
     * // Count the number of Users
     * const count = await prisma.user.count({
     *   where: {
     *     // ... the filter for the Users we want to count
     *   }
     * })
    **/
    count<T extends UserCountArgs>(
      args?: Subset<T, UserCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UserCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends UserAggregateArgs>(args: Subset<T, UserAggregateArgs>): Prisma.PrismaPromise<GetUserAggregateType<T>>

    /**
     * Group by User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends UserGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UserGroupByArgs['orderBy'] }
        : { orderBy?: UserGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, UserGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the User model
   */
  readonly fields: UserFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for User.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__UserClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    organization<T extends OrganizationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, OrganizationDefaultArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    createdJobs<T extends User$createdJobsArgs<ExtArgs> = {}>(args?: Subset<T, User$createdJobsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "findMany"> | Null>
    approvalDecisions<T extends User$approvalDecisionsArgs<ExtArgs> = {}>(args?: Subset<T, User$approvalDecisionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "findMany"> | Null>
    auditLogs<T extends User$auditLogsArgs<ExtArgs> = {}>(args?: Subset<T, User$auditLogsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the User model
   */ 
  interface UserFieldRefs {
    readonly id: FieldRef<"User", 'String'>
    readonly organizationId: FieldRef<"User", 'String'>
    readonly email: FieldRef<"User", 'String'>
    readonly name: FieldRef<"User", 'String'>
    readonly role: FieldRef<"User", 'UserRole'>
    readonly createdAt: FieldRef<"User", 'DateTime'>
    readonly updatedAt: FieldRef<"User", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * User findUnique
   */
  export type UserFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User findUniqueOrThrow
   */
  export type UserFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User findFirst
   */
  export type UserFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User findFirstOrThrow
   */
  export type UserFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User findMany
   */
  export type UserFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which Users to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User create
   */
  export type UserCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The data needed to create a User.
     */
    data: XOR<UserCreateInput, UserUncheckedCreateInput>
  }

  /**
   * User createMany
   */
  export type UserCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * User createManyAndReturn
   */
  export type UserCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * User update
   */
  export type UserUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The data needed to update a User.
     */
    data: XOR<UserUpdateInput, UserUncheckedUpdateInput>
    /**
     * Choose, which User to update.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User updateMany
   */
  export type UserUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Users.
     */
    data: XOR<UserUpdateManyMutationInput, UserUncheckedUpdateManyInput>
    /**
     * Filter which Users to update
     */
    where?: UserWhereInput
  }

  /**
   * User upsert
   */
  export type UserUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The filter to search for the User to update in case it exists.
     */
    where: UserWhereUniqueInput
    /**
     * In case the User found by the `where` argument doesn't exist, create a new User with this data.
     */
    create: XOR<UserCreateInput, UserUncheckedCreateInput>
    /**
     * In case the User was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UserUpdateInput, UserUncheckedUpdateInput>
  }

  /**
   * User delete
   */
  export type UserDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter which User to delete.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User deleteMany
   */
  export type UserDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Users to delete
     */
    where?: UserWhereInput
  }

  /**
   * User.createdJobs
   */
  export type User$createdJobsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    where?: AgentJobWhereInput
    orderBy?: AgentJobOrderByWithRelationInput | AgentJobOrderByWithRelationInput[]
    cursor?: AgentJobWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AgentJobScalarFieldEnum | AgentJobScalarFieldEnum[]
  }

  /**
   * User.approvalDecisions
   */
  export type User$approvalDecisionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    where?: ApprovalRequestWhereInput
    orderBy?: ApprovalRequestOrderByWithRelationInput | ApprovalRequestOrderByWithRelationInput[]
    cursor?: ApprovalRequestWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ApprovalRequestScalarFieldEnum | ApprovalRequestScalarFieldEnum[]
  }

  /**
   * User.auditLogs
   */
  export type User$auditLogsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    where?: AuditLogWhereInput
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    cursor?: AuditLogWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AuditLogScalarFieldEnum | AuditLogScalarFieldEnum[]
  }

  /**
   * User without action
   */
  export type UserDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
  }


  /**
   * Model AgentJob
   */

  export type AggregateAgentJob = {
    _count: AgentJobCountAggregateOutputType | null
    _avg: AgentJobAvgAggregateOutputType | null
    _sum: AgentJobSumAggregateOutputType | null
    _min: AgentJobMinAggregateOutputType | null
    _max: AgentJobMaxAggregateOutputType | null
  }

  export type AgentJobAvgAggregateOutputType = {
    maxDurationSeconds: number | null
    maxRetries: number | null
    retryBackoffSeconds: number | null
  }

  export type AgentJobSumAggregateOutputType = {
    maxDurationSeconds: number | null
    maxRetries: number | null
    retryBackoffSeconds: number | null
  }

  export type AgentJobMinAggregateOutputType = {
    id: string | null
    organizationId: string | null
    name: string | null
    description: string | null
    status: $Enums.JobStatus | null
    triggerType: $Enums.TriggerType | null
    cronExpression: string | null
    timezone: string | null
    endpointUrl: string | null
    httpMethod: $Enums.HttpMethod | null
    maxDurationSeconds: number | null
    maxRetries: number | null
    retryBackoffSeconds: number | null
    requireApprovalBeforeRun: boolean | null
    requireApprovalBeforeExternalAction: boolean | null
    createdByUserId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type AgentJobMaxAggregateOutputType = {
    id: string | null
    organizationId: string | null
    name: string | null
    description: string | null
    status: $Enums.JobStatus | null
    triggerType: $Enums.TriggerType | null
    cronExpression: string | null
    timezone: string | null
    endpointUrl: string | null
    httpMethod: $Enums.HttpMethod | null
    maxDurationSeconds: number | null
    maxRetries: number | null
    retryBackoffSeconds: number | null
    requireApprovalBeforeRun: boolean | null
    requireApprovalBeforeExternalAction: boolean | null
    createdByUserId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type AgentJobCountAggregateOutputType = {
    id: number
    organizationId: number
    name: number
    description: number
    status: number
    triggerType: number
    cronExpression: number
    timezone: number
    endpointUrl: number
    httpMethod: number
    headersJson: number
    maxDurationSeconds: number
    maxRetries: number
    retryBackoffSeconds: number
    requireApprovalBeforeRun: number
    requireApprovalBeforeExternalAction: number
    createdByUserId: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type AgentJobAvgAggregateInputType = {
    maxDurationSeconds?: true
    maxRetries?: true
    retryBackoffSeconds?: true
  }

  export type AgentJobSumAggregateInputType = {
    maxDurationSeconds?: true
    maxRetries?: true
    retryBackoffSeconds?: true
  }

  export type AgentJobMinAggregateInputType = {
    id?: true
    organizationId?: true
    name?: true
    description?: true
    status?: true
    triggerType?: true
    cronExpression?: true
    timezone?: true
    endpointUrl?: true
    httpMethod?: true
    maxDurationSeconds?: true
    maxRetries?: true
    retryBackoffSeconds?: true
    requireApprovalBeforeRun?: true
    requireApprovalBeforeExternalAction?: true
    createdByUserId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type AgentJobMaxAggregateInputType = {
    id?: true
    organizationId?: true
    name?: true
    description?: true
    status?: true
    triggerType?: true
    cronExpression?: true
    timezone?: true
    endpointUrl?: true
    httpMethod?: true
    maxDurationSeconds?: true
    maxRetries?: true
    retryBackoffSeconds?: true
    requireApprovalBeforeRun?: true
    requireApprovalBeforeExternalAction?: true
    createdByUserId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type AgentJobCountAggregateInputType = {
    id?: true
    organizationId?: true
    name?: true
    description?: true
    status?: true
    triggerType?: true
    cronExpression?: true
    timezone?: true
    endpointUrl?: true
    httpMethod?: true
    headersJson?: true
    maxDurationSeconds?: true
    maxRetries?: true
    retryBackoffSeconds?: true
    requireApprovalBeforeRun?: true
    requireApprovalBeforeExternalAction?: true
    createdByUserId?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type AgentJobAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentJob to aggregate.
     */
    where?: AgentJobWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentJobs to fetch.
     */
    orderBy?: AgentJobOrderByWithRelationInput | AgentJobOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AgentJobWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentJobs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentJobs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned AgentJobs
    **/
    _count?: true | AgentJobCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: AgentJobAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: AgentJobSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AgentJobMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AgentJobMaxAggregateInputType
  }

  export type GetAgentJobAggregateType<T extends AgentJobAggregateArgs> = {
        [P in keyof T & keyof AggregateAgentJob]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgentJob[P]>
      : GetScalarType<T[P], AggregateAgentJob[P]>
  }




  export type AgentJobGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentJobWhereInput
    orderBy?: AgentJobOrderByWithAggregationInput | AgentJobOrderByWithAggregationInput[]
    by: AgentJobScalarFieldEnum[] | AgentJobScalarFieldEnum
    having?: AgentJobScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AgentJobCountAggregateInputType | true
    _avg?: AgentJobAvgAggregateInputType
    _sum?: AgentJobSumAggregateInputType
    _min?: AgentJobMinAggregateInputType
    _max?: AgentJobMaxAggregateInputType
  }

  export type AgentJobGroupByOutputType = {
    id: string
    organizationId: string
    name: string
    description: string | null
    status: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression: string | null
    timezone: string
    endpointUrl: string
    httpMethod: $Enums.HttpMethod
    headersJson: JsonValue | null
    maxDurationSeconds: number
    maxRetries: number
    retryBackoffSeconds: number
    requireApprovalBeforeRun: boolean
    requireApprovalBeforeExternalAction: boolean
    createdByUserId: string
    createdAt: Date
    updatedAt: Date
    _count: AgentJobCountAggregateOutputType | null
    _avg: AgentJobAvgAggregateOutputType | null
    _sum: AgentJobSumAggregateOutputType | null
    _min: AgentJobMinAggregateOutputType | null
    _max: AgentJobMaxAggregateOutputType | null
  }

  type GetAgentJobGroupByPayload<T extends AgentJobGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AgentJobGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AgentJobGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AgentJobGroupByOutputType[P]>
            : GetScalarType<T[P], AgentJobGroupByOutputType[P]>
        }
      >
    >


  export type AgentJobSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    name?: boolean
    description?: boolean
    status?: boolean
    triggerType?: boolean
    cronExpression?: boolean
    timezone?: boolean
    endpointUrl?: boolean
    httpMethod?: boolean
    headersJson?: boolean
    maxDurationSeconds?: boolean
    maxRetries?: boolean
    retryBackoffSeconds?: boolean
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdByUserId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    createdBy?: boolean | UserDefaultArgs<ExtArgs>
    runs?: boolean | AgentJob$runsArgs<ExtArgs>
    budgetPolicy?: boolean | AgentJob$budgetPolicyArgs<ExtArgs>
    _count?: boolean | AgentJobCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["agentJob"]>

  export type AgentJobSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    name?: boolean
    description?: boolean
    status?: boolean
    triggerType?: boolean
    cronExpression?: boolean
    timezone?: boolean
    endpointUrl?: boolean
    httpMethod?: boolean
    headersJson?: boolean
    maxDurationSeconds?: boolean
    maxRetries?: boolean
    retryBackoffSeconds?: boolean
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdByUserId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    createdBy?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["agentJob"]>

  export type AgentJobSelectScalar = {
    id?: boolean
    organizationId?: boolean
    name?: boolean
    description?: boolean
    status?: boolean
    triggerType?: boolean
    cronExpression?: boolean
    timezone?: boolean
    endpointUrl?: boolean
    httpMethod?: boolean
    headersJson?: boolean
    maxDurationSeconds?: boolean
    maxRetries?: boolean
    retryBackoffSeconds?: boolean
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdByUserId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type AgentJobInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    createdBy?: boolean | UserDefaultArgs<ExtArgs>
    runs?: boolean | AgentJob$runsArgs<ExtArgs>
    budgetPolicy?: boolean | AgentJob$budgetPolicyArgs<ExtArgs>
    _count?: boolean | AgentJobCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type AgentJobIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    createdBy?: boolean | UserDefaultArgs<ExtArgs>
  }

  export type $AgentJobPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "AgentJob"
    objects: {
      organization: Prisma.$OrganizationPayload<ExtArgs>
      createdBy: Prisma.$UserPayload<ExtArgs>
      runs: Prisma.$AgentRunPayload<ExtArgs>[]
      budgetPolicy: Prisma.$BudgetPolicyPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      organizationId: string
      name: string
      description: string | null
      status: $Enums.JobStatus
      triggerType: $Enums.TriggerType
      cronExpression: string | null
      timezone: string
      endpointUrl: string
      httpMethod: $Enums.HttpMethod
      headersJson: Prisma.JsonValue | null
      maxDurationSeconds: number
      maxRetries: number
      retryBackoffSeconds: number
      requireApprovalBeforeRun: boolean
      requireApprovalBeforeExternalAction: boolean
      createdByUserId: string
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["agentJob"]>
    composites: {}
  }

  type AgentJobGetPayload<S extends boolean | null | undefined | AgentJobDefaultArgs> = $Result.GetResult<Prisma.$AgentJobPayload, S>

  type AgentJobCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<AgentJobFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: AgentJobCountAggregateInputType | true
    }

  export interface AgentJobDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['AgentJob'], meta: { name: 'AgentJob' } }
    /**
     * Find zero or one AgentJob that matches the filter.
     * @param {AgentJobFindUniqueArgs} args - Arguments to find a AgentJob
     * @example
     * // Get one AgentJob
     * const agentJob = await prisma.agentJob.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AgentJobFindUniqueArgs>(args: SelectSubset<T, AgentJobFindUniqueArgs<ExtArgs>>): Prisma__AgentJobClient<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one AgentJob that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {AgentJobFindUniqueOrThrowArgs} args - Arguments to find a AgentJob
     * @example
     * // Get one AgentJob
     * const agentJob = await prisma.agentJob.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AgentJobFindUniqueOrThrowArgs>(args: SelectSubset<T, AgentJobFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AgentJobClient<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first AgentJob that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentJobFindFirstArgs} args - Arguments to find a AgentJob
     * @example
     * // Get one AgentJob
     * const agentJob = await prisma.agentJob.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AgentJobFindFirstArgs>(args?: SelectSubset<T, AgentJobFindFirstArgs<ExtArgs>>): Prisma__AgentJobClient<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first AgentJob that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentJobFindFirstOrThrowArgs} args - Arguments to find a AgentJob
     * @example
     * // Get one AgentJob
     * const agentJob = await prisma.agentJob.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AgentJobFindFirstOrThrowArgs>(args?: SelectSubset<T, AgentJobFindFirstOrThrowArgs<ExtArgs>>): Prisma__AgentJobClient<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more AgentJobs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentJobFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all AgentJobs
     * const agentJobs = await prisma.agentJob.findMany()
     * 
     * // Get first 10 AgentJobs
     * const agentJobs = await prisma.agentJob.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agentJobWithIdOnly = await prisma.agentJob.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends AgentJobFindManyArgs>(args?: SelectSubset<T, AgentJobFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a AgentJob.
     * @param {AgentJobCreateArgs} args - Arguments to create a AgentJob.
     * @example
     * // Create one AgentJob
     * const AgentJob = await prisma.agentJob.create({
     *   data: {
     *     // ... data to create a AgentJob
     *   }
     * })
     * 
     */
    create<T extends AgentJobCreateArgs>(args: SelectSubset<T, AgentJobCreateArgs<ExtArgs>>): Prisma__AgentJobClient<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many AgentJobs.
     * @param {AgentJobCreateManyArgs} args - Arguments to create many AgentJobs.
     * @example
     * // Create many AgentJobs
     * const agentJob = await prisma.agentJob.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AgentJobCreateManyArgs>(args?: SelectSubset<T, AgentJobCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many AgentJobs and returns the data saved in the database.
     * @param {AgentJobCreateManyAndReturnArgs} args - Arguments to create many AgentJobs.
     * @example
     * // Create many AgentJobs
     * const agentJob = await prisma.agentJob.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many AgentJobs and only return the `id`
     * const agentJobWithIdOnly = await prisma.agentJob.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AgentJobCreateManyAndReturnArgs>(args?: SelectSubset<T, AgentJobCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a AgentJob.
     * @param {AgentJobDeleteArgs} args - Arguments to delete one AgentJob.
     * @example
     * // Delete one AgentJob
     * const AgentJob = await prisma.agentJob.delete({
     *   where: {
     *     // ... filter to delete one AgentJob
     *   }
     * })
     * 
     */
    delete<T extends AgentJobDeleteArgs>(args: SelectSubset<T, AgentJobDeleteArgs<ExtArgs>>): Prisma__AgentJobClient<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one AgentJob.
     * @param {AgentJobUpdateArgs} args - Arguments to update one AgentJob.
     * @example
     * // Update one AgentJob
     * const agentJob = await prisma.agentJob.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AgentJobUpdateArgs>(args: SelectSubset<T, AgentJobUpdateArgs<ExtArgs>>): Prisma__AgentJobClient<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more AgentJobs.
     * @param {AgentJobDeleteManyArgs} args - Arguments to filter AgentJobs to delete.
     * @example
     * // Delete a few AgentJobs
     * const { count } = await prisma.agentJob.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AgentJobDeleteManyArgs>(args?: SelectSubset<T, AgentJobDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more AgentJobs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentJobUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many AgentJobs
     * const agentJob = await prisma.agentJob.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AgentJobUpdateManyArgs>(args: SelectSubset<T, AgentJobUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one AgentJob.
     * @param {AgentJobUpsertArgs} args - Arguments to update or create a AgentJob.
     * @example
     * // Update or create a AgentJob
     * const agentJob = await prisma.agentJob.upsert({
     *   create: {
     *     // ... data to create a AgentJob
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the AgentJob we want to update
     *   }
     * })
     */
    upsert<T extends AgentJobUpsertArgs>(args: SelectSubset<T, AgentJobUpsertArgs<ExtArgs>>): Prisma__AgentJobClient<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of AgentJobs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentJobCountArgs} args - Arguments to filter AgentJobs to count.
     * @example
     * // Count the number of AgentJobs
     * const count = await prisma.agentJob.count({
     *   where: {
     *     // ... the filter for the AgentJobs we want to count
     *   }
     * })
    **/
    count<T extends AgentJobCountArgs>(
      args?: Subset<T, AgentJobCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AgentJobCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a AgentJob.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentJobAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AgentJobAggregateArgs>(args: Subset<T, AgentJobAggregateArgs>): Prisma.PrismaPromise<GetAgentJobAggregateType<T>>

    /**
     * Group by AgentJob.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentJobGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AgentJobGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AgentJobGroupByArgs['orderBy'] }
        : { orderBy?: AgentJobGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AgentJobGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgentJobGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the AgentJob model
   */
  readonly fields: AgentJobFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for AgentJob.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AgentJobClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    organization<T extends OrganizationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, OrganizationDefaultArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    createdBy<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    runs<T extends AgentJob$runsArgs<ExtArgs> = {}>(args?: Subset<T, AgentJob$runsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findMany"> | Null>
    budgetPolicy<T extends AgentJob$budgetPolicyArgs<ExtArgs> = {}>(args?: Subset<T, AgentJob$budgetPolicyArgs<ExtArgs>>): Prisma__BudgetPolicyClient<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the AgentJob model
   */ 
  interface AgentJobFieldRefs {
    readonly id: FieldRef<"AgentJob", 'String'>
    readonly organizationId: FieldRef<"AgentJob", 'String'>
    readonly name: FieldRef<"AgentJob", 'String'>
    readonly description: FieldRef<"AgentJob", 'String'>
    readonly status: FieldRef<"AgentJob", 'JobStatus'>
    readonly triggerType: FieldRef<"AgentJob", 'TriggerType'>
    readonly cronExpression: FieldRef<"AgentJob", 'String'>
    readonly timezone: FieldRef<"AgentJob", 'String'>
    readonly endpointUrl: FieldRef<"AgentJob", 'String'>
    readonly httpMethod: FieldRef<"AgentJob", 'HttpMethod'>
    readonly headersJson: FieldRef<"AgentJob", 'Json'>
    readonly maxDurationSeconds: FieldRef<"AgentJob", 'Int'>
    readonly maxRetries: FieldRef<"AgentJob", 'Int'>
    readonly retryBackoffSeconds: FieldRef<"AgentJob", 'Int'>
    readonly requireApprovalBeforeRun: FieldRef<"AgentJob", 'Boolean'>
    readonly requireApprovalBeforeExternalAction: FieldRef<"AgentJob", 'Boolean'>
    readonly createdByUserId: FieldRef<"AgentJob", 'String'>
    readonly createdAt: FieldRef<"AgentJob", 'DateTime'>
    readonly updatedAt: FieldRef<"AgentJob", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * AgentJob findUnique
   */
  export type AgentJobFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    /**
     * Filter, which AgentJob to fetch.
     */
    where: AgentJobWhereUniqueInput
  }

  /**
   * AgentJob findUniqueOrThrow
   */
  export type AgentJobFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    /**
     * Filter, which AgentJob to fetch.
     */
    where: AgentJobWhereUniqueInput
  }

  /**
   * AgentJob findFirst
   */
  export type AgentJobFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    /**
     * Filter, which AgentJob to fetch.
     */
    where?: AgentJobWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentJobs to fetch.
     */
    orderBy?: AgentJobOrderByWithRelationInput | AgentJobOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentJobs.
     */
    cursor?: AgentJobWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentJobs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentJobs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentJobs.
     */
    distinct?: AgentJobScalarFieldEnum | AgentJobScalarFieldEnum[]
  }

  /**
   * AgentJob findFirstOrThrow
   */
  export type AgentJobFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    /**
     * Filter, which AgentJob to fetch.
     */
    where?: AgentJobWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentJobs to fetch.
     */
    orderBy?: AgentJobOrderByWithRelationInput | AgentJobOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentJobs.
     */
    cursor?: AgentJobWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentJobs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentJobs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentJobs.
     */
    distinct?: AgentJobScalarFieldEnum | AgentJobScalarFieldEnum[]
  }

  /**
   * AgentJob findMany
   */
  export type AgentJobFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    /**
     * Filter, which AgentJobs to fetch.
     */
    where?: AgentJobWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentJobs to fetch.
     */
    orderBy?: AgentJobOrderByWithRelationInput | AgentJobOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing AgentJobs.
     */
    cursor?: AgentJobWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentJobs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentJobs.
     */
    skip?: number
    distinct?: AgentJobScalarFieldEnum | AgentJobScalarFieldEnum[]
  }

  /**
   * AgentJob create
   */
  export type AgentJobCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    /**
     * The data needed to create a AgentJob.
     */
    data: XOR<AgentJobCreateInput, AgentJobUncheckedCreateInput>
  }

  /**
   * AgentJob createMany
   */
  export type AgentJobCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many AgentJobs.
     */
    data: AgentJobCreateManyInput | AgentJobCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * AgentJob createManyAndReturn
   */
  export type AgentJobCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many AgentJobs.
     */
    data: AgentJobCreateManyInput | AgentJobCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * AgentJob update
   */
  export type AgentJobUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    /**
     * The data needed to update a AgentJob.
     */
    data: XOR<AgentJobUpdateInput, AgentJobUncheckedUpdateInput>
    /**
     * Choose, which AgentJob to update.
     */
    where: AgentJobWhereUniqueInput
  }

  /**
   * AgentJob updateMany
   */
  export type AgentJobUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update AgentJobs.
     */
    data: XOR<AgentJobUpdateManyMutationInput, AgentJobUncheckedUpdateManyInput>
    /**
     * Filter which AgentJobs to update
     */
    where?: AgentJobWhereInput
  }

  /**
   * AgentJob upsert
   */
  export type AgentJobUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    /**
     * The filter to search for the AgentJob to update in case it exists.
     */
    where: AgentJobWhereUniqueInput
    /**
     * In case the AgentJob found by the `where` argument doesn't exist, create a new AgentJob with this data.
     */
    create: XOR<AgentJobCreateInput, AgentJobUncheckedCreateInput>
    /**
     * In case the AgentJob was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AgentJobUpdateInput, AgentJobUncheckedUpdateInput>
  }

  /**
   * AgentJob delete
   */
  export type AgentJobDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
    /**
     * Filter which AgentJob to delete.
     */
    where: AgentJobWhereUniqueInput
  }

  /**
   * AgentJob deleteMany
   */
  export type AgentJobDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentJobs to delete
     */
    where?: AgentJobWhereInput
  }

  /**
   * AgentJob.runs
   */
  export type AgentJob$runsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    where?: AgentRunWhereInput
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    cursor?: AgentRunWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AgentRunScalarFieldEnum | AgentRunScalarFieldEnum[]
  }

  /**
   * AgentJob.budgetPolicy
   */
  export type AgentJob$budgetPolicyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    where?: BudgetPolicyWhereInput
  }

  /**
   * AgentJob without action
   */
  export type AgentJobDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentJob
     */
    select?: AgentJobSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentJobInclude<ExtArgs> | null
  }


  /**
   * Model AgentRun
   */

  export type AggregateAgentRun = {
    _count: AgentRunCountAggregateOutputType | null
    _avg: AgentRunAvgAggregateOutputType | null
    _sum: AgentRunSumAggregateOutputType | null
    _min: AgentRunMinAggregateOutputType | null
    _max: AgentRunMaxAggregateOutputType | null
  }

  export type AgentRunAvgAggregateOutputType = {
    durationMs: number | null
    attemptNumber: number | null
    totalTokens: number | null
    estimatedCostUsd: Decimal | null
  }

  export type AgentRunSumAggregateOutputType = {
    durationMs: number | null
    attemptNumber: number | null
    totalTokens: number | null
    estimatedCostUsd: Decimal | null
  }

  export type AgentRunMinAggregateOutputType = {
    id: string | null
    organizationId: string | null
    agentJobId: string | null
    status: $Enums.RunStatus | null
    triggerSource: $Enums.TriggerSource | null
    startedAt: Date | null
    finishedAt: Date | null
    durationMs: number | null
    attemptNumber: number | null
    idempotencyKey: string | null
    errorMessage: string | null
    totalTokens: number | null
    estimatedCostUsd: Decimal | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type AgentRunMaxAggregateOutputType = {
    id: string | null
    organizationId: string | null
    agentJobId: string | null
    status: $Enums.RunStatus | null
    triggerSource: $Enums.TriggerSource | null
    startedAt: Date | null
    finishedAt: Date | null
    durationMs: number | null
    attemptNumber: number | null
    idempotencyKey: string | null
    errorMessage: string | null
    totalTokens: number | null
    estimatedCostUsd: Decimal | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type AgentRunCountAggregateOutputType = {
    id: number
    organizationId: number
    agentJobId: number
    status: number
    triggerSource: number
    startedAt: number
    finishedAt: number
    durationMs: number
    attemptNumber: number
    idempotencyKey: number
    inputJson: number
    outputJson: number
    errorMessage: number
    totalTokens: number
    estimatedCostUsd: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type AgentRunAvgAggregateInputType = {
    durationMs?: true
    attemptNumber?: true
    totalTokens?: true
    estimatedCostUsd?: true
  }

  export type AgentRunSumAggregateInputType = {
    durationMs?: true
    attemptNumber?: true
    totalTokens?: true
    estimatedCostUsd?: true
  }

  export type AgentRunMinAggregateInputType = {
    id?: true
    organizationId?: true
    agentJobId?: true
    status?: true
    triggerSource?: true
    startedAt?: true
    finishedAt?: true
    durationMs?: true
    attemptNumber?: true
    idempotencyKey?: true
    errorMessage?: true
    totalTokens?: true
    estimatedCostUsd?: true
    createdAt?: true
    updatedAt?: true
  }

  export type AgentRunMaxAggregateInputType = {
    id?: true
    organizationId?: true
    agentJobId?: true
    status?: true
    triggerSource?: true
    startedAt?: true
    finishedAt?: true
    durationMs?: true
    attemptNumber?: true
    idempotencyKey?: true
    errorMessage?: true
    totalTokens?: true
    estimatedCostUsd?: true
    createdAt?: true
    updatedAt?: true
  }

  export type AgentRunCountAggregateInputType = {
    id?: true
    organizationId?: true
    agentJobId?: true
    status?: true
    triggerSource?: true
    startedAt?: true
    finishedAt?: true
    durationMs?: true
    attemptNumber?: true
    idempotencyKey?: true
    inputJson?: true
    outputJson?: true
    errorMessage?: true
    totalTokens?: true
    estimatedCostUsd?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type AgentRunAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentRun to aggregate.
     */
    where?: AgentRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRuns to fetch.
     */
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AgentRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRuns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned AgentRuns
    **/
    _count?: true | AgentRunCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: AgentRunAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: AgentRunSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AgentRunMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AgentRunMaxAggregateInputType
  }

  export type GetAgentRunAggregateType<T extends AgentRunAggregateArgs> = {
        [P in keyof T & keyof AggregateAgentRun]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgentRun[P]>
      : GetScalarType<T[P], AggregateAgentRun[P]>
  }




  export type AgentRunGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentRunWhereInput
    orderBy?: AgentRunOrderByWithAggregationInput | AgentRunOrderByWithAggregationInput[]
    by: AgentRunScalarFieldEnum[] | AgentRunScalarFieldEnum
    having?: AgentRunScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AgentRunCountAggregateInputType | true
    _avg?: AgentRunAvgAggregateInputType
    _sum?: AgentRunSumAggregateInputType
    _min?: AgentRunMinAggregateInputType
    _max?: AgentRunMaxAggregateInputType
  }

  export type AgentRunGroupByOutputType = {
    id: string
    organizationId: string
    agentJobId: string
    status: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt: Date | null
    finishedAt: Date | null
    durationMs: number | null
    attemptNumber: number
    idempotencyKey: string
    inputJson: JsonValue | null
    outputJson: JsonValue | null
    errorMessage: string | null
    totalTokens: number | null
    estimatedCostUsd: Decimal | null
    createdAt: Date
    updatedAt: Date
    _count: AgentRunCountAggregateOutputType | null
    _avg: AgentRunAvgAggregateOutputType | null
    _sum: AgentRunSumAggregateOutputType | null
    _min: AgentRunMinAggregateOutputType | null
    _max: AgentRunMaxAggregateOutputType | null
  }

  type GetAgentRunGroupByPayload<T extends AgentRunGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AgentRunGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AgentRunGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AgentRunGroupByOutputType[P]>
            : GetScalarType<T[P], AgentRunGroupByOutputType[P]>
        }
      >
    >


  export type AgentRunSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    agentJobId?: boolean
    status?: boolean
    triggerSource?: boolean
    startedAt?: boolean
    finishedAt?: boolean
    durationMs?: boolean
    attemptNumber?: boolean
    idempotencyKey?: boolean
    inputJson?: boolean
    outputJson?: boolean
    errorMessage?: boolean
    totalTokens?: boolean
    estimatedCostUsd?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentJob?: boolean | AgentJobDefaultArgs<ExtArgs>
    steps?: boolean | AgentRun$stepsArgs<ExtArgs>
    approvalRequests?: boolean | AgentRun$approvalRequestsArgs<ExtArgs>
    _count?: boolean | AgentRunCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["agentRun"]>

  export type AgentRunSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    agentJobId?: boolean
    status?: boolean
    triggerSource?: boolean
    startedAt?: boolean
    finishedAt?: boolean
    durationMs?: boolean
    attemptNumber?: boolean
    idempotencyKey?: boolean
    inputJson?: boolean
    outputJson?: boolean
    errorMessage?: boolean
    totalTokens?: boolean
    estimatedCostUsd?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentJob?: boolean | AgentJobDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["agentRun"]>

  export type AgentRunSelectScalar = {
    id?: boolean
    organizationId?: boolean
    agentJobId?: boolean
    status?: boolean
    triggerSource?: boolean
    startedAt?: boolean
    finishedAt?: boolean
    durationMs?: boolean
    attemptNumber?: boolean
    idempotencyKey?: boolean
    inputJson?: boolean
    outputJson?: boolean
    errorMessage?: boolean
    totalTokens?: boolean
    estimatedCostUsd?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type AgentRunInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentJob?: boolean | AgentJobDefaultArgs<ExtArgs>
    steps?: boolean | AgentRun$stepsArgs<ExtArgs>
    approvalRequests?: boolean | AgentRun$approvalRequestsArgs<ExtArgs>
    _count?: boolean | AgentRunCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type AgentRunIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentJob?: boolean | AgentJobDefaultArgs<ExtArgs>
  }

  export type $AgentRunPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "AgentRun"
    objects: {
      organization: Prisma.$OrganizationPayload<ExtArgs>
      agentJob: Prisma.$AgentJobPayload<ExtArgs>
      steps: Prisma.$AgentRunStepPayload<ExtArgs>[]
      approvalRequests: Prisma.$ApprovalRequestPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      organizationId: string
      agentJobId: string
      status: $Enums.RunStatus
      triggerSource: $Enums.TriggerSource
      startedAt: Date | null
      finishedAt: Date | null
      durationMs: number | null
      attemptNumber: number
      idempotencyKey: string
      inputJson: Prisma.JsonValue | null
      outputJson: Prisma.JsonValue | null
      errorMessage: string | null
      totalTokens: number | null
      estimatedCostUsd: Prisma.Decimal | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["agentRun"]>
    composites: {}
  }

  type AgentRunGetPayload<S extends boolean | null | undefined | AgentRunDefaultArgs> = $Result.GetResult<Prisma.$AgentRunPayload, S>

  type AgentRunCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<AgentRunFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: AgentRunCountAggregateInputType | true
    }

  export interface AgentRunDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['AgentRun'], meta: { name: 'AgentRun' } }
    /**
     * Find zero or one AgentRun that matches the filter.
     * @param {AgentRunFindUniqueArgs} args - Arguments to find a AgentRun
     * @example
     * // Get one AgentRun
     * const agentRun = await prisma.agentRun.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AgentRunFindUniqueArgs>(args: SelectSubset<T, AgentRunFindUniqueArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one AgentRun that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {AgentRunFindUniqueOrThrowArgs} args - Arguments to find a AgentRun
     * @example
     * // Get one AgentRun
     * const agentRun = await prisma.agentRun.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AgentRunFindUniqueOrThrowArgs>(args: SelectSubset<T, AgentRunFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first AgentRun that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunFindFirstArgs} args - Arguments to find a AgentRun
     * @example
     * // Get one AgentRun
     * const agentRun = await prisma.agentRun.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AgentRunFindFirstArgs>(args?: SelectSubset<T, AgentRunFindFirstArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first AgentRun that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunFindFirstOrThrowArgs} args - Arguments to find a AgentRun
     * @example
     * // Get one AgentRun
     * const agentRun = await prisma.agentRun.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AgentRunFindFirstOrThrowArgs>(args?: SelectSubset<T, AgentRunFindFirstOrThrowArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more AgentRuns that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all AgentRuns
     * const agentRuns = await prisma.agentRun.findMany()
     * 
     * // Get first 10 AgentRuns
     * const agentRuns = await prisma.agentRun.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agentRunWithIdOnly = await prisma.agentRun.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends AgentRunFindManyArgs>(args?: SelectSubset<T, AgentRunFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a AgentRun.
     * @param {AgentRunCreateArgs} args - Arguments to create a AgentRun.
     * @example
     * // Create one AgentRun
     * const AgentRun = await prisma.agentRun.create({
     *   data: {
     *     // ... data to create a AgentRun
     *   }
     * })
     * 
     */
    create<T extends AgentRunCreateArgs>(args: SelectSubset<T, AgentRunCreateArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many AgentRuns.
     * @param {AgentRunCreateManyArgs} args - Arguments to create many AgentRuns.
     * @example
     * // Create many AgentRuns
     * const agentRun = await prisma.agentRun.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AgentRunCreateManyArgs>(args?: SelectSubset<T, AgentRunCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many AgentRuns and returns the data saved in the database.
     * @param {AgentRunCreateManyAndReturnArgs} args - Arguments to create many AgentRuns.
     * @example
     * // Create many AgentRuns
     * const agentRun = await prisma.agentRun.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many AgentRuns and only return the `id`
     * const agentRunWithIdOnly = await prisma.agentRun.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AgentRunCreateManyAndReturnArgs>(args?: SelectSubset<T, AgentRunCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a AgentRun.
     * @param {AgentRunDeleteArgs} args - Arguments to delete one AgentRun.
     * @example
     * // Delete one AgentRun
     * const AgentRun = await prisma.agentRun.delete({
     *   where: {
     *     // ... filter to delete one AgentRun
     *   }
     * })
     * 
     */
    delete<T extends AgentRunDeleteArgs>(args: SelectSubset<T, AgentRunDeleteArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one AgentRun.
     * @param {AgentRunUpdateArgs} args - Arguments to update one AgentRun.
     * @example
     * // Update one AgentRun
     * const agentRun = await prisma.agentRun.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AgentRunUpdateArgs>(args: SelectSubset<T, AgentRunUpdateArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more AgentRuns.
     * @param {AgentRunDeleteManyArgs} args - Arguments to filter AgentRuns to delete.
     * @example
     * // Delete a few AgentRuns
     * const { count } = await prisma.agentRun.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AgentRunDeleteManyArgs>(args?: SelectSubset<T, AgentRunDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more AgentRuns.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many AgentRuns
     * const agentRun = await prisma.agentRun.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AgentRunUpdateManyArgs>(args: SelectSubset<T, AgentRunUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one AgentRun.
     * @param {AgentRunUpsertArgs} args - Arguments to update or create a AgentRun.
     * @example
     * // Update or create a AgentRun
     * const agentRun = await prisma.agentRun.upsert({
     *   create: {
     *     // ... data to create a AgentRun
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the AgentRun we want to update
     *   }
     * })
     */
    upsert<T extends AgentRunUpsertArgs>(args: SelectSubset<T, AgentRunUpsertArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of AgentRuns.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunCountArgs} args - Arguments to filter AgentRuns to count.
     * @example
     * // Count the number of AgentRuns
     * const count = await prisma.agentRun.count({
     *   where: {
     *     // ... the filter for the AgentRuns we want to count
     *   }
     * })
    **/
    count<T extends AgentRunCountArgs>(
      args?: Subset<T, AgentRunCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AgentRunCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a AgentRun.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AgentRunAggregateArgs>(args: Subset<T, AgentRunAggregateArgs>): Prisma.PrismaPromise<GetAgentRunAggregateType<T>>

    /**
     * Group by AgentRun.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AgentRunGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AgentRunGroupByArgs['orderBy'] }
        : { orderBy?: AgentRunGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AgentRunGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgentRunGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the AgentRun model
   */
  readonly fields: AgentRunFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for AgentRun.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AgentRunClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    organization<T extends OrganizationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, OrganizationDefaultArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    agentJob<T extends AgentJobDefaultArgs<ExtArgs> = {}>(args?: Subset<T, AgentJobDefaultArgs<ExtArgs>>): Prisma__AgentJobClient<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    steps<T extends AgentRun$stepsArgs<ExtArgs> = {}>(args?: Subset<T, AgentRun$stepsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "findMany"> | Null>
    approvalRequests<T extends AgentRun$approvalRequestsArgs<ExtArgs> = {}>(args?: Subset<T, AgentRun$approvalRequestsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the AgentRun model
   */ 
  interface AgentRunFieldRefs {
    readonly id: FieldRef<"AgentRun", 'String'>
    readonly organizationId: FieldRef<"AgentRun", 'String'>
    readonly agentJobId: FieldRef<"AgentRun", 'String'>
    readonly status: FieldRef<"AgentRun", 'RunStatus'>
    readonly triggerSource: FieldRef<"AgentRun", 'TriggerSource'>
    readonly startedAt: FieldRef<"AgentRun", 'DateTime'>
    readonly finishedAt: FieldRef<"AgentRun", 'DateTime'>
    readonly durationMs: FieldRef<"AgentRun", 'Int'>
    readonly attemptNumber: FieldRef<"AgentRun", 'Int'>
    readonly idempotencyKey: FieldRef<"AgentRun", 'String'>
    readonly inputJson: FieldRef<"AgentRun", 'Json'>
    readonly outputJson: FieldRef<"AgentRun", 'Json'>
    readonly errorMessage: FieldRef<"AgentRun", 'String'>
    readonly totalTokens: FieldRef<"AgentRun", 'Int'>
    readonly estimatedCostUsd: FieldRef<"AgentRun", 'Decimal'>
    readonly createdAt: FieldRef<"AgentRun", 'DateTime'>
    readonly updatedAt: FieldRef<"AgentRun", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * AgentRun findUnique
   */
  export type AgentRunFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter, which AgentRun to fetch.
     */
    where: AgentRunWhereUniqueInput
  }

  /**
   * AgentRun findUniqueOrThrow
   */
  export type AgentRunFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter, which AgentRun to fetch.
     */
    where: AgentRunWhereUniqueInput
  }

  /**
   * AgentRun findFirst
   */
  export type AgentRunFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter, which AgentRun to fetch.
     */
    where?: AgentRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRuns to fetch.
     */
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentRuns.
     */
    cursor?: AgentRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRuns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentRuns.
     */
    distinct?: AgentRunScalarFieldEnum | AgentRunScalarFieldEnum[]
  }

  /**
   * AgentRun findFirstOrThrow
   */
  export type AgentRunFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter, which AgentRun to fetch.
     */
    where?: AgentRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRuns to fetch.
     */
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentRuns.
     */
    cursor?: AgentRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRuns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentRuns.
     */
    distinct?: AgentRunScalarFieldEnum | AgentRunScalarFieldEnum[]
  }

  /**
   * AgentRun findMany
   */
  export type AgentRunFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter, which AgentRuns to fetch.
     */
    where?: AgentRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRuns to fetch.
     */
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing AgentRuns.
     */
    cursor?: AgentRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRuns.
     */
    skip?: number
    distinct?: AgentRunScalarFieldEnum | AgentRunScalarFieldEnum[]
  }

  /**
   * AgentRun create
   */
  export type AgentRunCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * The data needed to create a AgentRun.
     */
    data: XOR<AgentRunCreateInput, AgentRunUncheckedCreateInput>
  }

  /**
   * AgentRun createMany
   */
  export type AgentRunCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many AgentRuns.
     */
    data: AgentRunCreateManyInput | AgentRunCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * AgentRun createManyAndReturn
   */
  export type AgentRunCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many AgentRuns.
     */
    data: AgentRunCreateManyInput | AgentRunCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * AgentRun update
   */
  export type AgentRunUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * The data needed to update a AgentRun.
     */
    data: XOR<AgentRunUpdateInput, AgentRunUncheckedUpdateInput>
    /**
     * Choose, which AgentRun to update.
     */
    where: AgentRunWhereUniqueInput
  }

  /**
   * AgentRun updateMany
   */
  export type AgentRunUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update AgentRuns.
     */
    data: XOR<AgentRunUpdateManyMutationInput, AgentRunUncheckedUpdateManyInput>
    /**
     * Filter which AgentRuns to update
     */
    where?: AgentRunWhereInput
  }

  /**
   * AgentRun upsert
   */
  export type AgentRunUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * The filter to search for the AgentRun to update in case it exists.
     */
    where: AgentRunWhereUniqueInput
    /**
     * In case the AgentRun found by the `where` argument doesn't exist, create a new AgentRun with this data.
     */
    create: XOR<AgentRunCreateInput, AgentRunUncheckedCreateInput>
    /**
     * In case the AgentRun was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AgentRunUpdateInput, AgentRunUncheckedUpdateInput>
  }

  /**
   * AgentRun delete
   */
  export type AgentRunDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter which AgentRun to delete.
     */
    where: AgentRunWhereUniqueInput
  }

  /**
   * AgentRun deleteMany
   */
  export type AgentRunDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentRuns to delete
     */
    where?: AgentRunWhereInput
  }

  /**
   * AgentRun.steps
   */
  export type AgentRun$stepsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    where?: AgentRunStepWhereInput
    orderBy?: AgentRunStepOrderByWithRelationInput | AgentRunStepOrderByWithRelationInput[]
    cursor?: AgentRunStepWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AgentRunStepScalarFieldEnum | AgentRunStepScalarFieldEnum[]
  }

  /**
   * AgentRun.approvalRequests
   */
  export type AgentRun$approvalRequestsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    where?: ApprovalRequestWhereInput
    orderBy?: ApprovalRequestOrderByWithRelationInput | ApprovalRequestOrderByWithRelationInput[]
    cursor?: ApprovalRequestWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ApprovalRequestScalarFieldEnum | ApprovalRequestScalarFieldEnum[]
  }

  /**
   * AgentRun without action
   */
  export type AgentRunDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
  }


  /**
   * Model AgentRunStep
   */

  export type AggregateAgentRunStep = {
    _count: AgentRunStepCountAggregateOutputType | null
    _avg: AgentRunStepAvgAggregateOutputType | null
    _sum: AgentRunStepSumAggregateOutputType | null
    _min: AgentRunStepMinAggregateOutputType | null
    _max: AgentRunStepMaxAggregateOutputType | null
  }

  export type AgentRunStepAvgAggregateOutputType = {
    stepIndex: number | null
    tokensUsed: number | null
    estimatedCostUsd: Decimal | null
  }

  export type AgentRunStepSumAggregateOutputType = {
    stepIndex: number | null
    tokensUsed: number | null
    estimatedCostUsd: Decimal | null
  }

  export type AgentRunStepMinAggregateOutputType = {
    id: string | null
    organizationId: string | null
    agentRunId: string | null
    stepIndex: number | null
    stepType: $Enums.StepType | null
    name: string | null
    status: $Enums.StepStatus | null
    errorMessage: string | null
    tokensUsed: number | null
    estimatedCostUsd: Decimal | null
    startedAt: Date | null
    finishedAt: Date | null
    createdAt: Date | null
  }

  export type AgentRunStepMaxAggregateOutputType = {
    id: string | null
    organizationId: string | null
    agentRunId: string | null
    stepIndex: number | null
    stepType: $Enums.StepType | null
    name: string | null
    status: $Enums.StepStatus | null
    errorMessage: string | null
    tokensUsed: number | null
    estimatedCostUsd: Decimal | null
    startedAt: Date | null
    finishedAt: Date | null
    createdAt: Date | null
  }

  export type AgentRunStepCountAggregateOutputType = {
    id: number
    organizationId: number
    agentRunId: number
    stepIndex: number
    stepType: number
    name: number
    status: number
    inputJson: number
    outputJson: number
    errorMessage: number
    tokensUsed: number
    estimatedCostUsd: number
    startedAt: number
    finishedAt: number
    createdAt: number
    _all: number
  }


  export type AgentRunStepAvgAggregateInputType = {
    stepIndex?: true
    tokensUsed?: true
    estimatedCostUsd?: true
  }

  export type AgentRunStepSumAggregateInputType = {
    stepIndex?: true
    tokensUsed?: true
    estimatedCostUsd?: true
  }

  export type AgentRunStepMinAggregateInputType = {
    id?: true
    organizationId?: true
    agentRunId?: true
    stepIndex?: true
    stepType?: true
    name?: true
    status?: true
    errorMessage?: true
    tokensUsed?: true
    estimatedCostUsd?: true
    startedAt?: true
    finishedAt?: true
    createdAt?: true
  }

  export type AgentRunStepMaxAggregateInputType = {
    id?: true
    organizationId?: true
    agentRunId?: true
    stepIndex?: true
    stepType?: true
    name?: true
    status?: true
    errorMessage?: true
    tokensUsed?: true
    estimatedCostUsd?: true
    startedAt?: true
    finishedAt?: true
    createdAt?: true
  }

  export type AgentRunStepCountAggregateInputType = {
    id?: true
    organizationId?: true
    agentRunId?: true
    stepIndex?: true
    stepType?: true
    name?: true
    status?: true
    inputJson?: true
    outputJson?: true
    errorMessage?: true
    tokensUsed?: true
    estimatedCostUsd?: true
    startedAt?: true
    finishedAt?: true
    createdAt?: true
    _all?: true
  }

  export type AgentRunStepAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentRunStep to aggregate.
     */
    where?: AgentRunStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRunSteps to fetch.
     */
    orderBy?: AgentRunStepOrderByWithRelationInput | AgentRunStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AgentRunStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRunSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRunSteps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned AgentRunSteps
    **/
    _count?: true | AgentRunStepCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: AgentRunStepAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: AgentRunStepSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AgentRunStepMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AgentRunStepMaxAggregateInputType
  }

  export type GetAgentRunStepAggregateType<T extends AgentRunStepAggregateArgs> = {
        [P in keyof T & keyof AggregateAgentRunStep]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgentRunStep[P]>
      : GetScalarType<T[P], AggregateAgentRunStep[P]>
  }




  export type AgentRunStepGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentRunStepWhereInput
    orderBy?: AgentRunStepOrderByWithAggregationInput | AgentRunStepOrderByWithAggregationInput[]
    by: AgentRunStepScalarFieldEnum[] | AgentRunStepScalarFieldEnum
    having?: AgentRunStepScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AgentRunStepCountAggregateInputType | true
    _avg?: AgentRunStepAvgAggregateInputType
    _sum?: AgentRunStepSumAggregateInputType
    _min?: AgentRunStepMinAggregateInputType
    _max?: AgentRunStepMaxAggregateInputType
  }

  export type AgentRunStepGroupByOutputType = {
    id: string
    organizationId: string
    agentRunId: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status: $Enums.StepStatus
    inputJson: JsonValue | null
    outputJson: JsonValue | null
    errorMessage: string | null
    tokensUsed: number | null
    estimatedCostUsd: Decimal | null
    startedAt: Date | null
    finishedAt: Date | null
    createdAt: Date
    _count: AgentRunStepCountAggregateOutputType | null
    _avg: AgentRunStepAvgAggregateOutputType | null
    _sum: AgentRunStepSumAggregateOutputType | null
    _min: AgentRunStepMinAggregateOutputType | null
    _max: AgentRunStepMaxAggregateOutputType | null
  }

  type GetAgentRunStepGroupByPayload<T extends AgentRunStepGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AgentRunStepGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AgentRunStepGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AgentRunStepGroupByOutputType[P]>
            : GetScalarType<T[P], AgentRunStepGroupByOutputType[P]>
        }
      >
    >


  export type AgentRunStepSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    agentRunId?: boolean
    stepIndex?: boolean
    stepType?: boolean
    name?: boolean
    status?: boolean
    inputJson?: boolean
    outputJson?: boolean
    errorMessage?: boolean
    tokensUsed?: boolean
    estimatedCostUsd?: boolean
    startedAt?: boolean
    finishedAt?: boolean
    createdAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentRun?: boolean | AgentRunDefaultArgs<ExtArgs>
    approvalRequests?: boolean | AgentRunStep$approvalRequestsArgs<ExtArgs>
    _count?: boolean | AgentRunStepCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["agentRunStep"]>

  export type AgentRunStepSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    agentRunId?: boolean
    stepIndex?: boolean
    stepType?: boolean
    name?: boolean
    status?: boolean
    inputJson?: boolean
    outputJson?: boolean
    errorMessage?: boolean
    tokensUsed?: boolean
    estimatedCostUsd?: boolean
    startedAt?: boolean
    finishedAt?: boolean
    createdAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentRun?: boolean | AgentRunDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["agentRunStep"]>

  export type AgentRunStepSelectScalar = {
    id?: boolean
    organizationId?: boolean
    agentRunId?: boolean
    stepIndex?: boolean
    stepType?: boolean
    name?: boolean
    status?: boolean
    inputJson?: boolean
    outputJson?: boolean
    errorMessage?: boolean
    tokensUsed?: boolean
    estimatedCostUsd?: boolean
    startedAt?: boolean
    finishedAt?: boolean
    createdAt?: boolean
  }

  export type AgentRunStepInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentRun?: boolean | AgentRunDefaultArgs<ExtArgs>
    approvalRequests?: boolean | AgentRunStep$approvalRequestsArgs<ExtArgs>
    _count?: boolean | AgentRunStepCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type AgentRunStepIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentRun?: boolean | AgentRunDefaultArgs<ExtArgs>
  }

  export type $AgentRunStepPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "AgentRunStep"
    objects: {
      organization: Prisma.$OrganizationPayload<ExtArgs>
      agentRun: Prisma.$AgentRunPayload<ExtArgs>
      approvalRequests: Prisma.$ApprovalRequestPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      organizationId: string
      agentRunId: string
      stepIndex: number
      stepType: $Enums.StepType
      name: string
      status: $Enums.StepStatus
      inputJson: Prisma.JsonValue | null
      outputJson: Prisma.JsonValue | null
      errorMessage: string | null
      tokensUsed: number | null
      estimatedCostUsd: Prisma.Decimal | null
      startedAt: Date | null
      finishedAt: Date | null
      createdAt: Date
    }, ExtArgs["result"]["agentRunStep"]>
    composites: {}
  }

  type AgentRunStepGetPayload<S extends boolean | null | undefined | AgentRunStepDefaultArgs> = $Result.GetResult<Prisma.$AgentRunStepPayload, S>

  type AgentRunStepCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<AgentRunStepFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: AgentRunStepCountAggregateInputType | true
    }

  export interface AgentRunStepDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['AgentRunStep'], meta: { name: 'AgentRunStep' } }
    /**
     * Find zero or one AgentRunStep that matches the filter.
     * @param {AgentRunStepFindUniqueArgs} args - Arguments to find a AgentRunStep
     * @example
     * // Get one AgentRunStep
     * const agentRunStep = await prisma.agentRunStep.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AgentRunStepFindUniqueArgs>(args: SelectSubset<T, AgentRunStepFindUniqueArgs<ExtArgs>>): Prisma__AgentRunStepClient<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one AgentRunStep that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {AgentRunStepFindUniqueOrThrowArgs} args - Arguments to find a AgentRunStep
     * @example
     * // Get one AgentRunStep
     * const agentRunStep = await prisma.agentRunStep.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AgentRunStepFindUniqueOrThrowArgs>(args: SelectSubset<T, AgentRunStepFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AgentRunStepClient<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first AgentRunStep that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunStepFindFirstArgs} args - Arguments to find a AgentRunStep
     * @example
     * // Get one AgentRunStep
     * const agentRunStep = await prisma.agentRunStep.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AgentRunStepFindFirstArgs>(args?: SelectSubset<T, AgentRunStepFindFirstArgs<ExtArgs>>): Prisma__AgentRunStepClient<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first AgentRunStep that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunStepFindFirstOrThrowArgs} args - Arguments to find a AgentRunStep
     * @example
     * // Get one AgentRunStep
     * const agentRunStep = await prisma.agentRunStep.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AgentRunStepFindFirstOrThrowArgs>(args?: SelectSubset<T, AgentRunStepFindFirstOrThrowArgs<ExtArgs>>): Prisma__AgentRunStepClient<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more AgentRunSteps that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunStepFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all AgentRunSteps
     * const agentRunSteps = await prisma.agentRunStep.findMany()
     * 
     * // Get first 10 AgentRunSteps
     * const agentRunSteps = await prisma.agentRunStep.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agentRunStepWithIdOnly = await prisma.agentRunStep.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends AgentRunStepFindManyArgs>(args?: SelectSubset<T, AgentRunStepFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a AgentRunStep.
     * @param {AgentRunStepCreateArgs} args - Arguments to create a AgentRunStep.
     * @example
     * // Create one AgentRunStep
     * const AgentRunStep = await prisma.agentRunStep.create({
     *   data: {
     *     // ... data to create a AgentRunStep
     *   }
     * })
     * 
     */
    create<T extends AgentRunStepCreateArgs>(args: SelectSubset<T, AgentRunStepCreateArgs<ExtArgs>>): Prisma__AgentRunStepClient<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many AgentRunSteps.
     * @param {AgentRunStepCreateManyArgs} args - Arguments to create many AgentRunSteps.
     * @example
     * // Create many AgentRunSteps
     * const agentRunStep = await prisma.agentRunStep.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AgentRunStepCreateManyArgs>(args?: SelectSubset<T, AgentRunStepCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many AgentRunSteps and returns the data saved in the database.
     * @param {AgentRunStepCreateManyAndReturnArgs} args - Arguments to create many AgentRunSteps.
     * @example
     * // Create many AgentRunSteps
     * const agentRunStep = await prisma.agentRunStep.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many AgentRunSteps and only return the `id`
     * const agentRunStepWithIdOnly = await prisma.agentRunStep.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AgentRunStepCreateManyAndReturnArgs>(args?: SelectSubset<T, AgentRunStepCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a AgentRunStep.
     * @param {AgentRunStepDeleteArgs} args - Arguments to delete one AgentRunStep.
     * @example
     * // Delete one AgentRunStep
     * const AgentRunStep = await prisma.agentRunStep.delete({
     *   where: {
     *     // ... filter to delete one AgentRunStep
     *   }
     * })
     * 
     */
    delete<T extends AgentRunStepDeleteArgs>(args: SelectSubset<T, AgentRunStepDeleteArgs<ExtArgs>>): Prisma__AgentRunStepClient<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one AgentRunStep.
     * @param {AgentRunStepUpdateArgs} args - Arguments to update one AgentRunStep.
     * @example
     * // Update one AgentRunStep
     * const agentRunStep = await prisma.agentRunStep.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AgentRunStepUpdateArgs>(args: SelectSubset<T, AgentRunStepUpdateArgs<ExtArgs>>): Prisma__AgentRunStepClient<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more AgentRunSteps.
     * @param {AgentRunStepDeleteManyArgs} args - Arguments to filter AgentRunSteps to delete.
     * @example
     * // Delete a few AgentRunSteps
     * const { count } = await prisma.agentRunStep.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AgentRunStepDeleteManyArgs>(args?: SelectSubset<T, AgentRunStepDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more AgentRunSteps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunStepUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many AgentRunSteps
     * const agentRunStep = await prisma.agentRunStep.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AgentRunStepUpdateManyArgs>(args: SelectSubset<T, AgentRunStepUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one AgentRunStep.
     * @param {AgentRunStepUpsertArgs} args - Arguments to update or create a AgentRunStep.
     * @example
     * // Update or create a AgentRunStep
     * const agentRunStep = await prisma.agentRunStep.upsert({
     *   create: {
     *     // ... data to create a AgentRunStep
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the AgentRunStep we want to update
     *   }
     * })
     */
    upsert<T extends AgentRunStepUpsertArgs>(args: SelectSubset<T, AgentRunStepUpsertArgs<ExtArgs>>): Prisma__AgentRunStepClient<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of AgentRunSteps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunStepCountArgs} args - Arguments to filter AgentRunSteps to count.
     * @example
     * // Count the number of AgentRunSteps
     * const count = await prisma.agentRunStep.count({
     *   where: {
     *     // ... the filter for the AgentRunSteps we want to count
     *   }
     * })
    **/
    count<T extends AgentRunStepCountArgs>(
      args?: Subset<T, AgentRunStepCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AgentRunStepCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a AgentRunStep.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunStepAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AgentRunStepAggregateArgs>(args: Subset<T, AgentRunStepAggregateArgs>): Prisma.PrismaPromise<GetAgentRunStepAggregateType<T>>

    /**
     * Group by AgentRunStep.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunStepGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AgentRunStepGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AgentRunStepGroupByArgs['orderBy'] }
        : { orderBy?: AgentRunStepGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AgentRunStepGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgentRunStepGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the AgentRunStep model
   */
  readonly fields: AgentRunStepFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for AgentRunStep.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AgentRunStepClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    organization<T extends OrganizationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, OrganizationDefaultArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    agentRun<T extends AgentRunDefaultArgs<ExtArgs> = {}>(args?: Subset<T, AgentRunDefaultArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    approvalRequests<T extends AgentRunStep$approvalRequestsArgs<ExtArgs> = {}>(args?: Subset<T, AgentRunStep$approvalRequestsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the AgentRunStep model
   */ 
  interface AgentRunStepFieldRefs {
    readonly id: FieldRef<"AgentRunStep", 'String'>
    readonly organizationId: FieldRef<"AgentRunStep", 'String'>
    readonly agentRunId: FieldRef<"AgentRunStep", 'String'>
    readonly stepIndex: FieldRef<"AgentRunStep", 'Int'>
    readonly stepType: FieldRef<"AgentRunStep", 'StepType'>
    readonly name: FieldRef<"AgentRunStep", 'String'>
    readonly status: FieldRef<"AgentRunStep", 'StepStatus'>
    readonly inputJson: FieldRef<"AgentRunStep", 'Json'>
    readonly outputJson: FieldRef<"AgentRunStep", 'Json'>
    readonly errorMessage: FieldRef<"AgentRunStep", 'String'>
    readonly tokensUsed: FieldRef<"AgentRunStep", 'Int'>
    readonly estimatedCostUsd: FieldRef<"AgentRunStep", 'Decimal'>
    readonly startedAt: FieldRef<"AgentRunStep", 'DateTime'>
    readonly finishedAt: FieldRef<"AgentRunStep", 'DateTime'>
    readonly createdAt: FieldRef<"AgentRunStep", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * AgentRunStep findUnique
   */
  export type AgentRunStepFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    /**
     * Filter, which AgentRunStep to fetch.
     */
    where: AgentRunStepWhereUniqueInput
  }

  /**
   * AgentRunStep findUniqueOrThrow
   */
  export type AgentRunStepFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    /**
     * Filter, which AgentRunStep to fetch.
     */
    where: AgentRunStepWhereUniqueInput
  }

  /**
   * AgentRunStep findFirst
   */
  export type AgentRunStepFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    /**
     * Filter, which AgentRunStep to fetch.
     */
    where?: AgentRunStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRunSteps to fetch.
     */
    orderBy?: AgentRunStepOrderByWithRelationInput | AgentRunStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentRunSteps.
     */
    cursor?: AgentRunStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRunSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRunSteps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentRunSteps.
     */
    distinct?: AgentRunStepScalarFieldEnum | AgentRunStepScalarFieldEnum[]
  }

  /**
   * AgentRunStep findFirstOrThrow
   */
  export type AgentRunStepFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    /**
     * Filter, which AgentRunStep to fetch.
     */
    where?: AgentRunStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRunSteps to fetch.
     */
    orderBy?: AgentRunStepOrderByWithRelationInput | AgentRunStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentRunSteps.
     */
    cursor?: AgentRunStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRunSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRunSteps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentRunSteps.
     */
    distinct?: AgentRunStepScalarFieldEnum | AgentRunStepScalarFieldEnum[]
  }

  /**
   * AgentRunStep findMany
   */
  export type AgentRunStepFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    /**
     * Filter, which AgentRunSteps to fetch.
     */
    where?: AgentRunStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRunSteps to fetch.
     */
    orderBy?: AgentRunStepOrderByWithRelationInput | AgentRunStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing AgentRunSteps.
     */
    cursor?: AgentRunStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRunSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRunSteps.
     */
    skip?: number
    distinct?: AgentRunStepScalarFieldEnum | AgentRunStepScalarFieldEnum[]
  }

  /**
   * AgentRunStep create
   */
  export type AgentRunStepCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    /**
     * The data needed to create a AgentRunStep.
     */
    data: XOR<AgentRunStepCreateInput, AgentRunStepUncheckedCreateInput>
  }

  /**
   * AgentRunStep createMany
   */
  export type AgentRunStepCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many AgentRunSteps.
     */
    data: AgentRunStepCreateManyInput | AgentRunStepCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * AgentRunStep createManyAndReturn
   */
  export type AgentRunStepCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many AgentRunSteps.
     */
    data: AgentRunStepCreateManyInput | AgentRunStepCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * AgentRunStep update
   */
  export type AgentRunStepUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    /**
     * The data needed to update a AgentRunStep.
     */
    data: XOR<AgentRunStepUpdateInput, AgentRunStepUncheckedUpdateInput>
    /**
     * Choose, which AgentRunStep to update.
     */
    where: AgentRunStepWhereUniqueInput
  }

  /**
   * AgentRunStep updateMany
   */
  export type AgentRunStepUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update AgentRunSteps.
     */
    data: XOR<AgentRunStepUpdateManyMutationInput, AgentRunStepUncheckedUpdateManyInput>
    /**
     * Filter which AgentRunSteps to update
     */
    where?: AgentRunStepWhereInput
  }

  /**
   * AgentRunStep upsert
   */
  export type AgentRunStepUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    /**
     * The filter to search for the AgentRunStep to update in case it exists.
     */
    where: AgentRunStepWhereUniqueInput
    /**
     * In case the AgentRunStep found by the `where` argument doesn't exist, create a new AgentRunStep with this data.
     */
    create: XOR<AgentRunStepCreateInput, AgentRunStepUncheckedCreateInput>
    /**
     * In case the AgentRunStep was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AgentRunStepUpdateInput, AgentRunStepUncheckedUpdateInput>
  }

  /**
   * AgentRunStep delete
   */
  export type AgentRunStepDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    /**
     * Filter which AgentRunStep to delete.
     */
    where: AgentRunStepWhereUniqueInput
  }

  /**
   * AgentRunStep deleteMany
   */
  export type AgentRunStepDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentRunSteps to delete
     */
    where?: AgentRunStepWhereInput
  }

  /**
   * AgentRunStep.approvalRequests
   */
  export type AgentRunStep$approvalRequestsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    where?: ApprovalRequestWhereInput
    orderBy?: ApprovalRequestOrderByWithRelationInput | ApprovalRequestOrderByWithRelationInput[]
    cursor?: ApprovalRequestWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ApprovalRequestScalarFieldEnum | ApprovalRequestScalarFieldEnum[]
  }

  /**
   * AgentRunStep without action
   */
  export type AgentRunStepDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
  }


  /**
   * Model ApprovalRequest
   */

  export type AggregateApprovalRequest = {
    _count: ApprovalRequestCountAggregateOutputType | null
    _min: ApprovalRequestMinAggregateOutputType | null
    _max: ApprovalRequestMaxAggregateOutputType | null
  }

  export type ApprovalRequestMinAggregateOutputType = {
    id: string | null
    organizationId: string | null
    agentRunId: string | null
    agentRunStepId: string | null
    status: $Enums.ApprovalStatus | null
    title: string | null
    message: string | null
    requestedBySystem: boolean | null
    requestedAt: Date | null
    decidedAt: Date | null
    decidedByUserId: string | null
    decisionReason: string | null
  }

  export type ApprovalRequestMaxAggregateOutputType = {
    id: string | null
    organizationId: string | null
    agentRunId: string | null
    agentRunStepId: string | null
    status: $Enums.ApprovalStatus | null
    title: string | null
    message: string | null
    requestedBySystem: boolean | null
    requestedAt: Date | null
    decidedAt: Date | null
    decidedByUserId: string | null
    decisionReason: string | null
  }

  export type ApprovalRequestCountAggregateOutputType = {
    id: number
    organizationId: number
    agentRunId: number
    agentRunStepId: number
    status: number
    title: number
    message: number
    requestedBySystem: number
    requestedAt: number
    decidedAt: number
    decidedByUserId: number
    decisionReason: number
    _all: number
  }


  export type ApprovalRequestMinAggregateInputType = {
    id?: true
    organizationId?: true
    agentRunId?: true
    agentRunStepId?: true
    status?: true
    title?: true
    message?: true
    requestedBySystem?: true
    requestedAt?: true
    decidedAt?: true
    decidedByUserId?: true
    decisionReason?: true
  }

  export type ApprovalRequestMaxAggregateInputType = {
    id?: true
    organizationId?: true
    agentRunId?: true
    agentRunStepId?: true
    status?: true
    title?: true
    message?: true
    requestedBySystem?: true
    requestedAt?: true
    decidedAt?: true
    decidedByUserId?: true
    decisionReason?: true
  }

  export type ApprovalRequestCountAggregateInputType = {
    id?: true
    organizationId?: true
    agentRunId?: true
    agentRunStepId?: true
    status?: true
    title?: true
    message?: true
    requestedBySystem?: true
    requestedAt?: true
    decidedAt?: true
    decidedByUserId?: true
    decisionReason?: true
    _all?: true
  }

  export type ApprovalRequestAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ApprovalRequest to aggregate.
     */
    where?: ApprovalRequestWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ApprovalRequests to fetch.
     */
    orderBy?: ApprovalRequestOrderByWithRelationInput | ApprovalRequestOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ApprovalRequestWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ApprovalRequests from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ApprovalRequests.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned ApprovalRequests
    **/
    _count?: true | ApprovalRequestCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ApprovalRequestMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ApprovalRequestMaxAggregateInputType
  }

  export type GetApprovalRequestAggregateType<T extends ApprovalRequestAggregateArgs> = {
        [P in keyof T & keyof AggregateApprovalRequest]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateApprovalRequest[P]>
      : GetScalarType<T[P], AggregateApprovalRequest[P]>
  }




  export type ApprovalRequestGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ApprovalRequestWhereInput
    orderBy?: ApprovalRequestOrderByWithAggregationInput | ApprovalRequestOrderByWithAggregationInput[]
    by: ApprovalRequestScalarFieldEnum[] | ApprovalRequestScalarFieldEnum
    having?: ApprovalRequestScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ApprovalRequestCountAggregateInputType | true
    _min?: ApprovalRequestMinAggregateInputType
    _max?: ApprovalRequestMaxAggregateInputType
  }

  export type ApprovalRequestGroupByOutputType = {
    id: string
    organizationId: string
    agentRunId: string
    agentRunStepId: string | null
    status: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem: boolean
    requestedAt: Date
    decidedAt: Date | null
    decidedByUserId: string | null
    decisionReason: string | null
    _count: ApprovalRequestCountAggregateOutputType | null
    _min: ApprovalRequestMinAggregateOutputType | null
    _max: ApprovalRequestMaxAggregateOutputType | null
  }

  type GetApprovalRequestGroupByPayload<T extends ApprovalRequestGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ApprovalRequestGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ApprovalRequestGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ApprovalRequestGroupByOutputType[P]>
            : GetScalarType<T[P], ApprovalRequestGroupByOutputType[P]>
        }
      >
    >


  export type ApprovalRequestSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    agentRunId?: boolean
    agentRunStepId?: boolean
    status?: boolean
    title?: boolean
    message?: boolean
    requestedBySystem?: boolean
    requestedAt?: boolean
    decidedAt?: boolean
    decidedByUserId?: boolean
    decisionReason?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentRun?: boolean | AgentRunDefaultArgs<ExtArgs>
    agentRunStep?: boolean | ApprovalRequest$agentRunStepArgs<ExtArgs>
    decidedBy?: boolean | ApprovalRequest$decidedByArgs<ExtArgs>
  }, ExtArgs["result"]["approvalRequest"]>

  export type ApprovalRequestSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    agentRunId?: boolean
    agentRunStepId?: boolean
    status?: boolean
    title?: boolean
    message?: boolean
    requestedBySystem?: boolean
    requestedAt?: boolean
    decidedAt?: boolean
    decidedByUserId?: boolean
    decisionReason?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentRun?: boolean | AgentRunDefaultArgs<ExtArgs>
    agentRunStep?: boolean | ApprovalRequest$agentRunStepArgs<ExtArgs>
    decidedBy?: boolean | ApprovalRequest$decidedByArgs<ExtArgs>
  }, ExtArgs["result"]["approvalRequest"]>

  export type ApprovalRequestSelectScalar = {
    id?: boolean
    organizationId?: boolean
    agentRunId?: boolean
    agentRunStepId?: boolean
    status?: boolean
    title?: boolean
    message?: boolean
    requestedBySystem?: boolean
    requestedAt?: boolean
    decidedAt?: boolean
    decidedByUserId?: boolean
    decisionReason?: boolean
  }

  export type ApprovalRequestInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentRun?: boolean | AgentRunDefaultArgs<ExtArgs>
    agentRunStep?: boolean | ApprovalRequest$agentRunStepArgs<ExtArgs>
    decidedBy?: boolean | ApprovalRequest$decidedByArgs<ExtArgs>
  }
  export type ApprovalRequestIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentRun?: boolean | AgentRunDefaultArgs<ExtArgs>
    agentRunStep?: boolean | ApprovalRequest$agentRunStepArgs<ExtArgs>
    decidedBy?: boolean | ApprovalRequest$decidedByArgs<ExtArgs>
  }

  export type $ApprovalRequestPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "ApprovalRequest"
    objects: {
      organization: Prisma.$OrganizationPayload<ExtArgs>
      agentRun: Prisma.$AgentRunPayload<ExtArgs>
      agentRunStep: Prisma.$AgentRunStepPayload<ExtArgs> | null
      decidedBy: Prisma.$UserPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      organizationId: string
      agentRunId: string
      agentRunStepId: string | null
      status: $Enums.ApprovalStatus
      title: string
      message: string
      requestedBySystem: boolean
      requestedAt: Date
      decidedAt: Date | null
      decidedByUserId: string | null
      decisionReason: string | null
    }, ExtArgs["result"]["approvalRequest"]>
    composites: {}
  }

  type ApprovalRequestGetPayload<S extends boolean | null | undefined | ApprovalRequestDefaultArgs> = $Result.GetResult<Prisma.$ApprovalRequestPayload, S>

  type ApprovalRequestCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ApprovalRequestFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ApprovalRequestCountAggregateInputType | true
    }

  export interface ApprovalRequestDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['ApprovalRequest'], meta: { name: 'ApprovalRequest' } }
    /**
     * Find zero or one ApprovalRequest that matches the filter.
     * @param {ApprovalRequestFindUniqueArgs} args - Arguments to find a ApprovalRequest
     * @example
     * // Get one ApprovalRequest
     * const approvalRequest = await prisma.approvalRequest.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ApprovalRequestFindUniqueArgs>(args: SelectSubset<T, ApprovalRequestFindUniqueArgs<ExtArgs>>): Prisma__ApprovalRequestClient<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one ApprovalRequest that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ApprovalRequestFindUniqueOrThrowArgs} args - Arguments to find a ApprovalRequest
     * @example
     * // Get one ApprovalRequest
     * const approvalRequest = await prisma.approvalRequest.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ApprovalRequestFindUniqueOrThrowArgs>(args: SelectSubset<T, ApprovalRequestFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ApprovalRequestClient<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first ApprovalRequest that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ApprovalRequestFindFirstArgs} args - Arguments to find a ApprovalRequest
     * @example
     * // Get one ApprovalRequest
     * const approvalRequest = await prisma.approvalRequest.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ApprovalRequestFindFirstArgs>(args?: SelectSubset<T, ApprovalRequestFindFirstArgs<ExtArgs>>): Prisma__ApprovalRequestClient<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first ApprovalRequest that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ApprovalRequestFindFirstOrThrowArgs} args - Arguments to find a ApprovalRequest
     * @example
     * // Get one ApprovalRequest
     * const approvalRequest = await prisma.approvalRequest.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ApprovalRequestFindFirstOrThrowArgs>(args?: SelectSubset<T, ApprovalRequestFindFirstOrThrowArgs<ExtArgs>>): Prisma__ApprovalRequestClient<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more ApprovalRequests that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ApprovalRequestFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all ApprovalRequests
     * const approvalRequests = await prisma.approvalRequest.findMany()
     * 
     * // Get first 10 ApprovalRequests
     * const approvalRequests = await prisma.approvalRequest.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const approvalRequestWithIdOnly = await prisma.approvalRequest.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ApprovalRequestFindManyArgs>(args?: SelectSubset<T, ApprovalRequestFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a ApprovalRequest.
     * @param {ApprovalRequestCreateArgs} args - Arguments to create a ApprovalRequest.
     * @example
     * // Create one ApprovalRequest
     * const ApprovalRequest = await prisma.approvalRequest.create({
     *   data: {
     *     // ... data to create a ApprovalRequest
     *   }
     * })
     * 
     */
    create<T extends ApprovalRequestCreateArgs>(args: SelectSubset<T, ApprovalRequestCreateArgs<ExtArgs>>): Prisma__ApprovalRequestClient<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many ApprovalRequests.
     * @param {ApprovalRequestCreateManyArgs} args - Arguments to create many ApprovalRequests.
     * @example
     * // Create many ApprovalRequests
     * const approvalRequest = await prisma.approvalRequest.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ApprovalRequestCreateManyArgs>(args?: SelectSubset<T, ApprovalRequestCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many ApprovalRequests and returns the data saved in the database.
     * @param {ApprovalRequestCreateManyAndReturnArgs} args - Arguments to create many ApprovalRequests.
     * @example
     * // Create many ApprovalRequests
     * const approvalRequest = await prisma.approvalRequest.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many ApprovalRequests and only return the `id`
     * const approvalRequestWithIdOnly = await prisma.approvalRequest.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ApprovalRequestCreateManyAndReturnArgs>(args?: SelectSubset<T, ApprovalRequestCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a ApprovalRequest.
     * @param {ApprovalRequestDeleteArgs} args - Arguments to delete one ApprovalRequest.
     * @example
     * // Delete one ApprovalRequest
     * const ApprovalRequest = await prisma.approvalRequest.delete({
     *   where: {
     *     // ... filter to delete one ApprovalRequest
     *   }
     * })
     * 
     */
    delete<T extends ApprovalRequestDeleteArgs>(args: SelectSubset<T, ApprovalRequestDeleteArgs<ExtArgs>>): Prisma__ApprovalRequestClient<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one ApprovalRequest.
     * @param {ApprovalRequestUpdateArgs} args - Arguments to update one ApprovalRequest.
     * @example
     * // Update one ApprovalRequest
     * const approvalRequest = await prisma.approvalRequest.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ApprovalRequestUpdateArgs>(args: SelectSubset<T, ApprovalRequestUpdateArgs<ExtArgs>>): Prisma__ApprovalRequestClient<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more ApprovalRequests.
     * @param {ApprovalRequestDeleteManyArgs} args - Arguments to filter ApprovalRequests to delete.
     * @example
     * // Delete a few ApprovalRequests
     * const { count } = await prisma.approvalRequest.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ApprovalRequestDeleteManyArgs>(args?: SelectSubset<T, ApprovalRequestDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ApprovalRequests.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ApprovalRequestUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many ApprovalRequests
     * const approvalRequest = await prisma.approvalRequest.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ApprovalRequestUpdateManyArgs>(args: SelectSubset<T, ApprovalRequestUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one ApprovalRequest.
     * @param {ApprovalRequestUpsertArgs} args - Arguments to update or create a ApprovalRequest.
     * @example
     * // Update or create a ApprovalRequest
     * const approvalRequest = await prisma.approvalRequest.upsert({
     *   create: {
     *     // ... data to create a ApprovalRequest
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the ApprovalRequest we want to update
     *   }
     * })
     */
    upsert<T extends ApprovalRequestUpsertArgs>(args: SelectSubset<T, ApprovalRequestUpsertArgs<ExtArgs>>): Prisma__ApprovalRequestClient<$Result.GetResult<Prisma.$ApprovalRequestPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of ApprovalRequests.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ApprovalRequestCountArgs} args - Arguments to filter ApprovalRequests to count.
     * @example
     * // Count the number of ApprovalRequests
     * const count = await prisma.approvalRequest.count({
     *   where: {
     *     // ... the filter for the ApprovalRequests we want to count
     *   }
     * })
    **/
    count<T extends ApprovalRequestCountArgs>(
      args?: Subset<T, ApprovalRequestCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ApprovalRequestCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a ApprovalRequest.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ApprovalRequestAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ApprovalRequestAggregateArgs>(args: Subset<T, ApprovalRequestAggregateArgs>): Prisma.PrismaPromise<GetApprovalRequestAggregateType<T>>

    /**
     * Group by ApprovalRequest.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ApprovalRequestGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ApprovalRequestGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ApprovalRequestGroupByArgs['orderBy'] }
        : { orderBy?: ApprovalRequestGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ApprovalRequestGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetApprovalRequestGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the ApprovalRequest model
   */
  readonly fields: ApprovalRequestFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for ApprovalRequest.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ApprovalRequestClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    organization<T extends OrganizationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, OrganizationDefaultArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    agentRun<T extends AgentRunDefaultArgs<ExtArgs> = {}>(args?: Subset<T, AgentRunDefaultArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    agentRunStep<T extends ApprovalRequest$agentRunStepArgs<ExtArgs> = {}>(args?: Subset<T, ApprovalRequest$agentRunStepArgs<ExtArgs>>): Prisma__AgentRunStepClient<$Result.GetResult<Prisma.$AgentRunStepPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
    decidedBy<T extends ApprovalRequest$decidedByArgs<ExtArgs> = {}>(args?: Subset<T, ApprovalRequest$decidedByArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the ApprovalRequest model
   */ 
  interface ApprovalRequestFieldRefs {
    readonly id: FieldRef<"ApprovalRequest", 'String'>
    readonly organizationId: FieldRef<"ApprovalRequest", 'String'>
    readonly agentRunId: FieldRef<"ApprovalRequest", 'String'>
    readonly agentRunStepId: FieldRef<"ApprovalRequest", 'String'>
    readonly status: FieldRef<"ApprovalRequest", 'ApprovalStatus'>
    readonly title: FieldRef<"ApprovalRequest", 'String'>
    readonly message: FieldRef<"ApprovalRequest", 'String'>
    readonly requestedBySystem: FieldRef<"ApprovalRequest", 'Boolean'>
    readonly requestedAt: FieldRef<"ApprovalRequest", 'DateTime'>
    readonly decidedAt: FieldRef<"ApprovalRequest", 'DateTime'>
    readonly decidedByUserId: FieldRef<"ApprovalRequest", 'String'>
    readonly decisionReason: FieldRef<"ApprovalRequest", 'String'>
  }
    

  // Custom InputTypes
  /**
   * ApprovalRequest findUnique
   */
  export type ApprovalRequestFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    /**
     * Filter, which ApprovalRequest to fetch.
     */
    where: ApprovalRequestWhereUniqueInput
  }

  /**
   * ApprovalRequest findUniqueOrThrow
   */
  export type ApprovalRequestFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    /**
     * Filter, which ApprovalRequest to fetch.
     */
    where: ApprovalRequestWhereUniqueInput
  }

  /**
   * ApprovalRequest findFirst
   */
  export type ApprovalRequestFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    /**
     * Filter, which ApprovalRequest to fetch.
     */
    where?: ApprovalRequestWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ApprovalRequests to fetch.
     */
    orderBy?: ApprovalRequestOrderByWithRelationInput | ApprovalRequestOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ApprovalRequests.
     */
    cursor?: ApprovalRequestWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ApprovalRequests from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ApprovalRequests.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ApprovalRequests.
     */
    distinct?: ApprovalRequestScalarFieldEnum | ApprovalRequestScalarFieldEnum[]
  }

  /**
   * ApprovalRequest findFirstOrThrow
   */
  export type ApprovalRequestFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    /**
     * Filter, which ApprovalRequest to fetch.
     */
    where?: ApprovalRequestWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ApprovalRequests to fetch.
     */
    orderBy?: ApprovalRequestOrderByWithRelationInput | ApprovalRequestOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ApprovalRequests.
     */
    cursor?: ApprovalRequestWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ApprovalRequests from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ApprovalRequests.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ApprovalRequests.
     */
    distinct?: ApprovalRequestScalarFieldEnum | ApprovalRequestScalarFieldEnum[]
  }

  /**
   * ApprovalRequest findMany
   */
  export type ApprovalRequestFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    /**
     * Filter, which ApprovalRequests to fetch.
     */
    where?: ApprovalRequestWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ApprovalRequests to fetch.
     */
    orderBy?: ApprovalRequestOrderByWithRelationInput | ApprovalRequestOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing ApprovalRequests.
     */
    cursor?: ApprovalRequestWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ApprovalRequests from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ApprovalRequests.
     */
    skip?: number
    distinct?: ApprovalRequestScalarFieldEnum | ApprovalRequestScalarFieldEnum[]
  }

  /**
   * ApprovalRequest create
   */
  export type ApprovalRequestCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    /**
     * The data needed to create a ApprovalRequest.
     */
    data: XOR<ApprovalRequestCreateInput, ApprovalRequestUncheckedCreateInput>
  }

  /**
   * ApprovalRequest createMany
   */
  export type ApprovalRequestCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many ApprovalRequests.
     */
    data: ApprovalRequestCreateManyInput | ApprovalRequestCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ApprovalRequest createManyAndReturn
   */
  export type ApprovalRequestCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many ApprovalRequests.
     */
    data: ApprovalRequestCreateManyInput | ApprovalRequestCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * ApprovalRequest update
   */
  export type ApprovalRequestUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    /**
     * The data needed to update a ApprovalRequest.
     */
    data: XOR<ApprovalRequestUpdateInput, ApprovalRequestUncheckedUpdateInput>
    /**
     * Choose, which ApprovalRequest to update.
     */
    where: ApprovalRequestWhereUniqueInput
  }

  /**
   * ApprovalRequest updateMany
   */
  export type ApprovalRequestUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update ApprovalRequests.
     */
    data: XOR<ApprovalRequestUpdateManyMutationInput, ApprovalRequestUncheckedUpdateManyInput>
    /**
     * Filter which ApprovalRequests to update
     */
    where?: ApprovalRequestWhereInput
  }

  /**
   * ApprovalRequest upsert
   */
  export type ApprovalRequestUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    /**
     * The filter to search for the ApprovalRequest to update in case it exists.
     */
    where: ApprovalRequestWhereUniqueInput
    /**
     * In case the ApprovalRequest found by the `where` argument doesn't exist, create a new ApprovalRequest with this data.
     */
    create: XOR<ApprovalRequestCreateInput, ApprovalRequestUncheckedCreateInput>
    /**
     * In case the ApprovalRequest was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ApprovalRequestUpdateInput, ApprovalRequestUncheckedUpdateInput>
  }

  /**
   * ApprovalRequest delete
   */
  export type ApprovalRequestDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
    /**
     * Filter which ApprovalRequest to delete.
     */
    where: ApprovalRequestWhereUniqueInput
  }

  /**
   * ApprovalRequest deleteMany
   */
  export type ApprovalRequestDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ApprovalRequests to delete
     */
    where?: ApprovalRequestWhereInput
  }

  /**
   * ApprovalRequest.agentRunStep
   */
  export type ApprovalRequest$agentRunStepArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRunStep
     */
    select?: AgentRunStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunStepInclude<ExtArgs> | null
    where?: AgentRunStepWhereInput
  }

  /**
   * ApprovalRequest.decidedBy
   */
  export type ApprovalRequest$decidedByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    where?: UserWhereInput
  }

  /**
   * ApprovalRequest without action
   */
  export type ApprovalRequestDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ApprovalRequest
     */
    select?: ApprovalRequestSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ApprovalRequestInclude<ExtArgs> | null
  }


  /**
   * Model BudgetPolicy
   */

  export type AggregateBudgetPolicy = {
    _count: BudgetPolicyCountAggregateOutputType | null
    _avg: BudgetPolicyAvgAggregateOutputType | null
    _sum: BudgetPolicySumAggregateOutputType | null
    _min: BudgetPolicyMinAggregateOutputType | null
    _max: BudgetPolicyMaxAggregateOutputType | null
  }

  export type BudgetPolicyAvgAggregateOutputType = {
    maxTokensPerRun: number | null
    maxCostUsdPerRun: Decimal | null
    maxRunsPerDay: number | null
    maxRunsPerMonth: number | null
  }

  export type BudgetPolicySumAggregateOutputType = {
    maxTokensPerRun: number | null
    maxCostUsdPerRun: Decimal | null
    maxRunsPerDay: number | null
    maxRunsPerMonth: number | null
  }

  export type BudgetPolicyMinAggregateOutputType = {
    id: string | null
    organizationId: string | null
    agentJobId: string | null
    maxTokensPerRun: number | null
    maxCostUsdPerRun: Decimal | null
    maxRunsPerDay: number | null
    maxRunsPerMonth: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type BudgetPolicyMaxAggregateOutputType = {
    id: string | null
    organizationId: string | null
    agentJobId: string | null
    maxTokensPerRun: number | null
    maxCostUsdPerRun: Decimal | null
    maxRunsPerDay: number | null
    maxRunsPerMonth: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type BudgetPolicyCountAggregateOutputType = {
    id: number
    organizationId: number
    agentJobId: number
    maxTokensPerRun: number
    maxCostUsdPerRun: number
    maxRunsPerDay: number
    maxRunsPerMonth: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type BudgetPolicyAvgAggregateInputType = {
    maxTokensPerRun?: true
    maxCostUsdPerRun?: true
    maxRunsPerDay?: true
    maxRunsPerMonth?: true
  }

  export type BudgetPolicySumAggregateInputType = {
    maxTokensPerRun?: true
    maxCostUsdPerRun?: true
    maxRunsPerDay?: true
    maxRunsPerMonth?: true
  }

  export type BudgetPolicyMinAggregateInputType = {
    id?: true
    organizationId?: true
    agentJobId?: true
    maxTokensPerRun?: true
    maxCostUsdPerRun?: true
    maxRunsPerDay?: true
    maxRunsPerMonth?: true
    createdAt?: true
    updatedAt?: true
  }

  export type BudgetPolicyMaxAggregateInputType = {
    id?: true
    organizationId?: true
    agentJobId?: true
    maxTokensPerRun?: true
    maxCostUsdPerRun?: true
    maxRunsPerDay?: true
    maxRunsPerMonth?: true
    createdAt?: true
    updatedAt?: true
  }

  export type BudgetPolicyCountAggregateInputType = {
    id?: true
    organizationId?: true
    agentJobId?: true
    maxTokensPerRun?: true
    maxCostUsdPerRun?: true
    maxRunsPerDay?: true
    maxRunsPerMonth?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type BudgetPolicyAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which BudgetPolicy to aggregate.
     */
    where?: BudgetPolicyWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BudgetPolicies to fetch.
     */
    orderBy?: BudgetPolicyOrderByWithRelationInput | BudgetPolicyOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: BudgetPolicyWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BudgetPolicies from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BudgetPolicies.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned BudgetPolicies
    **/
    _count?: true | BudgetPolicyCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: BudgetPolicyAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: BudgetPolicySumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: BudgetPolicyMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: BudgetPolicyMaxAggregateInputType
  }

  export type GetBudgetPolicyAggregateType<T extends BudgetPolicyAggregateArgs> = {
        [P in keyof T & keyof AggregateBudgetPolicy]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateBudgetPolicy[P]>
      : GetScalarType<T[P], AggregateBudgetPolicy[P]>
  }




  export type BudgetPolicyGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: BudgetPolicyWhereInput
    orderBy?: BudgetPolicyOrderByWithAggregationInput | BudgetPolicyOrderByWithAggregationInput[]
    by: BudgetPolicyScalarFieldEnum[] | BudgetPolicyScalarFieldEnum
    having?: BudgetPolicyScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: BudgetPolicyCountAggregateInputType | true
    _avg?: BudgetPolicyAvgAggregateInputType
    _sum?: BudgetPolicySumAggregateInputType
    _min?: BudgetPolicyMinAggregateInputType
    _max?: BudgetPolicyMaxAggregateInputType
  }

  export type BudgetPolicyGroupByOutputType = {
    id: string
    organizationId: string
    agentJobId: string
    maxTokensPerRun: number | null
    maxCostUsdPerRun: Decimal | null
    maxRunsPerDay: number | null
    maxRunsPerMonth: number | null
    createdAt: Date
    updatedAt: Date
    _count: BudgetPolicyCountAggregateOutputType | null
    _avg: BudgetPolicyAvgAggregateOutputType | null
    _sum: BudgetPolicySumAggregateOutputType | null
    _min: BudgetPolicyMinAggregateOutputType | null
    _max: BudgetPolicyMaxAggregateOutputType | null
  }

  type GetBudgetPolicyGroupByPayload<T extends BudgetPolicyGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<BudgetPolicyGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof BudgetPolicyGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], BudgetPolicyGroupByOutputType[P]>
            : GetScalarType<T[P], BudgetPolicyGroupByOutputType[P]>
        }
      >
    >


  export type BudgetPolicySelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    agentJobId?: boolean
    maxTokensPerRun?: boolean
    maxCostUsdPerRun?: boolean
    maxRunsPerDay?: boolean
    maxRunsPerMonth?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentJob?: boolean | AgentJobDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["budgetPolicy"]>

  export type BudgetPolicySelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    agentJobId?: boolean
    maxTokensPerRun?: boolean
    maxCostUsdPerRun?: boolean
    maxRunsPerDay?: boolean
    maxRunsPerMonth?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentJob?: boolean | AgentJobDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["budgetPolicy"]>

  export type BudgetPolicySelectScalar = {
    id?: boolean
    organizationId?: boolean
    agentJobId?: boolean
    maxTokensPerRun?: boolean
    maxCostUsdPerRun?: boolean
    maxRunsPerDay?: boolean
    maxRunsPerMonth?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type BudgetPolicyInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentJob?: boolean | AgentJobDefaultArgs<ExtArgs>
  }
  export type BudgetPolicyIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    agentJob?: boolean | AgentJobDefaultArgs<ExtArgs>
  }

  export type $BudgetPolicyPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "BudgetPolicy"
    objects: {
      organization: Prisma.$OrganizationPayload<ExtArgs>
      agentJob: Prisma.$AgentJobPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      organizationId: string
      agentJobId: string
      maxTokensPerRun: number | null
      maxCostUsdPerRun: Prisma.Decimal | null
      maxRunsPerDay: number | null
      maxRunsPerMonth: number | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["budgetPolicy"]>
    composites: {}
  }

  type BudgetPolicyGetPayload<S extends boolean | null | undefined | BudgetPolicyDefaultArgs> = $Result.GetResult<Prisma.$BudgetPolicyPayload, S>

  type BudgetPolicyCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<BudgetPolicyFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: BudgetPolicyCountAggregateInputType | true
    }

  export interface BudgetPolicyDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['BudgetPolicy'], meta: { name: 'BudgetPolicy' } }
    /**
     * Find zero or one BudgetPolicy that matches the filter.
     * @param {BudgetPolicyFindUniqueArgs} args - Arguments to find a BudgetPolicy
     * @example
     * // Get one BudgetPolicy
     * const budgetPolicy = await prisma.budgetPolicy.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends BudgetPolicyFindUniqueArgs>(args: SelectSubset<T, BudgetPolicyFindUniqueArgs<ExtArgs>>): Prisma__BudgetPolicyClient<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one BudgetPolicy that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {BudgetPolicyFindUniqueOrThrowArgs} args - Arguments to find a BudgetPolicy
     * @example
     * // Get one BudgetPolicy
     * const budgetPolicy = await prisma.budgetPolicy.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends BudgetPolicyFindUniqueOrThrowArgs>(args: SelectSubset<T, BudgetPolicyFindUniqueOrThrowArgs<ExtArgs>>): Prisma__BudgetPolicyClient<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first BudgetPolicy that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BudgetPolicyFindFirstArgs} args - Arguments to find a BudgetPolicy
     * @example
     * // Get one BudgetPolicy
     * const budgetPolicy = await prisma.budgetPolicy.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends BudgetPolicyFindFirstArgs>(args?: SelectSubset<T, BudgetPolicyFindFirstArgs<ExtArgs>>): Prisma__BudgetPolicyClient<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first BudgetPolicy that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BudgetPolicyFindFirstOrThrowArgs} args - Arguments to find a BudgetPolicy
     * @example
     * // Get one BudgetPolicy
     * const budgetPolicy = await prisma.budgetPolicy.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends BudgetPolicyFindFirstOrThrowArgs>(args?: SelectSubset<T, BudgetPolicyFindFirstOrThrowArgs<ExtArgs>>): Prisma__BudgetPolicyClient<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more BudgetPolicies that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BudgetPolicyFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all BudgetPolicies
     * const budgetPolicies = await prisma.budgetPolicy.findMany()
     * 
     * // Get first 10 BudgetPolicies
     * const budgetPolicies = await prisma.budgetPolicy.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const budgetPolicyWithIdOnly = await prisma.budgetPolicy.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends BudgetPolicyFindManyArgs>(args?: SelectSubset<T, BudgetPolicyFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a BudgetPolicy.
     * @param {BudgetPolicyCreateArgs} args - Arguments to create a BudgetPolicy.
     * @example
     * // Create one BudgetPolicy
     * const BudgetPolicy = await prisma.budgetPolicy.create({
     *   data: {
     *     // ... data to create a BudgetPolicy
     *   }
     * })
     * 
     */
    create<T extends BudgetPolicyCreateArgs>(args: SelectSubset<T, BudgetPolicyCreateArgs<ExtArgs>>): Prisma__BudgetPolicyClient<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many BudgetPolicies.
     * @param {BudgetPolicyCreateManyArgs} args - Arguments to create many BudgetPolicies.
     * @example
     * // Create many BudgetPolicies
     * const budgetPolicy = await prisma.budgetPolicy.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends BudgetPolicyCreateManyArgs>(args?: SelectSubset<T, BudgetPolicyCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many BudgetPolicies and returns the data saved in the database.
     * @param {BudgetPolicyCreateManyAndReturnArgs} args - Arguments to create many BudgetPolicies.
     * @example
     * // Create many BudgetPolicies
     * const budgetPolicy = await prisma.budgetPolicy.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many BudgetPolicies and only return the `id`
     * const budgetPolicyWithIdOnly = await prisma.budgetPolicy.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends BudgetPolicyCreateManyAndReturnArgs>(args?: SelectSubset<T, BudgetPolicyCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a BudgetPolicy.
     * @param {BudgetPolicyDeleteArgs} args - Arguments to delete one BudgetPolicy.
     * @example
     * // Delete one BudgetPolicy
     * const BudgetPolicy = await prisma.budgetPolicy.delete({
     *   where: {
     *     // ... filter to delete one BudgetPolicy
     *   }
     * })
     * 
     */
    delete<T extends BudgetPolicyDeleteArgs>(args: SelectSubset<T, BudgetPolicyDeleteArgs<ExtArgs>>): Prisma__BudgetPolicyClient<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one BudgetPolicy.
     * @param {BudgetPolicyUpdateArgs} args - Arguments to update one BudgetPolicy.
     * @example
     * // Update one BudgetPolicy
     * const budgetPolicy = await prisma.budgetPolicy.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends BudgetPolicyUpdateArgs>(args: SelectSubset<T, BudgetPolicyUpdateArgs<ExtArgs>>): Prisma__BudgetPolicyClient<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more BudgetPolicies.
     * @param {BudgetPolicyDeleteManyArgs} args - Arguments to filter BudgetPolicies to delete.
     * @example
     * // Delete a few BudgetPolicies
     * const { count } = await prisma.budgetPolicy.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends BudgetPolicyDeleteManyArgs>(args?: SelectSubset<T, BudgetPolicyDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more BudgetPolicies.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BudgetPolicyUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many BudgetPolicies
     * const budgetPolicy = await prisma.budgetPolicy.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends BudgetPolicyUpdateManyArgs>(args: SelectSubset<T, BudgetPolicyUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one BudgetPolicy.
     * @param {BudgetPolicyUpsertArgs} args - Arguments to update or create a BudgetPolicy.
     * @example
     * // Update or create a BudgetPolicy
     * const budgetPolicy = await prisma.budgetPolicy.upsert({
     *   create: {
     *     // ... data to create a BudgetPolicy
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the BudgetPolicy we want to update
     *   }
     * })
     */
    upsert<T extends BudgetPolicyUpsertArgs>(args: SelectSubset<T, BudgetPolicyUpsertArgs<ExtArgs>>): Prisma__BudgetPolicyClient<$Result.GetResult<Prisma.$BudgetPolicyPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of BudgetPolicies.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BudgetPolicyCountArgs} args - Arguments to filter BudgetPolicies to count.
     * @example
     * // Count the number of BudgetPolicies
     * const count = await prisma.budgetPolicy.count({
     *   where: {
     *     // ... the filter for the BudgetPolicies we want to count
     *   }
     * })
    **/
    count<T extends BudgetPolicyCountArgs>(
      args?: Subset<T, BudgetPolicyCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], BudgetPolicyCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a BudgetPolicy.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BudgetPolicyAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends BudgetPolicyAggregateArgs>(args: Subset<T, BudgetPolicyAggregateArgs>): Prisma.PrismaPromise<GetBudgetPolicyAggregateType<T>>

    /**
     * Group by BudgetPolicy.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BudgetPolicyGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends BudgetPolicyGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: BudgetPolicyGroupByArgs['orderBy'] }
        : { orderBy?: BudgetPolicyGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, BudgetPolicyGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetBudgetPolicyGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the BudgetPolicy model
   */
  readonly fields: BudgetPolicyFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for BudgetPolicy.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__BudgetPolicyClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    organization<T extends OrganizationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, OrganizationDefaultArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    agentJob<T extends AgentJobDefaultArgs<ExtArgs> = {}>(args?: Subset<T, AgentJobDefaultArgs<ExtArgs>>): Prisma__AgentJobClient<$Result.GetResult<Prisma.$AgentJobPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the BudgetPolicy model
   */ 
  interface BudgetPolicyFieldRefs {
    readonly id: FieldRef<"BudgetPolicy", 'String'>
    readonly organizationId: FieldRef<"BudgetPolicy", 'String'>
    readonly agentJobId: FieldRef<"BudgetPolicy", 'String'>
    readonly maxTokensPerRun: FieldRef<"BudgetPolicy", 'Int'>
    readonly maxCostUsdPerRun: FieldRef<"BudgetPolicy", 'Decimal'>
    readonly maxRunsPerDay: FieldRef<"BudgetPolicy", 'Int'>
    readonly maxRunsPerMonth: FieldRef<"BudgetPolicy", 'Int'>
    readonly createdAt: FieldRef<"BudgetPolicy", 'DateTime'>
    readonly updatedAt: FieldRef<"BudgetPolicy", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * BudgetPolicy findUnique
   */
  export type BudgetPolicyFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    /**
     * Filter, which BudgetPolicy to fetch.
     */
    where: BudgetPolicyWhereUniqueInput
  }

  /**
   * BudgetPolicy findUniqueOrThrow
   */
  export type BudgetPolicyFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    /**
     * Filter, which BudgetPolicy to fetch.
     */
    where: BudgetPolicyWhereUniqueInput
  }

  /**
   * BudgetPolicy findFirst
   */
  export type BudgetPolicyFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    /**
     * Filter, which BudgetPolicy to fetch.
     */
    where?: BudgetPolicyWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BudgetPolicies to fetch.
     */
    orderBy?: BudgetPolicyOrderByWithRelationInput | BudgetPolicyOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for BudgetPolicies.
     */
    cursor?: BudgetPolicyWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BudgetPolicies from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BudgetPolicies.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of BudgetPolicies.
     */
    distinct?: BudgetPolicyScalarFieldEnum | BudgetPolicyScalarFieldEnum[]
  }

  /**
   * BudgetPolicy findFirstOrThrow
   */
  export type BudgetPolicyFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    /**
     * Filter, which BudgetPolicy to fetch.
     */
    where?: BudgetPolicyWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BudgetPolicies to fetch.
     */
    orderBy?: BudgetPolicyOrderByWithRelationInput | BudgetPolicyOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for BudgetPolicies.
     */
    cursor?: BudgetPolicyWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BudgetPolicies from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BudgetPolicies.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of BudgetPolicies.
     */
    distinct?: BudgetPolicyScalarFieldEnum | BudgetPolicyScalarFieldEnum[]
  }

  /**
   * BudgetPolicy findMany
   */
  export type BudgetPolicyFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    /**
     * Filter, which BudgetPolicies to fetch.
     */
    where?: BudgetPolicyWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BudgetPolicies to fetch.
     */
    orderBy?: BudgetPolicyOrderByWithRelationInput | BudgetPolicyOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing BudgetPolicies.
     */
    cursor?: BudgetPolicyWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BudgetPolicies from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BudgetPolicies.
     */
    skip?: number
    distinct?: BudgetPolicyScalarFieldEnum | BudgetPolicyScalarFieldEnum[]
  }

  /**
   * BudgetPolicy create
   */
  export type BudgetPolicyCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    /**
     * The data needed to create a BudgetPolicy.
     */
    data: XOR<BudgetPolicyCreateInput, BudgetPolicyUncheckedCreateInput>
  }

  /**
   * BudgetPolicy createMany
   */
  export type BudgetPolicyCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many BudgetPolicies.
     */
    data: BudgetPolicyCreateManyInput | BudgetPolicyCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * BudgetPolicy createManyAndReturn
   */
  export type BudgetPolicyCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many BudgetPolicies.
     */
    data: BudgetPolicyCreateManyInput | BudgetPolicyCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * BudgetPolicy update
   */
  export type BudgetPolicyUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    /**
     * The data needed to update a BudgetPolicy.
     */
    data: XOR<BudgetPolicyUpdateInput, BudgetPolicyUncheckedUpdateInput>
    /**
     * Choose, which BudgetPolicy to update.
     */
    where: BudgetPolicyWhereUniqueInput
  }

  /**
   * BudgetPolicy updateMany
   */
  export type BudgetPolicyUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update BudgetPolicies.
     */
    data: XOR<BudgetPolicyUpdateManyMutationInput, BudgetPolicyUncheckedUpdateManyInput>
    /**
     * Filter which BudgetPolicies to update
     */
    where?: BudgetPolicyWhereInput
  }

  /**
   * BudgetPolicy upsert
   */
  export type BudgetPolicyUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    /**
     * The filter to search for the BudgetPolicy to update in case it exists.
     */
    where: BudgetPolicyWhereUniqueInput
    /**
     * In case the BudgetPolicy found by the `where` argument doesn't exist, create a new BudgetPolicy with this data.
     */
    create: XOR<BudgetPolicyCreateInput, BudgetPolicyUncheckedCreateInput>
    /**
     * In case the BudgetPolicy was found with the provided `where` argument, update it with this data.
     */
    update: XOR<BudgetPolicyUpdateInput, BudgetPolicyUncheckedUpdateInput>
  }

  /**
   * BudgetPolicy delete
   */
  export type BudgetPolicyDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
    /**
     * Filter which BudgetPolicy to delete.
     */
    where: BudgetPolicyWhereUniqueInput
  }

  /**
   * BudgetPolicy deleteMany
   */
  export type BudgetPolicyDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which BudgetPolicies to delete
     */
    where?: BudgetPolicyWhereInput
  }

  /**
   * BudgetPolicy without action
   */
  export type BudgetPolicyDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BudgetPolicy
     */
    select?: BudgetPolicySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BudgetPolicyInclude<ExtArgs> | null
  }


  /**
   * Model AuditLog
   */

  export type AggregateAuditLog = {
    _count: AuditLogCountAggregateOutputType | null
    _min: AuditLogMinAggregateOutputType | null
    _max: AuditLogMaxAggregateOutputType | null
  }

  export type AuditLogMinAggregateOutputType = {
    id: string | null
    organizationId: string | null
    actorUserId: string | null
    entityType: string | null
    entityId: string | null
    action: string | null
    createdAt: Date | null
  }

  export type AuditLogMaxAggregateOutputType = {
    id: string | null
    organizationId: string | null
    actorUserId: string | null
    entityType: string | null
    entityId: string | null
    action: string | null
    createdAt: Date | null
  }

  export type AuditLogCountAggregateOutputType = {
    id: number
    organizationId: number
    actorUserId: number
    entityType: number
    entityId: number
    action: number
    metadataJson: number
    createdAt: number
    _all: number
  }


  export type AuditLogMinAggregateInputType = {
    id?: true
    organizationId?: true
    actorUserId?: true
    entityType?: true
    entityId?: true
    action?: true
    createdAt?: true
  }

  export type AuditLogMaxAggregateInputType = {
    id?: true
    organizationId?: true
    actorUserId?: true
    entityType?: true
    entityId?: true
    action?: true
    createdAt?: true
  }

  export type AuditLogCountAggregateInputType = {
    id?: true
    organizationId?: true
    actorUserId?: true
    entityType?: true
    entityId?: true
    action?: true
    metadataJson?: true
    createdAt?: true
    _all?: true
  }

  export type AuditLogAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AuditLog to aggregate.
     */
    where?: AuditLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AuditLogs to fetch.
     */
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AuditLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AuditLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AuditLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned AuditLogs
    **/
    _count?: true | AuditLogCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AuditLogMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AuditLogMaxAggregateInputType
  }

  export type GetAuditLogAggregateType<T extends AuditLogAggregateArgs> = {
        [P in keyof T & keyof AggregateAuditLog]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAuditLog[P]>
      : GetScalarType<T[P], AggregateAuditLog[P]>
  }




  export type AuditLogGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AuditLogWhereInput
    orderBy?: AuditLogOrderByWithAggregationInput | AuditLogOrderByWithAggregationInput[]
    by: AuditLogScalarFieldEnum[] | AuditLogScalarFieldEnum
    having?: AuditLogScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AuditLogCountAggregateInputType | true
    _min?: AuditLogMinAggregateInputType
    _max?: AuditLogMaxAggregateInputType
  }

  export type AuditLogGroupByOutputType = {
    id: string
    organizationId: string
    actorUserId: string | null
    entityType: string
    entityId: string
    action: string
    metadataJson: JsonValue | null
    createdAt: Date
    _count: AuditLogCountAggregateOutputType | null
    _min: AuditLogMinAggregateOutputType | null
    _max: AuditLogMaxAggregateOutputType | null
  }

  type GetAuditLogGroupByPayload<T extends AuditLogGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AuditLogGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AuditLogGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AuditLogGroupByOutputType[P]>
            : GetScalarType<T[P], AuditLogGroupByOutputType[P]>
        }
      >
    >


  export type AuditLogSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    actorUserId?: boolean
    entityType?: boolean
    entityId?: boolean
    action?: boolean
    metadataJson?: boolean
    createdAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    actor?: boolean | AuditLog$actorArgs<ExtArgs>
  }, ExtArgs["result"]["auditLog"]>

  export type AuditLogSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    actorUserId?: boolean
    entityType?: boolean
    entityId?: boolean
    action?: boolean
    metadataJson?: boolean
    createdAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    actor?: boolean | AuditLog$actorArgs<ExtArgs>
  }, ExtArgs["result"]["auditLog"]>

  export type AuditLogSelectScalar = {
    id?: boolean
    organizationId?: boolean
    actorUserId?: boolean
    entityType?: boolean
    entityId?: boolean
    action?: boolean
    metadataJson?: boolean
    createdAt?: boolean
  }

  export type AuditLogInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    actor?: boolean | AuditLog$actorArgs<ExtArgs>
  }
  export type AuditLogIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    actor?: boolean | AuditLog$actorArgs<ExtArgs>
  }

  export type $AuditLogPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "AuditLog"
    objects: {
      organization: Prisma.$OrganizationPayload<ExtArgs>
      actor: Prisma.$UserPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      organizationId: string
      actorUserId: string | null
      entityType: string
      entityId: string
      action: string
      metadataJson: Prisma.JsonValue | null
      createdAt: Date
    }, ExtArgs["result"]["auditLog"]>
    composites: {}
  }

  type AuditLogGetPayload<S extends boolean | null | undefined | AuditLogDefaultArgs> = $Result.GetResult<Prisma.$AuditLogPayload, S>

  type AuditLogCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<AuditLogFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: AuditLogCountAggregateInputType | true
    }

  export interface AuditLogDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['AuditLog'], meta: { name: 'AuditLog' } }
    /**
     * Find zero or one AuditLog that matches the filter.
     * @param {AuditLogFindUniqueArgs} args - Arguments to find a AuditLog
     * @example
     * // Get one AuditLog
     * const auditLog = await prisma.auditLog.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AuditLogFindUniqueArgs>(args: SelectSubset<T, AuditLogFindUniqueArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one AuditLog that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {AuditLogFindUniqueOrThrowArgs} args - Arguments to find a AuditLog
     * @example
     * // Get one AuditLog
     * const auditLog = await prisma.auditLog.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AuditLogFindUniqueOrThrowArgs>(args: SelectSubset<T, AuditLogFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first AuditLog that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogFindFirstArgs} args - Arguments to find a AuditLog
     * @example
     * // Get one AuditLog
     * const auditLog = await prisma.auditLog.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AuditLogFindFirstArgs>(args?: SelectSubset<T, AuditLogFindFirstArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first AuditLog that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogFindFirstOrThrowArgs} args - Arguments to find a AuditLog
     * @example
     * // Get one AuditLog
     * const auditLog = await prisma.auditLog.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AuditLogFindFirstOrThrowArgs>(args?: SelectSubset<T, AuditLogFindFirstOrThrowArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more AuditLogs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all AuditLogs
     * const auditLogs = await prisma.auditLog.findMany()
     * 
     * // Get first 10 AuditLogs
     * const auditLogs = await prisma.auditLog.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const auditLogWithIdOnly = await prisma.auditLog.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends AuditLogFindManyArgs>(args?: SelectSubset<T, AuditLogFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a AuditLog.
     * @param {AuditLogCreateArgs} args - Arguments to create a AuditLog.
     * @example
     * // Create one AuditLog
     * const AuditLog = await prisma.auditLog.create({
     *   data: {
     *     // ... data to create a AuditLog
     *   }
     * })
     * 
     */
    create<T extends AuditLogCreateArgs>(args: SelectSubset<T, AuditLogCreateArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many AuditLogs.
     * @param {AuditLogCreateManyArgs} args - Arguments to create many AuditLogs.
     * @example
     * // Create many AuditLogs
     * const auditLog = await prisma.auditLog.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AuditLogCreateManyArgs>(args?: SelectSubset<T, AuditLogCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many AuditLogs and returns the data saved in the database.
     * @param {AuditLogCreateManyAndReturnArgs} args - Arguments to create many AuditLogs.
     * @example
     * // Create many AuditLogs
     * const auditLog = await prisma.auditLog.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many AuditLogs and only return the `id`
     * const auditLogWithIdOnly = await prisma.auditLog.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AuditLogCreateManyAndReturnArgs>(args?: SelectSubset<T, AuditLogCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a AuditLog.
     * @param {AuditLogDeleteArgs} args - Arguments to delete one AuditLog.
     * @example
     * // Delete one AuditLog
     * const AuditLog = await prisma.auditLog.delete({
     *   where: {
     *     // ... filter to delete one AuditLog
     *   }
     * })
     * 
     */
    delete<T extends AuditLogDeleteArgs>(args: SelectSubset<T, AuditLogDeleteArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one AuditLog.
     * @param {AuditLogUpdateArgs} args - Arguments to update one AuditLog.
     * @example
     * // Update one AuditLog
     * const auditLog = await prisma.auditLog.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AuditLogUpdateArgs>(args: SelectSubset<T, AuditLogUpdateArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more AuditLogs.
     * @param {AuditLogDeleteManyArgs} args - Arguments to filter AuditLogs to delete.
     * @example
     * // Delete a few AuditLogs
     * const { count } = await prisma.auditLog.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AuditLogDeleteManyArgs>(args?: SelectSubset<T, AuditLogDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more AuditLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many AuditLogs
     * const auditLog = await prisma.auditLog.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AuditLogUpdateManyArgs>(args: SelectSubset<T, AuditLogUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one AuditLog.
     * @param {AuditLogUpsertArgs} args - Arguments to update or create a AuditLog.
     * @example
     * // Update or create a AuditLog
     * const auditLog = await prisma.auditLog.upsert({
     *   create: {
     *     // ... data to create a AuditLog
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the AuditLog we want to update
     *   }
     * })
     */
    upsert<T extends AuditLogUpsertArgs>(args: SelectSubset<T, AuditLogUpsertArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of AuditLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogCountArgs} args - Arguments to filter AuditLogs to count.
     * @example
     * // Count the number of AuditLogs
     * const count = await prisma.auditLog.count({
     *   where: {
     *     // ... the filter for the AuditLogs we want to count
     *   }
     * })
    **/
    count<T extends AuditLogCountArgs>(
      args?: Subset<T, AuditLogCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AuditLogCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a AuditLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AuditLogAggregateArgs>(args: Subset<T, AuditLogAggregateArgs>): Prisma.PrismaPromise<GetAuditLogAggregateType<T>>

    /**
     * Group by AuditLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AuditLogGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AuditLogGroupByArgs['orderBy'] }
        : { orderBy?: AuditLogGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AuditLogGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAuditLogGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the AuditLog model
   */
  readonly fields: AuditLogFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for AuditLog.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AuditLogClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    organization<T extends OrganizationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, OrganizationDefaultArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    actor<T extends AuditLog$actorArgs<ExtArgs> = {}>(args?: Subset<T, AuditLog$actorArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the AuditLog model
   */ 
  interface AuditLogFieldRefs {
    readonly id: FieldRef<"AuditLog", 'String'>
    readonly organizationId: FieldRef<"AuditLog", 'String'>
    readonly actorUserId: FieldRef<"AuditLog", 'String'>
    readonly entityType: FieldRef<"AuditLog", 'String'>
    readonly entityId: FieldRef<"AuditLog", 'String'>
    readonly action: FieldRef<"AuditLog", 'String'>
    readonly metadataJson: FieldRef<"AuditLog", 'Json'>
    readonly createdAt: FieldRef<"AuditLog", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * AuditLog findUnique
   */
  export type AuditLogFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter, which AuditLog to fetch.
     */
    where: AuditLogWhereUniqueInput
  }

  /**
   * AuditLog findUniqueOrThrow
   */
  export type AuditLogFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter, which AuditLog to fetch.
     */
    where: AuditLogWhereUniqueInput
  }

  /**
   * AuditLog findFirst
   */
  export type AuditLogFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter, which AuditLog to fetch.
     */
    where?: AuditLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AuditLogs to fetch.
     */
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AuditLogs.
     */
    cursor?: AuditLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AuditLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AuditLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AuditLogs.
     */
    distinct?: AuditLogScalarFieldEnum | AuditLogScalarFieldEnum[]
  }

  /**
   * AuditLog findFirstOrThrow
   */
  export type AuditLogFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter, which AuditLog to fetch.
     */
    where?: AuditLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AuditLogs to fetch.
     */
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AuditLogs.
     */
    cursor?: AuditLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AuditLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AuditLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AuditLogs.
     */
    distinct?: AuditLogScalarFieldEnum | AuditLogScalarFieldEnum[]
  }

  /**
   * AuditLog findMany
   */
  export type AuditLogFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter, which AuditLogs to fetch.
     */
    where?: AuditLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AuditLogs to fetch.
     */
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing AuditLogs.
     */
    cursor?: AuditLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AuditLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AuditLogs.
     */
    skip?: number
    distinct?: AuditLogScalarFieldEnum | AuditLogScalarFieldEnum[]
  }

  /**
   * AuditLog create
   */
  export type AuditLogCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * The data needed to create a AuditLog.
     */
    data: XOR<AuditLogCreateInput, AuditLogUncheckedCreateInput>
  }

  /**
   * AuditLog createMany
   */
  export type AuditLogCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many AuditLogs.
     */
    data: AuditLogCreateManyInput | AuditLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * AuditLog createManyAndReturn
   */
  export type AuditLogCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many AuditLogs.
     */
    data: AuditLogCreateManyInput | AuditLogCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * AuditLog update
   */
  export type AuditLogUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * The data needed to update a AuditLog.
     */
    data: XOR<AuditLogUpdateInput, AuditLogUncheckedUpdateInput>
    /**
     * Choose, which AuditLog to update.
     */
    where: AuditLogWhereUniqueInput
  }

  /**
   * AuditLog updateMany
   */
  export type AuditLogUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update AuditLogs.
     */
    data: XOR<AuditLogUpdateManyMutationInput, AuditLogUncheckedUpdateManyInput>
    /**
     * Filter which AuditLogs to update
     */
    where?: AuditLogWhereInput
  }

  /**
   * AuditLog upsert
   */
  export type AuditLogUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * The filter to search for the AuditLog to update in case it exists.
     */
    where: AuditLogWhereUniqueInput
    /**
     * In case the AuditLog found by the `where` argument doesn't exist, create a new AuditLog with this data.
     */
    create: XOR<AuditLogCreateInput, AuditLogUncheckedCreateInput>
    /**
     * In case the AuditLog was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AuditLogUpdateInput, AuditLogUncheckedUpdateInput>
  }

  /**
   * AuditLog delete
   */
  export type AuditLogDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter which AuditLog to delete.
     */
    where: AuditLogWhereUniqueInput
  }

  /**
   * AuditLog deleteMany
   */
  export type AuditLogDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AuditLogs to delete
     */
    where?: AuditLogWhereInput
  }

  /**
   * AuditLog.actor
   */
  export type AuditLog$actorArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    where?: UserWhereInput
  }

  /**
   * AuditLog without action
   */
  export type AuditLogDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const OrganizationScalarFieldEnum: {
    id: 'id',
    name: 'name',
    slug: 'slug',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type OrganizationScalarFieldEnum = (typeof OrganizationScalarFieldEnum)[keyof typeof OrganizationScalarFieldEnum]


  export const UserScalarFieldEnum: {
    id: 'id',
    organizationId: 'organizationId',
    email: 'email',
    name: 'name',
    role: 'role',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type UserScalarFieldEnum = (typeof UserScalarFieldEnum)[keyof typeof UserScalarFieldEnum]


  export const AgentJobScalarFieldEnum: {
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

  export type AgentJobScalarFieldEnum = (typeof AgentJobScalarFieldEnum)[keyof typeof AgentJobScalarFieldEnum]


  export const AgentRunScalarFieldEnum: {
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

  export type AgentRunScalarFieldEnum = (typeof AgentRunScalarFieldEnum)[keyof typeof AgentRunScalarFieldEnum]


  export const AgentRunStepScalarFieldEnum: {
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

  export type AgentRunStepScalarFieldEnum = (typeof AgentRunStepScalarFieldEnum)[keyof typeof AgentRunStepScalarFieldEnum]


  export const ApprovalRequestScalarFieldEnum: {
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

  export type ApprovalRequestScalarFieldEnum = (typeof ApprovalRequestScalarFieldEnum)[keyof typeof ApprovalRequestScalarFieldEnum]


  export const BudgetPolicyScalarFieldEnum: {
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

  export type BudgetPolicyScalarFieldEnum = (typeof BudgetPolicyScalarFieldEnum)[keyof typeof BudgetPolicyScalarFieldEnum]


  export const AuditLogScalarFieldEnum: {
    id: 'id',
    organizationId: 'organizationId',
    actorUserId: 'actorUserId',
    entityType: 'entityType',
    entityId: 'entityId',
    action: 'action',
    metadataJson: 'metadataJson',
    createdAt: 'createdAt'
  };

  export type AuditLogScalarFieldEnum = (typeof AuditLogScalarFieldEnum)[keyof typeof AuditLogScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const NullableJsonNullValueInput: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull
  };

  export type NullableJsonNullValueInput = (typeof NullableJsonNullValueInput)[keyof typeof NullableJsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  /**
   * Field references 
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'UserRole'
   */
  export type EnumUserRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'UserRole'>
    


  /**
   * Reference to a field of type 'UserRole[]'
   */
  export type ListEnumUserRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'UserRole[]'>
    


  /**
   * Reference to a field of type 'JobStatus'
   */
  export type EnumJobStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'JobStatus'>
    


  /**
   * Reference to a field of type 'JobStatus[]'
   */
  export type ListEnumJobStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'JobStatus[]'>
    


  /**
   * Reference to a field of type 'TriggerType'
   */
  export type EnumTriggerTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TriggerType'>
    


  /**
   * Reference to a field of type 'TriggerType[]'
   */
  export type ListEnumTriggerTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TriggerType[]'>
    


  /**
   * Reference to a field of type 'HttpMethod'
   */
  export type EnumHttpMethodFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'HttpMethod'>
    


  /**
   * Reference to a field of type 'HttpMethod[]'
   */
  export type ListEnumHttpMethodFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'HttpMethod[]'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'RunStatus'
   */
  export type EnumRunStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'RunStatus'>
    


  /**
   * Reference to a field of type 'RunStatus[]'
   */
  export type ListEnumRunStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'RunStatus[]'>
    


  /**
   * Reference to a field of type 'TriggerSource'
   */
  export type EnumTriggerSourceFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TriggerSource'>
    


  /**
   * Reference to a field of type 'TriggerSource[]'
   */
  export type ListEnumTriggerSourceFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TriggerSource[]'>
    


  /**
   * Reference to a field of type 'Decimal'
   */
  export type DecimalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Decimal'>
    


  /**
   * Reference to a field of type 'Decimal[]'
   */
  export type ListDecimalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Decimal[]'>
    


  /**
   * Reference to a field of type 'StepType'
   */
  export type EnumStepTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'StepType'>
    


  /**
   * Reference to a field of type 'StepType[]'
   */
  export type ListEnumStepTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'StepType[]'>
    


  /**
   * Reference to a field of type 'StepStatus'
   */
  export type EnumStepStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'StepStatus'>
    


  /**
   * Reference to a field of type 'StepStatus[]'
   */
  export type ListEnumStepStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'StepStatus[]'>
    


  /**
   * Reference to a field of type 'ApprovalStatus'
   */
  export type EnumApprovalStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ApprovalStatus'>
    


  /**
   * Reference to a field of type 'ApprovalStatus[]'
   */
  export type ListEnumApprovalStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ApprovalStatus[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    
  /**
   * Deep Input Types
   */


  export type OrganizationWhereInput = {
    AND?: OrganizationWhereInput | OrganizationWhereInput[]
    OR?: OrganizationWhereInput[]
    NOT?: OrganizationWhereInput | OrganizationWhereInput[]
    id?: StringFilter<"Organization"> | string
    name?: StringFilter<"Organization"> | string
    slug?: StringFilter<"Organization"> | string
    createdAt?: DateTimeFilter<"Organization"> | Date | string
    updatedAt?: DateTimeFilter<"Organization"> | Date | string
    users?: UserListRelationFilter
    agentJobs?: AgentJobListRelationFilter
    agentRuns?: AgentRunListRelationFilter
    agentRunSteps?: AgentRunStepListRelationFilter
    approvalRequests?: ApprovalRequestListRelationFilter
    budgetPolicies?: BudgetPolicyListRelationFilter
    auditLogs?: AuditLogListRelationFilter
  }

  export type OrganizationOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    slug?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    users?: UserOrderByRelationAggregateInput
    agentJobs?: AgentJobOrderByRelationAggregateInput
    agentRuns?: AgentRunOrderByRelationAggregateInput
    agentRunSteps?: AgentRunStepOrderByRelationAggregateInput
    approvalRequests?: ApprovalRequestOrderByRelationAggregateInput
    budgetPolicies?: BudgetPolicyOrderByRelationAggregateInput
    auditLogs?: AuditLogOrderByRelationAggregateInput
  }

  export type OrganizationWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    slug?: string
    AND?: OrganizationWhereInput | OrganizationWhereInput[]
    OR?: OrganizationWhereInput[]
    NOT?: OrganizationWhereInput | OrganizationWhereInput[]
    name?: StringFilter<"Organization"> | string
    createdAt?: DateTimeFilter<"Organization"> | Date | string
    updatedAt?: DateTimeFilter<"Organization"> | Date | string
    users?: UserListRelationFilter
    agentJobs?: AgentJobListRelationFilter
    agentRuns?: AgentRunListRelationFilter
    agentRunSteps?: AgentRunStepListRelationFilter
    approvalRequests?: ApprovalRequestListRelationFilter
    budgetPolicies?: BudgetPolicyListRelationFilter
    auditLogs?: AuditLogListRelationFilter
  }, "id" | "slug">

  export type OrganizationOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    slug?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: OrganizationCountOrderByAggregateInput
    _max?: OrganizationMaxOrderByAggregateInput
    _min?: OrganizationMinOrderByAggregateInput
  }

  export type OrganizationScalarWhereWithAggregatesInput = {
    AND?: OrganizationScalarWhereWithAggregatesInput | OrganizationScalarWhereWithAggregatesInput[]
    OR?: OrganizationScalarWhereWithAggregatesInput[]
    NOT?: OrganizationScalarWhereWithAggregatesInput | OrganizationScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Organization"> | string
    name?: StringWithAggregatesFilter<"Organization"> | string
    slug?: StringWithAggregatesFilter<"Organization"> | string
    createdAt?: DateTimeWithAggregatesFilter<"Organization"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Organization"> | Date | string
  }

  export type UserWhereInput = {
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    id?: StringFilter<"User"> | string
    organizationId?: StringFilter<"User"> | string
    email?: StringFilter<"User"> | string
    name?: StringNullableFilter<"User"> | string | null
    role?: EnumUserRoleFilter<"User"> | $Enums.UserRole
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    createdJobs?: AgentJobListRelationFilter
    approvalDecisions?: ApprovalRequestListRelationFilter
    auditLogs?: AuditLogListRelationFilter
  }

  export type UserOrderByWithRelationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    email?: SortOrder
    name?: SortOrderInput | SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    organization?: OrganizationOrderByWithRelationInput
    createdJobs?: AgentJobOrderByRelationAggregateInput
    approvalDecisions?: ApprovalRequestOrderByRelationAggregateInput
    auditLogs?: AuditLogOrderByRelationAggregateInput
  }

  export type UserWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    organizationId_email?: UserOrganizationIdEmailCompoundUniqueInput
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    organizationId?: StringFilter<"User"> | string
    email?: StringFilter<"User"> | string
    name?: StringNullableFilter<"User"> | string | null
    role?: EnumUserRoleFilter<"User"> | $Enums.UserRole
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    createdJobs?: AgentJobListRelationFilter
    approvalDecisions?: ApprovalRequestListRelationFilter
    auditLogs?: AuditLogListRelationFilter
  }, "id" | "organizationId_email">

  export type UserOrderByWithAggregationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    email?: SortOrder
    name?: SortOrderInput | SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: UserCountOrderByAggregateInput
    _max?: UserMaxOrderByAggregateInput
    _min?: UserMinOrderByAggregateInput
  }

  export type UserScalarWhereWithAggregatesInput = {
    AND?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    OR?: UserScalarWhereWithAggregatesInput[]
    NOT?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"User"> | string
    organizationId?: StringWithAggregatesFilter<"User"> | string
    email?: StringWithAggregatesFilter<"User"> | string
    name?: StringNullableWithAggregatesFilter<"User"> | string | null
    role?: EnumUserRoleWithAggregatesFilter<"User"> | $Enums.UserRole
    createdAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
  }

  export type AgentJobWhereInput = {
    AND?: AgentJobWhereInput | AgentJobWhereInput[]
    OR?: AgentJobWhereInput[]
    NOT?: AgentJobWhereInput | AgentJobWhereInput[]
    id?: StringFilter<"AgentJob"> | string
    organizationId?: StringFilter<"AgentJob"> | string
    name?: StringFilter<"AgentJob"> | string
    description?: StringNullableFilter<"AgentJob"> | string | null
    status?: EnumJobStatusFilter<"AgentJob"> | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFilter<"AgentJob"> | $Enums.TriggerType
    cronExpression?: StringNullableFilter<"AgentJob"> | string | null
    timezone?: StringFilter<"AgentJob"> | string
    endpointUrl?: StringFilter<"AgentJob"> | string
    httpMethod?: EnumHttpMethodFilter<"AgentJob"> | $Enums.HttpMethod
    headersJson?: JsonNullableFilter<"AgentJob">
    maxDurationSeconds?: IntFilter<"AgentJob"> | number
    maxRetries?: IntFilter<"AgentJob"> | number
    retryBackoffSeconds?: IntFilter<"AgentJob"> | number
    requireApprovalBeforeRun?: BoolFilter<"AgentJob"> | boolean
    requireApprovalBeforeExternalAction?: BoolFilter<"AgentJob"> | boolean
    createdByUserId?: StringFilter<"AgentJob"> | string
    createdAt?: DateTimeFilter<"AgentJob"> | Date | string
    updatedAt?: DateTimeFilter<"AgentJob"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    createdBy?: XOR<UserRelationFilter, UserWhereInput>
    runs?: AgentRunListRelationFilter
    budgetPolicy?: XOR<BudgetPolicyNullableRelationFilter, BudgetPolicyWhereInput> | null
  }

  export type AgentJobOrderByWithRelationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    status?: SortOrder
    triggerType?: SortOrder
    cronExpression?: SortOrderInput | SortOrder
    timezone?: SortOrder
    endpointUrl?: SortOrder
    httpMethod?: SortOrder
    headersJson?: SortOrderInput | SortOrder
    maxDurationSeconds?: SortOrder
    maxRetries?: SortOrder
    retryBackoffSeconds?: SortOrder
    requireApprovalBeforeRun?: SortOrder
    requireApprovalBeforeExternalAction?: SortOrder
    createdByUserId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    organization?: OrganizationOrderByWithRelationInput
    createdBy?: UserOrderByWithRelationInput
    runs?: AgentRunOrderByRelationAggregateInput
    budgetPolicy?: BudgetPolicyOrderByWithRelationInput
  }

  export type AgentJobWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: AgentJobWhereInput | AgentJobWhereInput[]
    OR?: AgentJobWhereInput[]
    NOT?: AgentJobWhereInput | AgentJobWhereInput[]
    organizationId?: StringFilter<"AgentJob"> | string
    name?: StringFilter<"AgentJob"> | string
    description?: StringNullableFilter<"AgentJob"> | string | null
    status?: EnumJobStatusFilter<"AgentJob"> | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFilter<"AgentJob"> | $Enums.TriggerType
    cronExpression?: StringNullableFilter<"AgentJob"> | string | null
    timezone?: StringFilter<"AgentJob"> | string
    endpointUrl?: StringFilter<"AgentJob"> | string
    httpMethod?: EnumHttpMethodFilter<"AgentJob"> | $Enums.HttpMethod
    headersJson?: JsonNullableFilter<"AgentJob">
    maxDurationSeconds?: IntFilter<"AgentJob"> | number
    maxRetries?: IntFilter<"AgentJob"> | number
    retryBackoffSeconds?: IntFilter<"AgentJob"> | number
    requireApprovalBeforeRun?: BoolFilter<"AgentJob"> | boolean
    requireApprovalBeforeExternalAction?: BoolFilter<"AgentJob"> | boolean
    createdByUserId?: StringFilter<"AgentJob"> | string
    createdAt?: DateTimeFilter<"AgentJob"> | Date | string
    updatedAt?: DateTimeFilter<"AgentJob"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    createdBy?: XOR<UserRelationFilter, UserWhereInput>
    runs?: AgentRunListRelationFilter
    budgetPolicy?: XOR<BudgetPolicyNullableRelationFilter, BudgetPolicyWhereInput> | null
  }, "id">

  export type AgentJobOrderByWithAggregationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    status?: SortOrder
    triggerType?: SortOrder
    cronExpression?: SortOrderInput | SortOrder
    timezone?: SortOrder
    endpointUrl?: SortOrder
    httpMethod?: SortOrder
    headersJson?: SortOrderInput | SortOrder
    maxDurationSeconds?: SortOrder
    maxRetries?: SortOrder
    retryBackoffSeconds?: SortOrder
    requireApprovalBeforeRun?: SortOrder
    requireApprovalBeforeExternalAction?: SortOrder
    createdByUserId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: AgentJobCountOrderByAggregateInput
    _avg?: AgentJobAvgOrderByAggregateInput
    _max?: AgentJobMaxOrderByAggregateInput
    _min?: AgentJobMinOrderByAggregateInput
    _sum?: AgentJobSumOrderByAggregateInput
  }

  export type AgentJobScalarWhereWithAggregatesInput = {
    AND?: AgentJobScalarWhereWithAggregatesInput | AgentJobScalarWhereWithAggregatesInput[]
    OR?: AgentJobScalarWhereWithAggregatesInput[]
    NOT?: AgentJobScalarWhereWithAggregatesInput | AgentJobScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"AgentJob"> | string
    organizationId?: StringWithAggregatesFilter<"AgentJob"> | string
    name?: StringWithAggregatesFilter<"AgentJob"> | string
    description?: StringNullableWithAggregatesFilter<"AgentJob"> | string | null
    status?: EnumJobStatusWithAggregatesFilter<"AgentJob"> | $Enums.JobStatus
    triggerType?: EnumTriggerTypeWithAggregatesFilter<"AgentJob"> | $Enums.TriggerType
    cronExpression?: StringNullableWithAggregatesFilter<"AgentJob"> | string | null
    timezone?: StringWithAggregatesFilter<"AgentJob"> | string
    endpointUrl?: StringWithAggregatesFilter<"AgentJob"> | string
    httpMethod?: EnumHttpMethodWithAggregatesFilter<"AgentJob"> | $Enums.HttpMethod
    headersJson?: JsonNullableWithAggregatesFilter<"AgentJob">
    maxDurationSeconds?: IntWithAggregatesFilter<"AgentJob"> | number
    maxRetries?: IntWithAggregatesFilter<"AgentJob"> | number
    retryBackoffSeconds?: IntWithAggregatesFilter<"AgentJob"> | number
    requireApprovalBeforeRun?: BoolWithAggregatesFilter<"AgentJob"> | boolean
    requireApprovalBeforeExternalAction?: BoolWithAggregatesFilter<"AgentJob"> | boolean
    createdByUserId?: StringWithAggregatesFilter<"AgentJob"> | string
    createdAt?: DateTimeWithAggregatesFilter<"AgentJob"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"AgentJob"> | Date | string
  }

  export type AgentRunWhereInput = {
    AND?: AgentRunWhereInput | AgentRunWhereInput[]
    OR?: AgentRunWhereInput[]
    NOT?: AgentRunWhereInput | AgentRunWhereInput[]
    id?: StringFilter<"AgentRun"> | string
    organizationId?: StringFilter<"AgentRun"> | string
    agentJobId?: StringFilter<"AgentRun"> | string
    status?: EnumRunStatusFilter<"AgentRun"> | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFilter<"AgentRun"> | $Enums.TriggerSource
    startedAt?: DateTimeNullableFilter<"AgentRun"> | Date | string | null
    finishedAt?: DateTimeNullableFilter<"AgentRun"> | Date | string | null
    durationMs?: IntNullableFilter<"AgentRun"> | number | null
    attemptNumber?: IntFilter<"AgentRun"> | number
    idempotencyKey?: StringFilter<"AgentRun"> | string
    inputJson?: JsonNullableFilter<"AgentRun">
    outputJson?: JsonNullableFilter<"AgentRun">
    errorMessage?: StringNullableFilter<"AgentRun"> | string | null
    totalTokens?: IntNullableFilter<"AgentRun"> | number | null
    estimatedCostUsd?: DecimalNullableFilter<"AgentRun"> | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFilter<"AgentRun"> | Date | string
    updatedAt?: DateTimeFilter<"AgentRun"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    agentJob?: XOR<AgentJobRelationFilter, AgentJobWhereInput>
    steps?: AgentRunStepListRelationFilter
    approvalRequests?: ApprovalRequestListRelationFilter
  }

  export type AgentRunOrderByWithRelationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentJobId?: SortOrder
    status?: SortOrder
    triggerSource?: SortOrder
    startedAt?: SortOrderInput | SortOrder
    finishedAt?: SortOrderInput | SortOrder
    durationMs?: SortOrderInput | SortOrder
    attemptNumber?: SortOrder
    idempotencyKey?: SortOrder
    inputJson?: SortOrderInput | SortOrder
    outputJson?: SortOrderInput | SortOrder
    errorMessage?: SortOrderInput | SortOrder
    totalTokens?: SortOrderInput | SortOrder
    estimatedCostUsd?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    organization?: OrganizationOrderByWithRelationInput
    agentJob?: AgentJobOrderByWithRelationInput
    steps?: AgentRunStepOrderByRelationAggregateInput
    approvalRequests?: ApprovalRequestOrderByRelationAggregateInput
  }

  export type AgentRunWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    agentJobId_idempotencyKey?: AgentRunAgentJobIdIdempotencyKeyCompoundUniqueInput
    AND?: AgentRunWhereInput | AgentRunWhereInput[]
    OR?: AgentRunWhereInput[]
    NOT?: AgentRunWhereInput | AgentRunWhereInput[]
    organizationId?: StringFilter<"AgentRun"> | string
    agentJobId?: StringFilter<"AgentRun"> | string
    status?: EnumRunStatusFilter<"AgentRun"> | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFilter<"AgentRun"> | $Enums.TriggerSource
    startedAt?: DateTimeNullableFilter<"AgentRun"> | Date | string | null
    finishedAt?: DateTimeNullableFilter<"AgentRun"> | Date | string | null
    durationMs?: IntNullableFilter<"AgentRun"> | number | null
    attemptNumber?: IntFilter<"AgentRun"> | number
    idempotencyKey?: StringFilter<"AgentRun"> | string
    inputJson?: JsonNullableFilter<"AgentRun">
    outputJson?: JsonNullableFilter<"AgentRun">
    errorMessage?: StringNullableFilter<"AgentRun"> | string | null
    totalTokens?: IntNullableFilter<"AgentRun"> | number | null
    estimatedCostUsd?: DecimalNullableFilter<"AgentRun"> | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFilter<"AgentRun"> | Date | string
    updatedAt?: DateTimeFilter<"AgentRun"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    agentJob?: XOR<AgentJobRelationFilter, AgentJobWhereInput>
    steps?: AgentRunStepListRelationFilter
    approvalRequests?: ApprovalRequestListRelationFilter
  }, "id" | "agentJobId_idempotencyKey">

  export type AgentRunOrderByWithAggregationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentJobId?: SortOrder
    status?: SortOrder
    triggerSource?: SortOrder
    startedAt?: SortOrderInput | SortOrder
    finishedAt?: SortOrderInput | SortOrder
    durationMs?: SortOrderInput | SortOrder
    attemptNumber?: SortOrder
    idempotencyKey?: SortOrder
    inputJson?: SortOrderInput | SortOrder
    outputJson?: SortOrderInput | SortOrder
    errorMessage?: SortOrderInput | SortOrder
    totalTokens?: SortOrderInput | SortOrder
    estimatedCostUsd?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: AgentRunCountOrderByAggregateInput
    _avg?: AgentRunAvgOrderByAggregateInput
    _max?: AgentRunMaxOrderByAggregateInput
    _min?: AgentRunMinOrderByAggregateInput
    _sum?: AgentRunSumOrderByAggregateInput
  }

  export type AgentRunScalarWhereWithAggregatesInput = {
    AND?: AgentRunScalarWhereWithAggregatesInput | AgentRunScalarWhereWithAggregatesInput[]
    OR?: AgentRunScalarWhereWithAggregatesInput[]
    NOT?: AgentRunScalarWhereWithAggregatesInput | AgentRunScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"AgentRun"> | string
    organizationId?: StringWithAggregatesFilter<"AgentRun"> | string
    agentJobId?: StringWithAggregatesFilter<"AgentRun"> | string
    status?: EnumRunStatusWithAggregatesFilter<"AgentRun"> | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceWithAggregatesFilter<"AgentRun"> | $Enums.TriggerSource
    startedAt?: DateTimeNullableWithAggregatesFilter<"AgentRun"> | Date | string | null
    finishedAt?: DateTimeNullableWithAggregatesFilter<"AgentRun"> | Date | string | null
    durationMs?: IntNullableWithAggregatesFilter<"AgentRun"> | number | null
    attemptNumber?: IntWithAggregatesFilter<"AgentRun"> | number
    idempotencyKey?: StringWithAggregatesFilter<"AgentRun"> | string
    inputJson?: JsonNullableWithAggregatesFilter<"AgentRun">
    outputJson?: JsonNullableWithAggregatesFilter<"AgentRun">
    errorMessage?: StringNullableWithAggregatesFilter<"AgentRun"> | string | null
    totalTokens?: IntNullableWithAggregatesFilter<"AgentRun"> | number | null
    estimatedCostUsd?: DecimalNullableWithAggregatesFilter<"AgentRun"> | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeWithAggregatesFilter<"AgentRun"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"AgentRun"> | Date | string
  }

  export type AgentRunStepWhereInput = {
    AND?: AgentRunStepWhereInput | AgentRunStepWhereInput[]
    OR?: AgentRunStepWhereInput[]
    NOT?: AgentRunStepWhereInput | AgentRunStepWhereInput[]
    id?: StringFilter<"AgentRunStep"> | string
    organizationId?: StringFilter<"AgentRunStep"> | string
    agentRunId?: StringFilter<"AgentRunStep"> | string
    stepIndex?: IntFilter<"AgentRunStep"> | number
    stepType?: EnumStepTypeFilter<"AgentRunStep"> | $Enums.StepType
    name?: StringFilter<"AgentRunStep"> | string
    status?: EnumStepStatusFilter<"AgentRunStep"> | $Enums.StepStatus
    inputJson?: JsonNullableFilter<"AgentRunStep">
    outputJson?: JsonNullableFilter<"AgentRunStep">
    errorMessage?: StringNullableFilter<"AgentRunStep"> | string | null
    tokensUsed?: IntNullableFilter<"AgentRunStep"> | number | null
    estimatedCostUsd?: DecimalNullableFilter<"AgentRunStep"> | Decimal | DecimalJsLike | number | string | null
    startedAt?: DateTimeNullableFilter<"AgentRunStep"> | Date | string | null
    finishedAt?: DateTimeNullableFilter<"AgentRunStep"> | Date | string | null
    createdAt?: DateTimeFilter<"AgentRunStep"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    agentRun?: XOR<AgentRunRelationFilter, AgentRunWhereInput>
    approvalRequests?: ApprovalRequestListRelationFilter
  }

  export type AgentRunStepOrderByWithRelationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentRunId?: SortOrder
    stepIndex?: SortOrder
    stepType?: SortOrder
    name?: SortOrder
    status?: SortOrder
    inputJson?: SortOrderInput | SortOrder
    outputJson?: SortOrderInput | SortOrder
    errorMessage?: SortOrderInput | SortOrder
    tokensUsed?: SortOrderInput | SortOrder
    estimatedCostUsd?: SortOrderInput | SortOrder
    startedAt?: SortOrderInput | SortOrder
    finishedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    organization?: OrganizationOrderByWithRelationInput
    agentRun?: AgentRunOrderByWithRelationInput
    approvalRequests?: ApprovalRequestOrderByRelationAggregateInput
  }

  export type AgentRunStepWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    agentRunId_stepIndex?: AgentRunStepAgentRunIdStepIndexCompoundUniqueInput
    AND?: AgentRunStepWhereInput | AgentRunStepWhereInput[]
    OR?: AgentRunStepWhereInput[]
    NOT?: AgentRunStepWhereInput | AgentRunStepWhereInput[]
    organizationId?: StringFilter<"AgentRunStep"> | string
    agentRunId?: StringFilter<"AgentRunStep"> | string
    stepIndex?: IntFilter<"AgentRunStep"> | number
    stepType?: EnumStepTypeFilter<"AgentRunStep"> | $Enums.StepType
    name?: StringFilter<"AgentRunStep"> | string
    status?: EnumStepStatusFilter<"AgentRunStep"> | $Enums.StepStatus
    inputJson?: JsonNullableFilter<"AgentRunStep">
    outputJson?: JsonNullableFilter<"AgentRunStep">
    errorMessage?: StringNullableFilter<"AgentRunStep"> | string | null
    tokensUsed?: IntNullableFilter<"AgentRunStep"> | number | null
    estimatedCostUsd?: DecimalNullableFilter<"AgentRunStep"> | Decimal | DecimalJsLike | number | string | null
    startedAt?: DateTimeNullableFilter<"AgentRunStep"> | Date | string | null
    finishedAt?: DateTimeNullableFilter<"AgentRunStep"> | Date | string | null
    createdAt?: DateTimeFilter<"AgentRunStep"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    agentRun?: XOR<AgentRunRelationFilter, AgentRunWhereInput>
    approvalRequests?: ApprovalRequestListRelationFilter
  }, "id" | "agentRunId_stepIndex">

  export type AgentRunStepOrderByWithAggregationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentRunId?: SortOrder
    stepIndex?: SortOrder
    stepType?: SortOrder
    name?: SortOrder
    status?: SortOrder
    inputJson?: SortOrderInput | SortOrder
    outputJson?: SortOrderInput | SortOrder
    errorMessage?: SortOrderInput | SortOrder
    tokensUsed?: SortOrderInput | SortOrder
    estimatedCostUsd?: SortOrderInput | SortOrder
    startedAt?: SortOrderInput | SortOrder
    finishedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: AgentRunStepCountOrderByAggregateInput
    _avg?: AgentRunStepAvgOrderByAggregateInput
    _max?: AgentRunStepMaxOrderByAggregateInput
    _min?: AgentRunStepMinOrderByAggregateInput
    _sum?: AgentRunStepSumOrderByAggregateInput
  }

  export type AgentRunStepScalarWhereWithAggregatesInput = {
    AND?: AgentRunStepScalarWhereWithAggregatesInput | AgentRunStepScalarWhereWithAggregatesInput[]
    OR?: AgentRunStepScalarWhereWithAggregatesInput[]
    NOT?: AgentRunStepScalarWhereWithAggregatesInput | AgentRunStepScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"AgentRunStep"> | string
    organizationId?: StringWithAggregatesFilter<"AgentRunStep"> | string
    agentRunId?: StringWithAggregatesFilter<"AgentRunStep"> | string
    stepIndex?: IntWithAggregatesFilter<"AgentRunStep"> | number
    stepType?: EnumStepTypeWithAggregatesFilter<"AgentRunStep"> | $Enums.StepType
    name?: StringWithAggregatesFilter<"AgentRunStep"> | string
    status?: EnumStepStatusWithAggregatesFilter<"AgentRunStep"> | $Enums.StepStatus
    inputJson?: JsonNullableWithAggregatesFilter<"AgentRunStep">
    outputJson?: JsonNullableWithAggregatesFilter<"AgentRunStep">
    errorMessage?: StringNullableWithAggregatesFilter<"AgentRunStep"> | string | null
    tokensUsed?: IntNullableWithAggregatesFilter<"AgentRunStep"> | number | null
    estimatedCostUsd?: DecimalNullableWithAggregatesFilter<"AgentRunStep"> | Decimal | DecimalJsLike | number | string | null
    startedAt?: DateTimeNullableWithAggregatesFilter<"AgentRunStep"> | Date | string | null
    finishedAt?: DateTimeNullableWithAggregatesFilter<"AgentRunStep"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"AgentRunStep"> | Date | string
  }

  export type ApprovalRequestWhereInput = {
    AND?: ApprovalRequestWhereInput | ApprovalRequestWhereInput[]
    OR?: ApprovalRequestWhereInput[]
    NOT?: ApprovalRequestWhereInput | ApprovalRequestWhereInput[]
    id?: StringFilter<"ApprovalRequest"> | string
    organizationId?: StringFilter<"ApprovalRequest"> | string
    agentRunId?: StringFilter<"ApprovalRequest"> | string
    agentRunStepId?: StringNullableFilter<"ApprovalRequest"> | string | null
    status?: EnumApprovalStatusFilter<"ApprovalRequest"> | $Enums.ApprovalStatus
    title?: StringFilter<"ApprovalRequest"> | string
    message?: StringFilter<"ApprovalRequest"> | string
    requestedBySystem?: BoolFilter<"ApprovalRequest"> | boolean
    requestedAt?: DateTimeFilter<"ApprovalRequest"> | Date | string
    decidedAt?: DateTimeNullableFilter<"ApprovalRequest"> | Date | string | null
    decidedByUserId?: StringNullableFilter<"ApprovalRequest"> | string | null
    decisionReason?: StringNullableFilter<"ApprovalRequest"> | string | null
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    agentRun?: XOR<AgentRunRelationFilter, AgentRunWhereInput>
    agentRunStep?: XOR<AgentRunStepNullableRelationFilter, AgentRunStepWhereInput> | null
    decidedBy?: XOR<UserNullableRelationFilter, UserWhereInput> | null
  }

  export type ApprovalRequestOrderByWithRelationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentRunId?: SortOrder
    agentRunStepId?: SortOrderInput | SortOrder
    status?: SortOrder
    title?: SortOrder
    message?: SortOrder
    requestedBySystem?: SortOrder
    requestedAt?: SortOrder
    decidedAt?: SortOrderInput | SortOrder
    decidedByUserId?: SortOrderInput | SortOrder
    decisionReason?: SortOrderInput | SortOrder
    organization?: OrganizationOrderByWithRelationInput
    agentRun?: AgentRunOrderByWithRelationInput
    agentRunStep?: AgentRunStepOrderByWithRelationInput
    decidedBy?: UserOrderByWithRelationInput
  }

  export type ApprovalRequestWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: ApprovalRequestWhereInput | ApprovalRequestWhereInput[]
    OR?: ApprovalRequestWhereInput[]
    NOT?: ApprovalRequestWhereInput | ApprovalRequestWhereInput[]
    organizationId?: StringFilter<"ApprovalRequest"> | string
    agentRunId?: StringFilter<"ApprovalRequest"> | string
    agentRunStepId?: StringNullableFilter<"ApprovalRequest"> | string | null
    status?: EnumApprovalStatusFilter<"ApprovalRequest"> | $Enums.ApprovalStatus
    title?: StringFilter<"ApprovalRequest"> | string
    message?: StringFilter<"ApprovalRequest"> | string
    requestedBySystem?: BoolFilter<"ApprovalRequest"> | boolean
    requestedAt?: DateTimeFilter<"ApprovalRequest"> | Date | string
    decidedAt?: DateTimeNullableFilter<"ApprovalRequest"> | Date | string | null
    decidedByUserId?: StringNullableFilter<"ApprovalRequest"> | string | null
    decisionReason?: StringNullableFilter<"ApprovalRequest"> | string | null
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    agentRun?: XOR<AgentRunRelationFilter, AgentRunWhereInput>
    agentRunStep?: XOR<AgentRunStepNullableRelationFilter, AgentRunStepWhereInput> | null
    decidedBy?: XOR<UserNullableRelationFilter, UserWhereInput> | null
  }, "id">

  export type ApprovalRequestOrderByWithAggregationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentRunId?: SortOrder
    agentRunStepId?: SortOrderInput | SortOrder
    status?: SortOrder
    title?: SortOrder
    message?: SortOrder
    requestedBySystem?: SortOrder
    requestedAt?: SortOrder
    decidedAt?: SortOrderInput | SortOrder
    decidedByUserId?: SortOrderInput | SortOrder
    decisionReason?: SortOrderInput | SortOrder
    _count?: ApprovalRequestCountOrderByAggregateInput
    _max?: ApprovalRequestMaxOrderByAggregateInput
    _min?: ApprovalRequestMinOrderByAggregateInput
  }

  export type ApprovalRequestScalarWhereWithAggregatesInput = {
    AND?: ApprovalRequestScalarWhereWithAggregatesInput | ApprovalRequestScalarWhereWithAggregatesInput[]
    OR?: ApprovalRequestScalarWhereWithAggregatesInput[]
    NOT?: ApprovalRequestScalarWhereWithAggregatesInput | ApprovalRequestScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"ApprovalRequest"> | string
    organizationId?: StringWithAggregatesFilter<"ApprovalRequest"> | string
    agentRunId?: StringWithAggregatesFilter<"ApprovalRequest"> | string
    agentRunStepId?: StringNullableWithAggregatesFilter<"ApprovalRequest"> | string | null
    status?: EnumApprovalStatusWithAggregatesFilter<"ApprovalRequest"> | $Enums.ApprovalStatus
    title?: StringWithAggregatesFilter<"ApprovalRequest"> | string
    message?: StringWithAggregatesFilter<"ApprovalRequest"> | string
    requestedBySystem?: BoolWithAggregatesFilter<"ApprovalRequest"> | boolean
    requestedAt?: DateTimeWithAggregatesFilter<"ApprovalRequest"> | Date | string
    decidedAt?: DateTimeNullableWithAggregatesFilter<"ApprovalRequest"> | Date | string | null
    decidedByUserId?: StringNullableWithAggregatesFilter<"ApprovalRequest"> | string | null
    decisionReason?: StringNullableWithAggregatesFilter<"ApprovalRequest"> | string | null
  }

  export type BudgetPolicyWhereInput = {
    AND?: BudgetPolicyWhereInput | BudgetPolicyWhereInput[]
    OR?: BudgetPolicyWhereInput[]
    NOT?: BudgetPolicyWhereInput | BudgetPolicyWhereInput[]
    id?: StringFilter<"BudgetPolicy"> | string
    organizationId?: StringFilter<"BudgetPolicy"> | string
    agentJobId?: StringFilter<"BudgetPolicy"> | string
    maxTokensPerRun?: IntNullableFilter<"BudgetPolicy"> | number | null
    maxCostUsdPerRun?: DecimalNullableFilter<"BudgetPolicy"> | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: IntNullableFilter<"BudgetPolicy"> | number | null
    maxRunsPerMonth?: IntNullableFilter<"BudgetPolicy"> | number | null
    createdAt?: DateTimeFilter<"BudgetPolicy"> | Date | string
    updatedAt?: DateTimeFilter<"BudgetPolicy"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    agentJob?: XOR<AgentJobRelationFilter, AgentJobWhereInput>
  }

  export type BudgetPolicyOrderByWithRelationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentJobId?: SortOrder
    maxTokensPerRun?: SortOrderInput | SortOrder
    maxCostUsdPerRun?: SortOrderInput | SortOrder
    maxRunsPerDay?: SortOrderInput | SortOrder
    maxRunsPerMonth?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    organization?: OrganizationOrderByWithRelationInput
    agentJob?: AgentJobOrderByWithRelationInput
  }

  export type BudgetPolicyWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    agentJobId?: string
    AND?: BudgetPolicyWhereInput | BudgetPolicyWhereInput[]
    OR?: BudgetPolicyWhereInput[]
    NOT?: BudgetPolicyWhereInput | BudgetPolicyWhereInput[]
    organizationId?: StringFilter<"BudgetPolicy"> | string
    maxTokensPerRun?: IntNullableFilter<"BudgetPolicy"> | number | null
    maxCostUsdPerRun?: DecimalNullableFilter<"BudgetPolicy"> | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: IntNullableFilter<"BudgetPolicy"> | number | null
    maxRunsPerMonth?: IntNullableFilter<"BudgetPolicy"> | number | null
    createdAt?: DateTimeFilter<"BudgetPolicy"> | Date | string
    updatedAt?: DateTimeFilter<"BudgetPolicy"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    agentJob?: XOR<AgentJobRelationFilter, AgentJobWhereInput>
  }, "id" | "agentJobId">

  export type BudgetPolicyOrderByWithAggregationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentJobId?: SortOrder
    maxTokensPerRun?: SortOrderInput | SortOrder
    maxCostUsdPerRun?: SortOrderInput | SortOrder
    maxRunsPerDay?: SortOrderInput | SortOrder
    maxRunsPerMonth?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: BudgetPolicyCountOrderByAggregateInput
    _avg?: BudgetPolicyAvgOrderByAggregateInput
    _max?: BudgetPolicyMaxOrderByAggregateInput
    _min?: BudgetPolicyMinOrderByAggregateInput
    _sum?: BudgetPolicySumOrderByAggregateInput
  }

  export type BudgetPolicyScalarWhereWithAggregatesInput = {
    AND?: BudgetPolicyScalarWhereWithAggregatesInput | BudgetPolicyScalarWhereWithAggregatesInput[]
    OR?: BudgetPolicyScalarWhereWithAggregatesInput[]
    NOT?: BudgetPolicyScalarWhereWithAggregatesInput | BudgetPolicyScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"BudgetPolicy"> | string
    organizationId?: StringWithAggregatesFilter<"BudgetPolicy"> | string
    agentJobId?: StringWithAggregatesFilter<"BudgetPolicy"> | string
    maxTokensPerRun?: IntNullableWithAggregatesFilter<"BudgetPolicy"> | number | null
    maxCostUsdPerRun?: DecimalNullableWithAggregatesFilter<"BudgetPolicy"> | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: IntNullableWithAggregatesFilter<"BudgetPolicy"> | number | null
    maxRunsPerMonth?: IntNullableWithAggregatesFilter<"BudgetPolicy"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"BudgetPolicy"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"BudgetPolicy"> | Date | string
  }

  export type AuditLogWhereInput = {
    AND?: AuditLogWhereInput | AuditLogWhereInput[]
    OR?: AuditLogWhereInput[]
    NOT?: AuditLogWhereInput | AuditLogWhereInput[]
    id?: StringFilter<"AuditLog"> | string
    organizationId?: StringFilter<"AuditLog"> | string
    actorUserId?: StringNullableFilter<"AuditLog"> | string | null
    entityType?: StringFilter<"AuditLog"> | string
    entityId?: StringFilter<"AuditLog"> | string
    action?: StringFilter<"AuditLog"> | string
    metadataJson?: JsonNullableFilter<"AuditLog">
    createdAt?: DateTimeFilter<"AuditLog"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    actor?: XOR<UserNullableRelationFilter, UserWhereInput> | null
  }

  export type AuditLogOrderByWithRelationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    actorUserId?: SortOrderInput | SortOrder
    entityType?: SortOrder
    entityId?: SortOrder
    action?: SortOrder
    metadataJson?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    organization?: OrganizationOrderByWithRelationInput
    actor?: UserOrderByWithRelationInput
  }

  export type AuditLogWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: AuditLogWhereInput | AuditLogWhereInput[]
    OR?: AuditLogWhereInput[]
    NOT?: AuditLogWhereInput | AuditLogWhereInput[]
    organizationId?: StringFilter<"AuditLog"> | string
    actorUserId?: StringNullableFilter<"AuditLog"> | string | null
    entityType?: StringFilter<"AuditLog"> | string
    entityId?: StringFilter<"AuditLog"> | string
    action?: StringFilter<"AuditLog"> | string
    metadataJson?: JsonNullableFilter<"AuditLog">
    createdAt?: DateTimeFilter<"AuditLog"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    actor?: XOR<UserNullableRelationFilter, UserWhereInput> | null
  }, "id">

  export type AuditLogOrderByWithAggregationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    actorUserId?: SortOrderInput | SortOrder
    entityType?: SortOrder
    entityId?: SortOrder
    action?: SortOrder
    metadataJson?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: AuditLogCountOrderByAggregateInput
    _max?: AuditLogMaxOrderByAggregateInput
    _min?: AuditLogMinOrderByAggregateInput
  }

  export type AuditLogScalarWhereWithAggregatesInput = {
    AND?: AuditLogScalarWhereWithAggregatesInput | AuditLogScalarWhereWithAggregatesInput[]
    OR?: AuditLogScalarWhereWithAggregatesInput[]
    NOT?: AuditLogScalarWhereWithAggregatesInput | AuditLogScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"AuditLog"> | string
    organizationId?: StringWithAggregatesFilter<"AuditLog"> | string
    actorUserId?: StringNullableWithAggregatesFilter<"AuditLog"> | string | null
    entityType?: StringWithAggregatesFilter<"AuditLog"> | string
    entityId?: StringWithAggregatesFilter<"AuditLog"> | string
    action?: StringWithAggregatesFilter<"AuditLog"> | string
    metadataJson?: JsonNullableWithAggregatesFilter<"AuditLog">
    createdAt?: DateTimeWithAggregatesFilter<"AuditLog"> | Date | string
  }

  export type OrganizationCreateInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobUncheckedCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepUncheckedCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyUncheckedCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUncheckedUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUncheckedUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationCreateManyInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OrganizationUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserCreateInput = {
    id?: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutUsersInput
    createdJobs?: AgentJobCreateNestedManyWithoutCreatedByInput
    approvalDecisions?: ApprovalRequestCreateNestedManyWithoutDecidedByInput
    auditLogs?: AuditLogCreateNestedManyWithoutActorInput
  }

  export type UserUncheckedCreateInput = {
    id?: string
    organizationId: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
    createdJobs?: AgentJobUncheckedCreateNestedManyWithoutCreatedByInput
    approvalDecisions?: ApprovalRequestUncheckedCreateNestedManyWithoutDecidedByInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutActorInput
  }

  export type UserUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutUsersNestedInput
    createdJobs?: AgentJobUpdateManyWithoutCreatedByNestedInput
    approvalDecisions?: ApprovalRequestUpdateManyWithoutDecidedByNestedInput
    auditLogs?: AuditLogUpdateManyWithoutActorNestedInput
  }

  export type UserUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    createdJobs?: AgentJobUncheckedUpdateManyWithoutCreatedByNestedInput
    approvalDecisions?: ApprovalRequestUncheckedUpdateManyWithoutDecidedByNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutActorNestedInput
  }

  export type UserCreateManyInput = {
    id?: string
    organizationId: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentJobCreateInput = {
    id?: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentJobsInput
    createdBy: UserCreateNestedOneWithoutCreatedJobsInput
    runs?: AgentRunCreateNestedManyWithoutAgentJobInput
    budgetPolicy?: BudgetPolicyCreateNestedOneWithoutAgentJobInput
  }

  export type AgentJobUncheckedCreateInput = {
    id?: string
    organizationId: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdByUserId: string
    createdAt?: Date | string
    updatedAt?: Date | string
    runs?: AgentRunUncheckedCreateNestedManyWithoutAgentJobInput
    budgetPolicy?: BudgetPolicyUncheckedCreateNestedOneWithoutAgentJobInput
  }

  export type AgentJobUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentJobsNestedInput
    createdBy?: UserUpdateOneRequiredWithoutCreatedJobsNestedInput
    runs?: AgentRunUpdateManyWithoutAgentJobNestedInput
    budgetPolicy?: BudgetPolicyUpdateOneWithoutAgentJobNestedInput
  }

  export type AgentJobUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    runs?: AgentRunUncheckedUpdateManyWithoutAgentJobNestedInput
    budgetPolicy?: BudgetPolicyUncheckedUpdateOneWithoutAgentJobNestedInput
  }

  export type AgentJobCreateManyInput = {
    id?: string
    organizationId: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdByUserId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentJobUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentJobUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunCreateInput = {
    id?: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentRunsInput
    agentJob: AgentJobCreateNestedOneWithoutRunsInput
    steps?: AgentRunStepCreateNestedManyWithoutAgentRunInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutAgentRunInput
  }

  export type AgentRunUncheckedCreateInput = {
    id?: string
    organizationId: string
    agentJobId: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: AgentRunStepUncheckedCreateNestedManyWithoutAgentRunInput
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutAgentRunInput
  }

  export type AgentRunUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentRunsNestedInput
    agentJob?: AgentJobUpdateOneRequiredWithoutRunsNestedInput
    steps?: AgentRunStepUpdateManyWithoutAgentRunNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutAgentRunNestedInput
  }

  export type AgentRunUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentJobId?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: AgentRunStepUncheckedUpdateManyWithoutAgentRunNestedInput
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutAgentRunNestedInput
  }

  export type AgentRunCreateManyInput = {
    id?: string
    organizationId: string
    agentJobId: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentRunUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentJobId?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunStepCreateInput = {
    id?: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentRunStepsInput
    agentRun: AgentRunCreateNestedOneWithoutStepsInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutAgentRunStepInput
  }

  export type AgentRunStepUncheckedCreateInput = {
    id?: string
    organizationId: string
    agentRunId: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutAgentRunStepInput
  }

  export type AgentRunStepUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentRunStepsNestedInput
    agentRun?: AgentRunUpdateOneRequiredWithoutStepsNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutAgentRunStepNestedInput
  }

  export type AgentRunStepUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutAgentRunStepNestedInput
  }

  export type AgentRunStepCreateManyInput = {
    id?: string
    organizationId: string
    agentRunId: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
  }

  export type AgentRunStepUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunStepUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ApprovalRequestCreateInput = {
    id?: string
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decisionReason?: string | null
    organization: OrganizationCreateNestedOneWithoutApprovalRequestsInput
    agentRun: AgentRunCreateNestedOneWithoutApprovalRequestsInput
    agentRunStep?: AgentRunStepCreateNestedOneWithoutApprovalRequestsInput
    decidedBy?: UserCreateNestedOneWithoutApprovalDecisionsInput
  }

  export type ApprovalRequestUncheckedCreateInput = {
    id?: string
    organizationId: string
    agentRunId: string
    agentRunStepId?: string | null
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decidedByUserId?: string | null
    decisionReason?: string | null
  }

  export type ApprovalRequestUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
    organization?: OrganizationUpdateOneRequiredWithoutApprovalRequestsNestedInput
    agentRun?: AgentRunUpdateOneRequiredWithoutApprovalRequestsNestedInput
    agentRunStep?: AgentRunStepUpdateOneWithoutApprovalRequestsNestedInput
    decidedBy?: UserUpdateOneWithoutApprovalDecisionsNestedInput
  }

  export type ApprovalRequestUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    agentRunStepId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decidedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type ApprovalRequestCreateManyInput = {
    id?: string
    organizationId: string
    agentRunId: string
    agentRunStepId?: string | null
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decidedByUserId?: string | null
    decisionReason?: string | null
  }

  export type ApprovalRequestUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type ApprovalRequestUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    agentRunStepId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decidedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type BudgetPolicyCreateInput = {
    id?: string
    maxTokensPerRun?: number | null
    maxCostUsdPerRun?: Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: number | null
    maxRunsPerMonth?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutBudgetPoliciesInput
    agentJob: AgentJobCreateNestedOneWithoutBudgetPolicyInput
  }

  export type BudgetPolicyUncheckedCreateInput = {
    id?: string
    organizationId: string
    agentJobId: string
    maxTokensPerRun?: number | null
    maxCostUsdPerRun?: Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: number | null
    maxRunsPerMonth?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BudgetPolicyUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    maxTokensPerRun?: NullableIntFieldUpdateOperationsInput | number | null
    maxCostUsdPerRun?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: NullableIntFieldUpdateOperationsInput | number | null
    maxRunsPerMonth?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutBudgetPoliciesNestedInput
    agentJob?: AgentJobUpdateOneRequiredWithoutBudgetPolicyNestedInput
  }

  export type BudgetPolicyUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentJobId?: StringFieldUpdateOperationsInput | string
    maxTokensPerRun?: NullableIntFieldUpdateOperationsInput | number | null
    maxCostUsdPerRun?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: NullableIntFieldUpdateOperationsInput | number | null
    maxRunsPerMonth?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BudgetPolicyCreateManyInput = {
    id?: string
    organizationId: string
    agentJobId: string
    maxTokensPerRun?: number | null
    maxCostUsdPerRun?: Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: number | null
    maxRunsPerMonth?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BudgetPolicyUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    maxTokensPerRun?: NullableIntFieldUpdateOperationsInput | number | null
    maxCostUsdPerRun?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: NullableIntFieldUpdateOperationsInput | number | null
    maxRunsPerMonth?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BudgetPolicyUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentJobId?: StringFieldUpdateOperationsInput | string
    maxTokensPerRun?: NullableIntFieldUpdateOperationsInput | number | null
    maxCostUsdPerRun?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: NullableIntFieldUpdateOperationsInput | number | null
    maxRunsPerMonth?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogCreateInput = {
    id?: string
    entityType: string
    entityId: string
    action: string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAuditLogsInput
    actor?: UserCreateNestedOneWithoutAuditLogsInput
  }

  export type AuditLogUncheckedCreateInput = {
    id?: string
    organizationId: string
    actorUserId?: string | null
    entityType: string
    entityId: string
    action: string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type AuditLogUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    entityType?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAuditLogsNestedInput
    actor?: UserUpdateOneWithoutAuditLogsNestedInput
  }

  export type AuditLogUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    actorUserId?: NullableStringFieldUpdateOperationsInput | string | null
    entityType?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogCreateManyInput = {
    id?: string
    organizationId: string
    actorUserId?: string | null
    entityType: string
    entityId: string
    action: string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type AuditLogUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    entityType?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    actorUserId?: NullableStringFieldUpdateOperationsInput | string | null
    entityType?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type UserListRelationFilter = {
    every?: UserWhereInput
    some?: UserWhereInput
    none?: UserWhereInput
  }

  export type AgentJobListRelationFilter = {
    every?: AgentJobWhereInput
    some?: AgentJobWhereInput
    none?: AgentJobWhereInput
  }

  export type AgentRunListRelationFilter = {
    every?: AgentRunWhereInput
    some?: AgentRunWhereInput
    none?: AgentRunWhereInput
  }

  export type AgentRunStepListRelationFilter = {
    every?: AgentRunStepWhereInput
    some?: AgentRunStepWhereInput
    none?: AgentRunStepWhereInput
  }

  export type ApprovalRequestListRelationFilter = {
    every?: ApprovalRequestWhereInput
    some?: ApprovalRequestWhereInput
    none?: ApprovalRequestWhereInput
  }

  export type BudgetPolicyListRelationFilter = {
    every?: BudgetPolicyWhereInput
    some?: BudgetPolicyWhereInput
    none?: BudgetPolicyWhereInput
  }

  export type AuditLogListRelationFilter = {
    every?: AuditLogWhereInput
    some?: AuditLogWhereInput
    none?: AuditLogWhereInput
  }

  export type UserOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type AgentJobOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type AgentRunOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type AgentRunStepOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ApprovalRequestOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type BudgetPolicyOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type AuditLogOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type OrganizationCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    slug?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type OrganizationMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    slug?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type OrganizationMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    slug?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type EnumUserRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.UserRole | EnumUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumUserRoleFilter<$PrismaModel> | $Enums.UserRole
  }

  export type OrganizationRelationFilter = {
    is?: OrganizationWhereInput
    isNot?: OrganizationWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type UserOrganizationIdEmailCompoundUniqueInput = {
    organizationId: string
    email: string
  }

  export type UserCountOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    email?: SortOrder
    name?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserMaxOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    email?: SortOrder
    name?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserMinOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    email?: SortOrder
    name?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type EnumUserRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.UserRole | EnumUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumUserRoleWithAggregatesFilter<$PrismaModel> | $Enums.UserRole
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumUserRoleFilter<$PrismaModel>
    _max?: NestedEnumUserRoleFilter<$PrismaModel>
  }

  export type EnumJobStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.JobStatus | EnumJobStatusFieldRefInput<$PrismaModel>
    in?: $Enums.JobStatus[] | ListEnumJobStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.JobStatus[] | ListEnumJobStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumJobStatusFilter<$PrismaModel> | $Enums.JobStatus
  }

  export type EnumTriggerTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.TriggerType | EnumTriggerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.TriggerType[] | ListEnumTriggerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.TriggerType[] | ListEnumTriggerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumTriggerTypeFilter<$PrismaModel> | $Enums.TriggerType
  }

  export type EnumHttpMethodFilter<$PrismaModel = never> = {
    equals?: $Enums.HttpMethod | EnumHttpMethodFieldRefInput<$PrismaModel>
    in?: $Enums.HttpMethod[] | ListEnumHttpMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.HttpMethod[] | ListEnumHttpMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumHttpMethodFilter<$PrismaModel> | $Enums.HttpMethod
  }
  export type JsonNullableFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type UserRelationFilter = {
    is?: UserWhereInput
    isNot?: UserWhereInput
  }

  export type BudgetPolicyNullableRelationFilter = {
    is?: BudgetPolicyWhereInput | null
    isNot?: BudgetPolicyWhereInput | null
  }

  export type AgentJobCountOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    status?: SortOrder
    triggerType?: SortOrder
    cronExpression?: SortOrder
    timezone?: SortOrder
    endpointUrl?: SortOrder
    httpMethod?: SortOrder
    headersJson?: SortOrder
    maxDurationSeconds?: SortOrder
    maxRetries?: SortOrder
    retryBackoffSeconds?: SortOrder
    requireApprovalBeforeRun?: SortOrder
    requireApprovalBeforeExternalAction?: SortOrder
    createdByUserId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AgentJobAvgOrderByAggregateInput = {
    maxDurationSeconds?: SortOrder
    maxRetries?: SortOrder
    retryBackoffSeconds?: SortOrder
  }

  export type AgentJobMaxOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    status?: SortOrder
    triggerType?: SortOrder
    cronExpression?: SortOrder
    timezone?: SortOrder
    endpointUrl?: SortOrder
    httpMethod?: SortOrder
    maxDurationSeconds?: SortOrder
    maxRetries?: SortOrder
    retryBackoffSeconds?: SortOrder
    requireApprovalBeforeRun?: SortOrder
    requireApprovalBeforeExternalAction?: SortOrder
    createdByUserId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AgentJobMinOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    status?: SortOrder
    triggerType?: SortOrder
    cronExpression?: SortOrder
    timezone?: SortOrder
    endpointUrl?: SortOrder
    httpMethod?: SortOrder
    maxDurationSeconds?: SortOrder
    maxRetries?: SortOrder
    retryBackoffSeconds?: SortOrder
    requireApprovalBeforeRun?: SortOrder
    requireApprovalBeforeExternalAction?: SortOrder
    createdByUserId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AgentJobSumOrderByAggregateInput = {
    maxDurationSeconds?: SortOrder
    maxRetries?: SortOrder
    retryBackoffSeconds?: SortOrder
  }

  export type EnumJobStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.JobStatus | EnumJobStatusFieldRefInput<$PrismaModel>
    in?: $Enums.JobStatus[] | ListEnumJobStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.JobStatus[] | ListEnumJobStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumJobStatusWithAggregatesFilter<$PrismaModel> | $Enums.JobStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumJobStatusFilter<$PrismaModel>
    _max?: NestedEnumJobStatusFilter<$PrismaModel>
  }

  export type EnumTriggerTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TriggerType | EnumTriggerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.TriggerType[] | ListEnumTriggerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.TriggerType[] | ListEnumTriggerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumTriggerTypeWithAggregatesFilter<$PrismaModel> | $Enums.TriggerType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTriggerTypeFilter<$PrismaModel>
    _max?: NestedEnumTriggerTypeFilter<$PrismaModel>
  }

  export type EnumHttpMethodWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.HttpMethod | EnumHttpMethodFieldRefInput<$PrismaModel>
    in?: $Enums.HttpMethod[] | ListEnumHttpMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.HttpMethod[] | ListEnumHttpMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumHttpMethodWithAggregatesFilter<$PrismaModel> | $Enums.HttpMethod
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumHttpMethodFilter<$PrismaModel>
    _max?: NestedEnumHttpMethodFilter<$PrismaModel>
  }
  export type JsonNullableWithAggregatesFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedJsonNullableFilter<$PrismaModel>
    _max?: NestedJsonNullableFilter<$PrismaModel>
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type EnumRunStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.RunStatus | EnumRunStatusFieldRefInput<$PrismaModel>
    in?: $Enums.RunStatus[] | ListEnumRunStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.RunStatus[] | ListEnumRunStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumRunStatusFilter<$PrismaModel> | $Enums.RunStatus
  }

  export type EnumTriggerSourceFilter<$PrismaModel = never> = {
    equals?: $Enums.TriggerSource | EnumTriggerSourceFieldRefInput<$PrismaModel>
    in?: $Enums.TriggerSource[] | ListEnumTriggerSourceFieldRefInput<$PrismaModel>
    notIn?: $Enums.TriggerSource[] | ListEnumTriggerSourceFieldRefInput<$PrismaModel>
    not?: NestedEnumTriggerSourceFilter<$PrismaModel> | $Enums.TriggerSource
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type IntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type DecimalNullableFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel> | null
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalNullableFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string | null
  }

  export type AgentJobRelationFilter = {
    is?: AgentJobWhereInput
    isNot?: AgentJobWhereInput
  }

  export type AgentRunAgentJobIdIdempotencyKeyCompoundUniqueInput = {
    agentJobId: string
    idempotencyKey: string
  }

  export type AgentRunCountOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentJobId?: SortOrder
    status?: SortOrder
    triggerSource?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrder
    durationMs?: SortOrder
    attemptNumber?: SortOrder
    idempotencyKey?: SortOrder
    inputJson?: SortOrder
    outputJson?: SortOrder
    errorMessage?: SortOrder
    totalTokens?: SortOrder
    estimatedCostUsd?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AgentRunAvgOrderByAggregateInput = {
    durationMs?: SortOrder
    attemptNumber?: SortOrder
    totalTokens?: SortOrder
    estimatedCostUsd?: SortOrder
  }

  export type AgentRunMaxOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentJobId?: SortOrder
    status?: SortOrder
    triggerSource?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrder
    durationMs?: SortOrder
    attemptNumber?: SortOrder
    idempotencyKey?: SortOrder
    errorMessage?: SortOrder
    totalTokens?: SortOrder
    estimatedCostUsd?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AgentRunMinOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentJobId?: SortOrder
    status?: SortOrder
    triggerSource?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrder
    durationMs?: SortOrder
    attemptNumber?: SortOrder
    idempotencyKey?: SortOrder
    errorMessage?: SortOrder
    totalTokens?: SortOrder
    estimatedCostUsd?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AgentRunSumOrderByAggregateInput = {
    durationMs?: SortOrder
    attemptNumber?: SortOrder
    totalTokens?: SortOrder
    estimatedCostUsd?: SortOrder
  }

  export type EnumRunStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.RunStatus | EnumRunStatusFieldRefInput<$PrismaModel>
    in?: $Enums.RunStatus[] | ListEnumRunStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.RunStatus[] | ListEnumRunStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumRunStatusWithAggregatesFilter<$PrismaModel> | $Enums.RunStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumRunStatusFilter<$PrismaModel>
    _max?: NestedEnumRunStatusFilter<$PrismaModel>
  }

  export type EnumTriggerSourceWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TriggerSource | EnumTriggerSourceFieldRefInput<$PrismaModel>
    in?: $Enums.TriggerSource[] | ListEnumTriggerSourceFieldRefInput<$PrismaModel>
    notIn?: $Enums.TriggerSource[] | ListEnumTriggerSourceFieldRefInput<$PrismaModel>
    not?: NestedEnumTriggerSourceWithAggregatesFilter<$PrismaModel> | $Enums.TriggerSource
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTriggerSourceFilter<$PrismaModel>
    _max?: NestedEnumTriggerSourceFilter<$PrismaModel>
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type IntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type DecimalNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel> | null
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalNullableWithAggregatesFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedDecimalNullableFilter<$PrismaModel>
    _sum?: NestedDecimalNullableFilter<$PrismaModel>
    _min?: NestedDecimalNullableFilter<$PrismaModel>
    _max?: NestedDecimalNullableFilter<$PrismaModel>
  }

  export type EnumStepTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.StepType | EnumStepTypeFieldRefInput<$PrismaModel>
    in?: $Enums.StepType[] | ListEnumStepTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.StepType[] | ListEnumStepTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumStepTypeFilter<$PrismaModel> | $Enums.StepType
  }

  export type EnumStepStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.StepStatus | EnumStepStatusFieldRefInput<$PrismaModel>
    in?: $Enums.StepStatus[] | ListEnumStepStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.StepStatus[] | ListEnumStepStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumStepStatusFilter<$PrismaModel> | $Enums.StepStatus
  }

  export type AgentRunRelationFilter = {
    is?: AgentRunWhereInput
    isNot?: AgentRunWhereInput
  }

  export type AgentRunStepAgentRunIdStepIndexCompoundUniqueInput = {
    agentRunId: string
    stepIndex: number
  }

  export type AgentRunStepCountOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentRunId?: SortOrder
    stepIndex?: SortOrder
    stepType?: SortOrder
    name?: SortOrder
    status?: SortOrder
    inputJson?: SortOrder
    outputJson?: SortOrder
    errorMessage?: SortOrder
    tokensUsed?: SortOrder
    estimatedCostUsd?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrder
    createdAt?: SortOrder
  }

  export type AgentRunStepAvgOrderByAggregateInput = {
    stepIndex?: SortOrder
    tokensUsed?: SortOrder
    estimatedCostUsd?: SortOrder
  }

  export type AgentRunStepMaxOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentRunId?: SortOrder
    stepIndex?: SortOrder
    stepType?: SortOrder
    name?: SortOrder
    status?: SortOrder
    errorMessage?: SortOrder
    tokensUsed?: SortOrder
    estimatedCostUsd?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrder
    createdAt?: SortOrder
  }

  export type AgentRunStepMinOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentRunId?: SortOrder
    stepIndex?: SortOrder
    stepType?: SortOrder
    name?: SortOrder
    status?: SortOrder
    errorMessage?: SortOrder
    tokensUsed?: SortOrder
    estimatedCostUsd?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrder
    createdAt?: SortOrder
  }

  export type AgentRunStepSumOrderByAggregateInput = {
    stepIndex?: SortOrder
    tokensUsed?: SortOrder
    estimatedCostUsd?: SortOrder
  }

  export type EnumStepTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.StepType | EnumStepTypeFieldRefInput<$PrismaModel>
    in?: $Enums.StepType[] | ListEnumStepTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.StepType[] | ListEnumStepTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumStepTypeWithAggregatesFilter<$PrismaModel> | $Enums.StepType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumStepTypeFilter<$PrismaModel>
    _max?: NestedEnumStepTypeFilter<$PrismaModel>
  }

  export type EnumStepStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.StepStatus | EnumStepStatusFieldRefInput<$PrismaModel>
    in?: $Enums.StepStatus[] | ListEnumStepStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.StepStatus[] | ListEnumStepStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumStepStatusWithAggregatesFilter<$PrismaModel> | $Enums.StepStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumStepStatusFilter<$PrismaModel>
    _max?: NestedEnumStepStatusFilter<$PrismaModel>
  }

  export type EnumApprovalStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.ApprovalStatus | EnumApprovalStatusFieldRefInput<$PrismaModel>
    in?: $Enums.ApprovalStatus[] | ListEnumApprovalStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.ApprovalStatus[] | ListEnumApprovalStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumApprovalStatusFilter<$PrismaModel> | $Enums.ApprovalStatus
  }

  export type AgentRunStepNullableRelationFilter = {
    is?: AgentRunStepWhereInput | null
    isNot?: AgentRunStepWhereInput | null
  }

  export type UserNullableRelationFilter = {
    is?: UserWhereInput | null
    isNot?: UserWhereInput | null
  }

  export type ApprovalRequestCountOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentRunId?: SortOrder
    agentRunStepId?: SortOrder
    status?: SortOrder
    title?: SortOrder
    message?: SortOrder
    requestedBySystem?: SortOrder
    requestedAt?: SortOrder
    decidedAt?: SortOrder
    decidedByUserId?: SortOrder
    decisionReason?: SortOrder
  }

  export type ApprovalRequestMaxOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentRunId?: SortOrder
    agentRunStepId?: SortOrder
    status?: SortOrder
    title?: SortOrder
    message?: SortOrder
    requestedBySystem?: SortOrder
    requestedAt?: SortOrder
    decidedAt?: SortOrder
    decidedByUserId?: SortOrder
    decisionReason?: SortOrder
  }

  export type ApprovalRequestMinOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentRunId?: SortOrder
    agentRunStepId?: SortOrder
    status?: SortOrder
    title?: SortOrder
    message?: SortOrder
    requestedBySystem?: SortOrder
    requestedAt?: SortOrder
    decidedAt?: SortOrder
    decidedByUserId?: SortOrder
    decisionReason?: SortOrder
  }

  export type EnumApprovalStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ApprovalStatus | EnumApprovalStatusFieldRefInput<$PrismaModel>
    in?: $Enums.ApprovalStatus[] | ListEnumApprovalStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.ApprovalStatus[] | ListEnumApprovalStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumApprovalStatusWithAggregatesFilter<$PrismaModel> | $Enums.ApprovalStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumApprovalStatusFilter<$PrismaModel>
    _max?: NestedEnumApprovalStatusFilter<$PrismaModel>
  }

  export type BudgetPolicyCountOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentJobId?: SortOrder
    maxTokensPerRun?: SortOrder
    maxCostUsdPerRun?: SortOrder
    maxRunsPerDay?: SortOrder
    maxRunsPerMonth?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BudgetPolicyAvgOrderByAggregateInput = {
    maxTokensPerRun?: SortOrder
    maxCostUsdPerRun?: SortOrder
    maxRunsPerDay?: SortOrder
    maxRunsPerMonth?: SortOrder
  }

  export type BudgetPolicyMaxOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentJobId?: SortOrder
    maxTokensPerRun?: SortOrder
    maxCostUsdPerRun?: SortOrder
    maxRunsPerDay?: SortOrder
    maxRunsPerMonth?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BudgetPolicyMinOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    agentJobId?: SortOrder
    maxTokensPerRun?: SortOrder
    maxCostUsdPerRun?: SortOrder
    maxRunsPerDay?: SortOrder
    maxRunsPerMonth?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BudgetPolicySumOrderByAggregateInput = {
    maxTokensPerRun?: SortOrder
    maxCostUsdPerRun?: SortOrder
    maxRunsPerDay?: SortOrder
    maxRunsPerMonth?: SortOrder
  }

  export type AuditLogCountOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    actorUserId?: SortOrder
    entityType?: SortOrder
    entityId?: SortOrder
    action?: SortOrder
    metadataJson?: SortOrder
    createdAt?: SortOrder
  }

  export type AuditLogMaxOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    actorUserId?: SortOrder
    entityType?: SortOrder
    entityId?: SortOrder
    action?: SortOrder
    createdAt?: SortOrder
  }

  export type AuditLogMinOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    actorUserId?: SortOrder
    entityType?: SortOrder
    entityId?: SortOrder
    action?: SortOrder
    createdAt?: SortOrder
  }

  export type UserCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<UserCreateWithoutOrganizationInput, UserUncheckedCreateWithoutOrganizationInput> | UserCreateWithoutOrganizationInput[] | UserUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: UserCreateOrConnectWithoutOrganizationInput | UserCreateOrConnectWithoutOrganizationInput[]
    createMany?: UserCreateManyOrganizationInputEnvelope
    connect?: UserWhereUniqueInput | UserWhereUniqueInput[]
  }

  export type AgentJobCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<AgentJobCreateWithoutOrganizationInput, AgentJobUncheckedCreateWithoutOrganizationInput> | AgentJobCreateWithoutOrganizationInput[] | AgentJobUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentJobCreateOrConnectWithoutOrganizationInput | AgentJobCreateOrConnectWithoutOrganizationInput[]
    createMany?: AgentJobCreateManyOrganizationInputEnvelope
    connect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
  }

  export type AgentRunCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<AgentRunCreateWithoutOrganizationInput, AgentRunUncheckedCreateWithoutOrganizationInput> | AgentRunCreateWithoutOrganizationInput[] | AgentRunUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutOrganizationInput | AgentRunCreateOrConnectWithoutOrganizationInput[]
    createMany?: AgentRunCreateManyOrganizationInputEnvelope
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
  }

  export type AgentRunStepCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<AgentRunStepCreateWithoutOrganizationInput, AgentRunStepUncheckedCreateWithoutOrganizationInput> | AgentRunStepCreateWithoutOrganizationInput[] | AgentRunStepUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentRunStepCreateOrConnectWithoutOrganizationInput | AgentRunStepCreateOrConnectWithoutOrganizationInput[]
    createMany?: AgentRunStepCreateManyOrganizationInputEnvelope
    connect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
  }

  export type ApprovalRequestCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<ApprovalRequestCreateWithoutOrganizationInput, ApprovalRequestUncheckedCreateWithoutOrganizationInput> | ApprovalRequestCreateWithoutOrganizationInput[] | ApprovalRequestUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutOrganizationInput | ApprovalRequestCreateOrConnectWithoutOrganizationInput[]
    createMany?: ApprovalRequestCreateManyOrganizationInputEnvelope
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
  }

  export type BudgetPolicyCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<BudgetPolicyCreateWithoutOrganizationInput, BudgetPolicyUncheckedCreateWithoutOrganizationInput> | BudgetPolicyCreateWithoutOrganizationInput[] | BudgetPolicyUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: BudgetPolicyCreateOrConnectWithoutOrganizationInput | BudgetPolicyCreateOrConnectWithoutOrganizationInput[]
    createMany?: BudgetPolicyCreateManyOrganizationInputEnvelope
    connect?: BudgetPolicyWhereUniqueInput | BudgetPolicyWhereUniqueInput[]
  }

  export type AuditLogCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<AuditLogCreateWithoutOrganizationInput, AuditLogUncheckedCreateWithoutOrganizationInput> | AuditLogCreateWithoutOrganizationInput[] | AuditLogUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutOrganizationInput | AuditLogCreateOrConnectWithoutOrganizationInput[]
    createMany?: AuditLogCreateManyOrganizationInputEnvelope
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
  }

  export type UserUncheckedCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<UserCreateWithoutOrganizationInput, UserUncheckedCreateWithoutOrganizationInput> | UserCreateWithoutOrganizationInput[] | UserUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: UserCreateOrConnectWithoutOrganizationInput | UserCreateOrConnectWithoutOrganizationInput[]
    createMany?: UserCreateManyOrganizationInputEnvelope
    connect?: UserWhereUniqueInput | UserWhereUniqueInput[]
  }

  export type AgentJobUncheckedCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<AgentJobCreateWithoutOrganizationInput, AgentJobUncheckedCreateWithoutOrganizationInput> | AgentJobCreateWithoutOrganizationInput[] | AgentJobUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentJobCreateOrConnectWithoutOrganizationInput | AgentJobCreateOrConnectWithoutOrganizationInput[]
    createMany?: AgentJobCreateManyOrganizationInputEnvelope
    connect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
  }

  export type AgentRunUncheckedCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<AgentRunCreateWithoutOrganizationInput, AgentRunUncheckedCreateWithoutOrganizationInput> | AgentRunCreateWithoutOrganizationInput[] | AgentRunUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutOrganizationInput | AgentRunCreateOrConnectWithoutOrganizationInput[]
    createMany?: AgentRunCreateManyOrganizationInputEnvelope
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
  }

  export type AgentRunStepUncheckedCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<AgentRunStepCreateWithoutOrganizationInput, AgentRunStepUncheckedCreateWithoutOrganizationInput> | AgentRunStepCreateWithoutOrganizationInput[] | AgentRunStepUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentRunStepCreateOrConnectWithoutOrganizationInput | AgentRunStepCreateOrConnectWithoutOrganizationInput[]
    createMany?: AgentRunStepCreateManyOrganizationInputEnvelope
    connect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
  }

  export type ApprovalRequestUncheckedCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<ApprovalRequestCreateWithoutOrganizationInput, ApprovalRequestUncheckedCreateWithoutOrganizationInput> | ApprovalRequestCreateWithoutOrganizationInput[] | ApprovalRequestUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutOrganizationInput | ApprovalRequestCreateOrConnectWithoutOrganizationInput[]
    createMany?: ApprovalRequestCreateManyOrganizationInputEnvelope
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
  }

  export type BudgetPolicyUncheckedCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<BudgetPolicyCreateWithoutOrganizationInput, BudgetPolicyUncheckedCreateWithoutOrganizationInput> | BudgetPolicyCreateWithoutOrganizationInput[] | BudgetPolicyUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: BudgetPolicyCreateOrConnectWithoutOrganizationInput | BudgetPolicyCreateOrConnectWithoutOrganizationInput[]
    createMany?: BudgetPolicyCreateManyOrganizationInputEnvelope
    connect?: BudgetPolicyWhereUniqueInput | BudgetPolicyWhereUniqueInput[]
  }

  export type AuditLogUncheckedCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<AuditLogCreateWithoutOrganizationInput, AuditLogUncheckedCreateWithoutOrganizationInput> | AuditLogCreateWithoutOrganizationInput[] | AuditLogUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutOrganizationInput | AuditLogCreateOrConnectWithoutOrganizationInput[]
    createMany?: AuditLogCreateManyOrganizationInputEnvelope
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type UserUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<UserCreateWithoutOrganizationInput, UserUncheckedCreateWithoutOrganizationInput> | UserCreateWithoutOrganizationInput[] | UserUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: UserCreateOrConnectWithoutOrganizationInput | UserCreateOrConnectWithoutOrganizationInput[]
    upsert?: UserUpsertWithWhereUniqueWithoutOrganizationInput | UserUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: UserCreateManyOrganizationInputEnvelope
    set?: UserWhereUniqueInput | UserWhereUniqueInput[]
    disconnect?: UserWhereUniqueInput | UserWhereUniqueInput[]
    delete?: UserWhereUniqueInput | UserWhereUniqueInput[]
    connect?: UserWhereUniqueInput | UserWhereUniqueInput[]
    update?: UserUpdateWithWhereUniqueWithoutOrganizationInput | UserUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: UserUpdateManyWithWhereWithoutOrganizationInput | UserUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: UserScalarWhereInput | UserScalarWhereInput[]
  }

  export type AgentJobUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<AgentJobCreateWithoutOrganizationInput, AgentJobUncheckedCreateWithoutOrganizationInput> | AgentJobCreateWithoutOrganizationInput[] | AgentJobUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentJobCreateOrConnectWithoutOrganizationInput | AgentJobCreateOrConnectWithoutOrganizationInput[]
    upsert?: AgentJobUpsertWithWhereUniqueWithoutOrganizationInput | AgentJobUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: AgentJobCreateManyOrganizationInputEnvelope
    set?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    disconnect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    delete?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    connect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    update?: AgentJobUpdateWithWhereUniqueWithoutOrganizationInput | AgentJobUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: AgentJobUpdateManyWithWhereWithoutOrganizationInput | AgentJobUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: AgentJobScalarWhereInput | AgentJobScalarWhereInput[]
  }

  export type AgentRunUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<AgentRunCreateWithoutOrganizationInput, AgentRunUncheckedCreateWithoutOrganizationInput> | AgentRunCreateWithoutOrganizationInput[] | AgentRunUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutOrganizationInput | AgentRunCreateOrConnectWithoutOrganizationInput[]
    upsert?: AgentRunUpsertWithWhereUniqueWithoutOrganizationInput | AgentRunUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: AgentRunCreateManyOrganizationInputEnvelope
    set?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    disconnect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    delete?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    update?: AgentRunUpdateWithWhereUniqueWithoutOrganizationInput | AgentRunUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: AgentRunUpdateManyWithWhereWithoutOrganizationInput | AgentRunUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: AgentRunScalarWhereInput | AgentRunScalarWhereInput[]
  }

  export type AgentRunStepUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<AgentRunStepCreateWithoutOrganizationInput, AgentRunStepUncheckedCreateWithoutOrganizationInput> | AgentRunStepCreateWithoutOrganizationInput[] | AgentRunStepUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentRunStepCreateOrConnectWithoutOrganizationInput | AgentRunStepCreateOrConnectWithoutOrganizationInput[]
    upsert?: AgentRunStepUpsertWithWhereUniqueWithoutOrganizationInput | AgentRunStepUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: AgentRunStepCreateManyOrganizationInputEnvelope
    set?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    disconnect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    delete?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    connect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    update?: AgentRunStepUpdateWithWhereUniqueWithoutOrganizationInput | AgentRunStepUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: AgentRunStepUpdateManyWithWhereWithoutOrganizationInput | AgentRunStepUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: AgentRunStepScalarWhereInput | AgentRunStepScalarWhereInput[]
  }

  export type ApprovalRequestUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<ApprovalRequestCreateWithoutOrganizationInput, ApprovalRequestUncheckedCreateWithoutOrganizationInput> | ApprovalRequestCreateWithoutOrganizationInput[] | ApprovalRequestUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutOrganizationInput | ApprovalRequestCreateOrConnectWithoutOrganizationInput[]
    upsert?: ApprovalRequestUpsertWithWhereUniqueWithoutOrganizationInput | ApprovalRequestUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: ApprovalRequestCreateManyOrganizationInputEnvelope
    set?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    disconnect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    delete?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    update?: ApprovalRequestUpdateWithWhereUniqueWithoutOrganizationInput | ApprovalRequestUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: ApprovalRequestUpdateManyWithWhereWithoutOrganizationInput | ApprovalRequestUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: ApprovalRequestScalarWhereInput | ApprovalRequestScalarWhereInput[]
  }

  export type BudgetPolicyUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<BudgetPolicyCreateWithoutOrganizationInput, BudgetPolicyUncheckedCreateWithoutOrganizationInput> | BudgetPolicyCreateWithoutOrganizationInput[] | BudgetPolicyUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: BudgetPolicyCreateOrConnectWithoutOrganizationInput | BudgetPolicyCreateOrConnectWithoutOrganizationInput[]
    upsert?: BudgetPolicyUpsertWithWhereUniqueWithoutOrganizationInput | BudgetPolicyUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: BudgetPolicyCreateManyOrganizationInputEnvelope
    set?: BudgetPolicyWhereUniqueInput | BudgetPolicyWhereUniqueInput[]
    disconnect?: BudgetPolicyWhereUniqueInput | BudgetPolicyWhereUniqueInput[]
    delete?: BudgetPolicyWhereUniqueInput | BudgetPolicyWhereUniqueInput[]
    connect?: BudgetPolicyWhereUniqueInput | BudgetPolicyWhereUniqueInput[]
    update?: BudgetPolicyUpdateWithWhereUniqueWithoutOrganizationInput | BudgetPolicyUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: BudgetPolicyUpdateManyWithWhereWithoutOrganizationInput | BudgetPolicyUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: BudgetPolicyScalarWhereInput | BudgetPolicyScalarWhereInput[]
  }

  export type AuditLogUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<AuditLogCreateWithoutOrganizationInput, AuditLogUncheckedCreateWithoutOrganizationInput> | AuditLogCreateWithoutOrganizationInput[] | AuditLogUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutOrganizationInput | AuditLogCreateOrConnectWithoutOrganizationInput[]
    upsert?: AuditLogUpsertWithWhereUniqueWithoutOrganizationInput | AuditLogUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: AuditLogCreateManyOrganizationInputEnvelope
    set?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    disconnect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    delete?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    update?: AuditLogUpdateWithWhereUniqueWithoutOrganizationInput | AuditLogUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: AuditLogUpdateManyWithWhereWithoutOrganizationInput | AuditLogUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
  }

  export type UserUncheckedUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<UserCreateWithoutOrganizationInput, UserUncheckedCreateWithoutOrganizationInput> | UserCreateWithoutOrganizationInput[] | UserUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: UserCreateOrConnectWithoutOrganizationInput | UserCreateOrConnectWithoutOrganizationInput[]
    upsert?: UserUpsertWithWhereUniqueWithoutOrganizationInput | UserUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: UserCreateManyOrganizationInputEnvelope
    set?: UserWhereUniqueInput | UserWhereUniqueInput[]
    disconnect?: UserWhereUniqueInput | UserWhereUniqueInput[]
    delete?: UserWhereUniqueInput | UserWhereUniqueInput[]
    connect?: UserWhereUniqueInput | UserWhereUniqueInput[]
    update?: UserUpdateWithWhereUniqueWithoutOrganizationInput | UserUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: UserUpdateManyWithWhereWithoutOrganizationInput | UserUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: UserScalarWhereInput | UserScalarWhereInput[]
  }

  export type AgentJobUncheckedUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<AgentJobCreateWithoutOrganizationInput, AgentJobUncheckedCreateWithoutOrganizationInput> | AgentJobCreateWithoutOrganizationInput[] | AgentJobUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentJobCreateOrConnectWithoutOrganizationInput | AgentJobCreateOrConnectWithoutOrganizationInput[]
    upsert?: AgentJobUpsertWithWhereUniqueWithoutOrganizationInput | AgentJobUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: AgentJobCreateManyOrganizationInputEnvelope
    set?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    disconnect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    delete?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    connect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    update?: AgentJobUpdateWithWhereUniqueWithoutOrganizationInput | AgentJobUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: AgentJobUpdateManyWithWhereWithoutOrganizationInput | AgentJobUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: AgentJobScalarWhereInput | AgentJobScalarWhereInput[]
  }

  export type AgentRunUncheckedUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<AgentRunCreateWithoutOrganizationInput, AgentRunUncheckedCreateWithoutOrganizationInput> | AgentRunCreateWithoutOrganizationInput[] | AgentRunUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutOrganizationInput | AgentRunCreateOrConnectWithoutOrganizationInput[]
    upsert?: AgentRunUpsertWithWhereUniqueWithoutOrganizationInput | AgentRunUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: AgentRunCreateManyOrganizationInputEnvelope
    set?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    disconnect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    delete?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    update?: AgentRunUpdateWithWhereUniqueWithoutOrganizationInput | AgentRunUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: AgentRunUpdateManyWithWhereWithoutOrganizationInput | AgentRunUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: AgentRunScalarWhereInput | AgentRunScalarWhereInput[]
  }

  export type AgentRunStepUncheckedUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<AgentRunStepCreateWithoutOrganizationInput, AgentRunStepUncheckedCreateWithoutOrganizationInput> | AgentRunStepCreateWithoutOrganizationInput[] | AgentRunStepUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AgentRunStepCreateOrConnectWithoutOrganizationInput | AgentRunStepCreateOrConnectWithoutOrganizationInput[]
    upsert?: AgentRunStepUpsertWithWhereUniqueWithoutOrganizationInput | AgentRunStepUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: AgentRunStepCreateManyOrganizationInputEnvelope
    set?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    disconnect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    delete?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    connect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    update?: AgentRunStepUpdateWithWhereUniqueWithoutOrganizationInput | AgentRunStepUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: AgentRunStepUpdateManyWithWhereWithoutOrganizationInput | AgentRunStepUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: AgentRunStepScalarWhereInput | AgentRunStepScalarWhereInput[]
  }

  export type ApprovalRequestUncheckedUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<ApprovalRequestCreateWithoutOrganizationInput, ApprovalRequestUncheckedCreateWithoutOrganizationInput> | ApprovalRequestCreateWithoutOrganizationInput[] | ApprovalRequestUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutOrganizationInput | ApprovalRequestCreateOrConnectWithoutOrganizationInput[]
    upsert?: ApprovalRequestUpsertWithWhereUniqueWithoutOrganizationInput | ApprovalRequestUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: ApprovalRequestCreateManyOrganizationInputEnvelope
    set?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    disconnect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    delete?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    update?: ApprovalRequestUpdateWithWhereUniqueWithoutOrganizationInput | ApprovalRequestUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: ApprovalRequestUpdateManyWithWhereWithoutOrganizationInput | ApprovalRequestUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: ApprovalRequestScalarWhereInput | ApprovalRequestScalarWhereInput[]
  }

  export type BudgetPolicyUncheckedUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<BudgetPolicyCreateWithoutOrganizationInput, BudgetPolicyUncheckedCreateWithoutOrganizationInput> | BudgetPolicyCreateWithoutOrganizationInput[] | BudgetPolicyUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: BudgetPolicyCreateOrConnectWithoutOrganizationInput | BudgetPolicyCreateOrConnectWithoutOrganizationInput[]
    upsert?: BudgetPolicyUpsertWithWhereUniqueWithoutOrganizationInput | BudgetPolicyUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: BudgetPolicyCreateManyOrganizationInputEnvelope
    set?: BudgetPolicyWhereUniqueInput | BudgetPolicyWhereUniqueInput[]
    disconnect?: BudgetPolicyWhereUniqueInput | BudgetPolicyWhereUniqueInput[]
    delete?: BudgetPolicyWhereUniqueInput | BudgetPolicyWhereUniqueInput[]
    connect?: BudgetPolicyWhereUniqueInput | BudgetPolicyWhereUniqueInput[]
    update?: BudgetPolicyUpdateWithWhereUniqueWithoutOrganizationInput | BudgetPolicyUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: BudgetPolicyUpdateManyWithWhereWithoutOrganizationInput | BudgetPolicyUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: BudgetPolicyScalarWhereInput | BudgetPolicyScalarWhereInput[]
  }

  export type AuditLogUncheckedUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<AuditLogCreateWithoutOrganizationInput, AuditLogUncheckedCreateWithoutOrganizationInput> | AuditLogCreateWithoutOrganizationInput[] | AuditLogUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutOrganizationInput | AuditLogCreateOrConnectWithoutOrganizationInput[]
    upsert?: AuditLogUpsertWithWhereUniqueWithoutOrganizationInput | AuditLogUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: AuditLogCreateManyOrganizationInputEnvelope
    set?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    disconnect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    delete?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    update?: AuditLogUpdateWithWhereUniqueWithoutOrganizationInput | AuditLogUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: AuditLogUpdateManyWithWhereWithoutOrganizationInput | AuditLogUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
  }

  export type OrganizationCreateNestedOneWithoutUsersInput = {
    create?: XOR<OrganizationCreateWithoutUsersInput, OrganizationUncheckedCreateWithoutUsersInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutUsersInput
    connect?: OrganizationWhereUniqueInput
  }

  export type AgentJobCreateNestedManyWithoutCreatedByInput = {
    create?: XOR<AgentJobCreateWithoutCreatedByInput, AgentJobUncheckedCreateWithoutCreatedByInput> | AgentJobCreateWithoutCreatedByInput[] | AgentJobUncheckedCreateWithoutCreatedByInput[]
    connectOrCreate?: AgentJobCreateOrConnectWithoutCreatedByInput | AgentJobCreateOrConnectWithoutCreatedByInput[]
    createMany?: AgentJobCreateManyCreatedByInputEnvelope
    connect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
  }

  export type ApprovalRequestCreateNestedManyWithoutDecidedByInput = {
    create?: XOR<ApprovalRequestCreateWithoutDecidedByInput, ApprovalRequestUncheckedCreateWithoutDecidedByInput> | ApprovalRequestCreateWithoutDecidedByInput[] | ApprovalRequestUncheckedCreateWithoutDecidedByInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutDecidedByInput | ApprovalRequestCreateOrConnectWithoutDecidedByInput[]
    createMany?: ApprovalRequestCreateManyDecidedByInputEnvelope
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
  }

  export type AuditLogCreateNestedManyWithoutActorInput = {
    create?: XOR<AuditLogCreateWithoutActorInput, AuditLogUncheckedCreateWithoutActorInput> | AuditLogCreateWithoutActorInput[] | AuditLogUncheckedCreateWithoutActorInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutActorInput | AuditLogCreateOrConnectWithoutActorInput[]
    createMany?: AuditLogCreateManyActorInputEnvelope
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
  }

  export type AgentJobUncheckedCreateNestedManyWithoutCreatedByInput = {
    create?: XOR<AgentJobCreateWithoutCreatedByInput, AgentJobUncheckedCreateWithoutCreatedByInput> | AgentJobCreateWithoutCreatedByInput[] | AgentJobUncheckedCreateWithoutCreatedByInput[]
    connectOrCreate?: AgentJobCreateOrConnectWithoutCreatedByInput | AgentJobCreateOrConnectWithoutCreatedByInput[]
    createMany?: AgentJobCreateManyCreatedByInputEnvelope
    connect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
  }

  export type ApprovalRequestUncheckedCreateNestedManyWithoutDecidedByInput = {
    create?: XOR<ApprovalRequestCreateWithoutDecidedByInput, ApprovalRequestUncheckedCreateWithoutDecidedByInput> | ApprovalRequestCreateWithoutDecidedByInput[] | ApprovalRequestUncheckedCreateWithoutDecidedByInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutDecidedByInput | ApprovalRequestCreateOrConnectWithoutDecidedByInput[]
    createMany?: ApprovalRequestCreateManyDecidedByInputEnvelope
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
  }

  export type AuditLogUncheckedCreateNestedManyWithoutActorInput = {
    create?: XOR<AuditLogCreateWithoutActorInput, AuditLogUncheckedCreateWithoutActorInput> | AuditLogCreateWithoutActorInput[] | AuditLogUncheckedCreateWithoutActorInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutActorInput | AuditLogCreateOrConnectWithoutActorInput[]
    createMany?: AuditLogCreateManyActorInputEnvelope
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type EnumUserRoleFieldUpdateOperationsInput = {
    set?: $Enums.UserRole
  }

  export type OrganizationUpdateOneRequiredWithoutUsersNestedInput = {
    create?: XOR<OrganizationCreateWithoutUsersInput, OrganizationUncheckedCreateWithoutUsersInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutUsersInput
    upsert?: OrganizationUpsertWithoutUsersInput
    connect?: OrganizationWhereUniqueInput
    update?: XOR<XOR<OrganizationUpdateToOneWithWhereWithoutUsersInput, OrganizationUpdateWithoutUsersInput>, OrganizationUncheckedUpdateWithoutUsersInput>
  }

  export type AgentJobUpdateManyWithoutCreatedByNestedInput = {
    create?: XOR<AgentJobCreateWithoutCreatedByInput, AgentJobUncheckedCreateWithoutCreatedByInput> | AgentJobCreateWithoutCreatedByInput[] | AgentJobUncheckedCreateWithoutCreatedByInput[]
    connectOrCreate?: AgentJobCreateOrConnectWithoutCreatedByInput | AgentJobCreateOrConnectWithoutCreatedByInput[]
    upsert?: AgentJobUpsertWithWhereUniqueWithoutCreatedByInput | AgentJobUpsertWithWhereUniqueWithoutCreatedByInput[]
    createMany?: AgentJobCreateManyCreatedByInputEnvelope
    set?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    disconnect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    delete?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    connect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    update?: AgentJobUpdateWithWhereUniqueWithoutCreatedByInput | AgentJobUpdateWithWhereUniqueWithoutCreatedByInput[]
    updateMany?: AgentJobUpdateManyWithWhereWithoutCreatedByInput | AgentJobUpdateManyWithWhereWithoutCreatedByInput[]
    deleteMany?: AgentJobScalarWhereInput | AgentJobScalarWhereInput[]
  }

  export type ApprovalRequestUpdateManyWithoutDecidedByNestedInput = {
    create?: XOR<ApprovalRequestCreateWithoutDecidedByInput, ApprovalRequestUncheckedCreateWithoutDecidedByInput> | ApprovalRequestCreateWithoutDecidedByInput[] | ApprovalRequestUncheckedCreateWithoutDecidedByInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutDecidedByInput | ApprovalRequestCreateOrConnectWithoutDecidedByInput[]
    upsert?: ApprovalRequestUpsertWithWhereUniqueWithoutDecidedByInput | ApprovalRequestUpsertWithWhereUniqueWithoutDecidedByInput[]
    createMany?: ApprovalRequestCreateManyDecidedByInputEnvelope
    set?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    disconnect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    delete?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    update?: ApprovalRequestUpdateWithWhereUniqueWithoutDecidedByInput | ApprovalRequestUpdateWithWhereUniqueWithoutDecidedByInput[]
    updateMany?: ApprovalRequestUpdateManyWithWhereWithoutDecidedByInput | ApprovalRequestUpdateManyWithWhereWithoutDecidedByInput[]
    deleteMany?: ApprovalRequestScalarWhereInput | ApprovalRequestScalarWhereInput[]
  }

  export type AuditLogUpdateManyWithoutActorNestedInput = {
    create?: XOR<AuditLogCreateWithoutActorInput, AuditLogUncheckedCreateWithoutActorInput> | AuditLogCreateWithoutActorInput[] | AuditLogUncheckedCreateWithoutActorInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutActorInput | AuditLogCreateOrConnectWithoutActorInput[]
    upsert?: AuditLogUpsertWithWhereUniqueWithoutActorInput | AuditLogUpsertWithWhereUniqueWithoutActorInput[]
    createMany?: AuditLogCreateManyActorInputEnvelope
    set?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    disconnect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    delete?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    update?: AuditLogUpdateWithWhereUniqueWithoutActorInput | AuditLogUpdateWithWhereUniqueWithoutActorInput[]
    updateMany?: AuditLogUpdateManyWithWhereWithoutActorInput | AuditLogUpdateManyWithWhereWithoutActorInput[]
    deleteMany?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
  }

  export type AgentJobUncheckedUpdateManyWithoutCreatedByNestedInput = {
    create?: XOR<AgentJobCreateWithoutCreatedByInput, AgentJobUncheckedCreateWithoutCreatedByInput> | AgentJobCreateWithoutCreatedByInput[] | AgentJobUncheckedCreateWithoutCreatedByInput[]
    connectOrCreate?: AgentJobCreateOrConnectWithoutCreatedByInput | AgentJobCreateOrConnectWithoutCreatedByInput[]
    upsert?: AgentJobUpsertWithWhereUniqueWithoutCreatedByInput | AgentJobUpsertWithWhereUniqueWithoutCreatedByInput[]
    createMany?: AgentJobCreateManyCreatedByInputEnvelope
    set?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    disconnect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    delete?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    connect?: AgentJobWhereUniqueInput | AgentJobWhereUniqueInput[]
    update?: AgentJobUpdateWithWhereUniqueWithoutCreatedByInput | AgentJobUpdateWithWhereUniqueWithoutCreatedByInput[]
    updateMany?: AgentJobUpdateManyWithWhereWithoutCreatedByInput | AgentJobUpdateManyWithWhereWithoutCreatedByInput[]
    deleteMany?: AgentJobScalarWhereInput | AgentJobScalarWhereInput[]
  }

  export type ApprovalRequestUncheckedUpdateManyWithoutDecidedByNestedInput = {
    create?: XOR<ApprovalRequestCreateWithoutDecidedByInput, ApprovalRequestUncheckedCreateWithoutDecidedByInput> | ApprovalRequestCreateWithoutDecidedByInput[] | ApprovalRequestUncheckedCreateWithoutDecidedByInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutDecidedByInput | ApprovalRequestCreateOrConnectWithoutDecidedByInput[]
    upsert?: ApprovalRequestUpsertWithWhereUniqueWithoutDecidedByInput | ApprovalRequestUpsertWithWhereUniqueWithoutDecidedByInput[]
    createMany?: ApprovalRequestCreateManyDecidedByInputEnvelope
    set?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    disconnect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    delete?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    update?: ApprovalRequestUpdateWithWhereUniqueWithoutDecidedByInput | ApprovalRequestUpdateWithWhereUniqueWithoutDecidedByInput[]
    updateMany?: ApprovalRequestUpdateManyWithWhereWithoutDecidedByInput | ApprovalRequestUpdateManyWithWhereWithoutDecidedByInput[]
    deleteMany?: ApprovalRequestScalarWhereInput | ApprovalRequestScalarWhereInput[]
  }

  export type AuditLogUncheckedUpdateManyWithoutActorNestedInput = {
    create?: XOR<AuditLogCreateWithoutActorInput, AuditLogUncheckedCreateWithoutActorInput> | AuditLogCreateWithoutActorInput[] | AuditLogUncheckedCreateWithoutActorInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutActorInput | AuditLogCreateOrConnectWithoutActorInput[]
    upsert?: AuditLogUpsertWithWhereUniqueWithoutActorInput | AuditLogUpsertWithWhereUniqueWithoutActorInput[]
    createMany?: AuditLogCreateManyActorInputEnvelope
    set?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    disconnect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    delete?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    update?: AuditLogUpdateWithWhereUniqueWithoutActorInput | AuditLogUpdateWithWhereUniqueWithoutActorInput[]
    updateMany?: AuditLogUpdateManyWithWhereWithoutActorInput | AuditLogUpdateManyWithWhereWithoutActorInput[]
    deleteMany?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
  }

  export type OrganizationCreateNestedOneWithoutAgentJobsInput = {
    create?: XOR<OrganizationCreateWithoutAgentJobsInput, OrganizationUncheckedCreateWithoutAgentJobsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutAgentJobsInput
    connect?: OrganizationWhereUniqueInput
  }

  export type UserCreateNestedOneWithoutCreatedJobsInput = {
    create?: XOR<UserCreateWithoutCreatedJobsInput, UserUncheckedCreateWithoutCreatedJobsInput>
    connectOrCreate?: UserCreateOrConnectWithoutCreatedJobsInput
    connect?: UserWhereUniqueInput
  }

  export type AgentRunCreateNestedManyWithoutAgentJobInput = {
    create?: XOR<AgentRunCreateWithoutAgentJobInput, AgentRunUncheckedCreateWithoutAgentJobInput> | AgentRunCreateWithoutAgentJobInput[] | AgentRunUncheckedCreateWithoutAgentJobInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutAgentJobInput | AgentRunCreateOrConnectWithoutAgentJobInput[]
    createMany?: AgentRunCreateManyAgentJobInputEnvelope
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
  }

  export type BudgetPolicyCreateNestedOneWithoutAgentJobInput = {
    create?: XOR<BudgetPolicyCreateWithoutAgentJobInput, BudgetPolicyUncheckedCreateWithoutAgentJobInput>
    connectOrCreate?: BudgetPolicyCreateOrConnectWithoutAgentJobInput
    connect?: BudgetPolicyWhereUniqueInput
  }

  export type AgentRunUncheckedCreateNestedManyWithoutAgentJobInput = {
    create?: XOR<AgentRunCreateWithoutAgentJobInput, AgentRunUncheckedCreateWithoutAgentJobInput> | AgentRunCreateWithoutAgentJobInput[] | AgentRunUncheckedCreateWithoutAgentJobInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutAgentJobInput | AgentRunCreateOrConnectWithoutAgentJobInput[]
    createMany?: AgentRunCreateManyAgentJobInputEnvelope
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
  }

  export type BudgetPolicyUncheckedCreateNestedOneWithoutAgentJobInput = {
    create?: XOR<BudgetPolicyCreateWithoutAgentJobInput, BudgetPolicyUncheckedCreateWithoutAgentJobInput>
    connectOrCreate?: BudgetPolicyCreateOrConnectWithoutAgentJobInput
    connect?: BudgetPolicyWhereUniqueInput
  }

  export type EnumJobStatusFieldUpdateOperationsInput = {
    set?: $Enums.JobStatus
  }

  export type EnumTriggerTypeFieldUpdateOperationsInput = {
    set?: $Enums.TriggerType
  }

  export type EnumHttpMethodFieldUpdateOperationsInput = {
    set?: $Enums.HttpMethod
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type OrganizationUpdateOneRequiredWithoutAgentJobsNestedInput = {
    create?: XOR<OrganizationCreateWithoutAgentJobsInput, OrganizationUncheckedCreateWithoutAgentJobsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutAgentJobsInput
    upsert?: OrganizationUpsertWithoutAgentJobsInput
    connect?: OrganizationWhereUniqueInput
    update?: XOR<XOR<OrganizationUpdateToOneWithWhereWithoutAgentJobsInput, OrganizationUpdateWithoutAgentJobsInput>, OrganizationUncheckedUpdateWithoutAgentJobsInput>
  }

  export type UserUpdateOneRequiredWithoutCreatedJobsNestedInput = {
    create?: XOR<UserCreateWithoutCreatedJobsInput, UserUncheckedCreateWithoutCreatedJobsInput>
    connectOrCreate?: UserCreateOrConnectWithoutCreatedJobsInput
    upsert?: UserUpsertWithoutCreatedJobsInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutCreatedJobsInput, UserUpdateWithoutCreatedJobsInput>, UserUncheckedUpdateWithoutCreatedJobsInput>
  }

  export type AgentRunUpdateManyWithoutAgentJobNestedInput = {
    create?: XOR<AgentRunCreateWithoutAgentJobInput, AgentRunUncheckedCreateWithoutAgentJobInput> | AgentRunCreateWithoutAgentJobInput[] | AgentRunUncheckedCreateWithoutAgentJobInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutAgentJobInput | AgentRunCreateOrConnectWithoutAgentJobInput[]
    upsert?: AgentRunUpsertWithWhereUniqueWithoutAgentJobInput | AgentRunUpsertWithWhereUniqueWithoutAgentJobInput[]
    createMany?: AgentRunCreateManyAgentJobInputEnvelope
    set?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    disconnect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    delete?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    update?: AgentRunUpdateWithWhereUniqueWithoutAgentJobInput | AgentRunUpdateWithWhereUniqueWithoutAgentJobInput[]
    updateMany?: AgentRunUpdateManyWithWhereWithoutAgentJobInput | AgentRunUpdateManyWithWhereWithoutAgentJobInput[]
    deleteMany?: AgentRunScalarWhereInput | AgentRunScalarWhereInput[]
  }

  export type BudgetPolicyUpdateOneWithoutAgentJobNestedInput = {
    create?: XOR<BudgetPolicyCreateWithoutAgentJobInput, BudgetPolicyUncheckedCreateWithoutAgentJobInput>
    connectOrCreate?: BudgetPolicyCreateOrConnectWithoutAgentJobInput
    upsert?: BudgetPolicyUpsertWithoutAgentJobInput
    disconnect?: BudgetPolicyWhereInput | boolean
    delete?: BudgetPolicyWhereInput | boolean
    connect?: BudgetPolicyWhereUniqueInput
    update?: XOR<XOR<BudgetPolicyUpdateToOneWithWhereWithoutAgentJobInput, BudgetPolicyUpdateWithoutAgentJobInput>, BudgetPolicyUncheckedUpdateWithoutAgentJobInput>
  }

  export type AgentRunUncheckedUpdateManyWithoutAgentJobNestedInput = {
    create?: XOR<AgentRunCreateWithoutAgentJobInput, AgentRunUncheckedCreateWithoutAgentJobInput> | AgentRunCreateWithoutAgentJobInput[] | AgentRunUncheckedCreateWithoutAgentJobInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutAgentJobInput | AgentRunCreateOrConnectWithoutAgentJobInput[]
    upsert?: AgentRunUpsertWithWhereUniqueWithoutAgentJobInput | AgentRunUpsertWithWhereUniqueWithoutAgentJobInput[]
    createMany?: AgentRunCreateManyAgentJobInputEnvelope
    set?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    disconnect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    delete?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    update?: AgentRunUpdateWithWhereUniqueWithoutAgentJobInput | AgentRunUpdateWithWhereUniqueWithoutAgentJobInput[]
    updateMany?: AgentRunUpdateManyWithWhereWithoutAgentJobInput | AgentRunUpdateManyWithWhereWithoutAgentJobInput[]
    deleteMany?: AgentRunScalarWhereInput | AgentRunScalarWhereInput[]
  }

  export type BudgetPolicyUncheckedUpdateOneWithoutAgentJobNestedInput = {
    create?: XOR<BudgetPolicyCreateWithoutAgentJobInput, BudgetPolicyUncheckedCreateWithoutAgentJobInput>
    connectOrCreate?: BudgetPolicyCreateOrConnectWithoutAgentJobInput
    upsert?: BudgetPolicyUpsertWithoutAgentJobInput
    disconnect?: BudgetPolicyWhereInput | boolean
    delete?: BudgetPolicyWhereInput | boolean
    connect?: BudgetPolicyWhereUniqueInput
    update?: XOR<XOR<BudgetPolicyUpdateToOneWithWhereWithoutAgentJobInput, BudgetPolicyUpdateWithoutAgentJobInput>, BudgetPolicyUncheckedUpdateWithoutAgentJobInput>
  }

  export type OrganizationCreateNestedOneWithoutAgentRunsInput = {
    create?: XOR<OrganizationCreateWithoutAgentRunsInput, OrganizationUncheckedCreateWithoutAgentRunsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutAgentRunsInput
    connect?: OrganizationWhereUniqueInput
  }

  export type AgentJobCreateNestedOneWithoutRunsInput = {
    create?: XOR<AgentJobCreateWithoutRunsInput, AgentJobUncheckedCreateWithoutRunsInput>
    connectOrCreate?: AgentJobCreateOrConnectWithoutRunsInput
    connect?: AgentJobWhereUniqueInput
  }

  export type AgentRunStepCreateNestedManyWithoutAgentRunInput = {
    create?: XOR<AgentRunStepCreateWithoutAgentRunInput, AgentRunStepUncheckedCreateWithoutAgentRunInput> | AgentRunStepCreateWithoutAgentRunInput[] | AgentRunStepUncheckedCreateWithoutAgentRunInput[]
    connectOrCreate?: AgentRunStepCreateOrConnectWithoutAgentRunInput | AgentRunStepCreateOrConnectWithoutAgentRunInput[]
    createMany?: AgentRunStepCreateManyAgentRunInputEnvelope
    connect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
  }

  export type ApprovalRequestCreateNestedManyWithoutAgentRunInput = {
    create?: XOR<ApprovalRequestCreateWithoutAgentRunInput, ApprovalRequestUncheckedCreateWithoutAgentRunInput> | ApprovalRequestCreateWithoutAgentRunInput[] | ApprovalRequestUncheckedCreateWithoutAgentRunInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutAgentRunInput | ApprovalRequestCreateOrConnectWithoutAgentRunInput[]
    createMany?: ApprovalRequestCreateManyAgentRunInputEnvelope
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
  }

  export type AgentRunStepUncheckedCreateNestedManyWithoutAgentRunInput = {
    create?: XOR<AgentRunStepCreateWithoutAgentRunInput, AgentRunStepUncheckedCreateWithoutAgentRunInput> | AgentRunStepCreateWithoutAgentRunInput[] | AgentRunStepUncheckedCreateWithoutAgentRunInput[]
    connectOrCreate?: AgentRunStepCreateOrConnectWithoutAgentRunInput | AgentRunStepCreateOrConnectWithoutAgentRunInput[]
    createMany?: AgentRunStepCreateManyAgentRunInputEnvelope
    connect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
  }

  export type ApprovalRequestUncheckedCreateNestedManyWithoutAgentRunInput = {
    create?: XOR<ApprovalRequestCreateWithoutAgentRunInput, ApprovalRequestUncheckedCreateWithoutAgentRunInput> | ApprovalRequestCreateWithoutAgentRunInput[] | ApprovalRequestUncheckedCreateWithoutAgentRunInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutAgentRunInput | ApprovalRequestCreateOrConnectWithoutAgentRunInput[]
    createMany?: ApprovalRequestCreateManyAgentRunInputEnvelope
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
  }

  export type EnumRunStatusFieldUpdateOperationsInput = {
    set?: $Enums.RunStatus
  }

  export type EnumTriggerSourceFieldUpdateOperationsInput = {
    set?: $Enums.TriggerSource
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NullableDecimalFieldUpdateOperationsInput = {
    set?: Decimal | DecimalJsLike | number | string | null
    increment?: Decimal | DecimalJsLike | number | string
    decrement?: Decimal | DecimalJsLike | number | string
    multiply?: Decimal | DecimalJsLike | number | string
    divide?: Decimal | DecimalJsLike | number | string
  }

  export type OrganizationUpdateOneRequiredWithoutAgentRunsNestedInput = {
    create?: XOR<OrganizationCreateWithoutAgentRunsInput, OrganizationUncheckedCreateWithoutAgentRunsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutAgentRunsInput
    upsert?: OrganizationUpsertWithoutAgentRunsInput
    connect?: OrganizationWhereUniqueInput
    update?: XOR<XOR<OrganizationUpdateToOneWithWhereWithoutAgentRunsInput, OrganizationUpdateWithoutAgentRunsInput>, OrganizationUncheckedUpdateWithoutAgentRunsInput>
  }

  export type AgentJobUpdateOneRequiredWithoutRunsNestedInput = {
    create?: XOR<AgentJobCreateWithoutRunsInput, AgentJobUncheckedCreateWithoutRunsInput>
    connectOrCreate?: AgentJobCreateOrConnectWithoutRunsInput
    upsert?: AgentJobUpsertWithoutRunsInput
    connect?: AgentJobWhereUniqueInput
    update?: XOR<XOR<AgentJobUpdateToOneWithWhereWithoutRunsInput, AgentJobUpdateWithoutRunsInput>, AgentJobUncheckedUpdateWithoutRunsInput>
  }

  export type AgentRunStepUpdateManyWithoutAgentRunNestedInput = {
    create?: XOR<AgentRunStepCreateWithoutAgentRunInput, AgentRunStepUncheckedCreateWithoutAgentRunInput> | AgentRunStepCreateWithoutAgentRunInput[] | AgentRunStepUncheckedCreateWithoutAgentRunInput[]
    connectOrCreate?: AgentRunStepCreateOrConnectWithoutAgentRunInput | AgentRunStepCreateOrConnectWithoutAgentRunInput[]
    upsert?: AgentRunStepUpsertWithWhereUniqueWithoutAgentRunInput | AgentRunStepUpsertWithWhereUniqueWithoutAgentRunInput[]
    createMany?: AgentRunStepCreateManyAgentRunInputEnvelope
    set?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    disconnect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    delete?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    connect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    update?: AgentRunStepUpdateWithWhereUniqueWithoutAgentRunInput | AgentRunStepUpdateWithWhereUniqueWithoutAgentRunInput[]
    updateMany?: AgentRunStepUpdateManyWithWhereWithoutAgentRunInput | AgentRunStepUpdateManyWithWhereWithoutAgentRunInput[]
    deleteMany?: AgentRunStepScalarWhereInput | AgentRunStepScalarWhereInput[]
  }

  export type ApprovalRequestUpdateManyWithoutAgentRunNestedInput = {
    create?: XOR<ApprovalRequestCreateWithoutAgentRunInput, ApprovalRequestUncheckedCreateWithoutAgentRunInput> | ApprovalRequestCreateWithoutAgentRunInput[] | ApprovalRequestUncheckedCreateWithoutAgentRunInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutAgentRunInput | ApprovalRequestCreateOrConnectWithoutAgentRunInput[]
    upsert?: ApprovalRequestUpsertWithWhereUniqueWithoutAgentRunInput | ApprovalRequestUpsertWithWhereUniqueWithoutAgentRunInput[]
    createMany?: ApprovalRequestCreateManyAgentRunInputEnvelope
    set?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    disconnect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    delete?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    update?: ApprovalRequestUpdateWithWhereUniqueWithoutAgentRunInput | ApprovalRequestUpdateWithWhereUniqueWithoutAgentRunInput[]
    updateMany?: ApprovalRequestUpdateManyWithWhereWithoutAgentRunInput | ApprovalRequestUpdateManyWithWhereWithoutAgentRunInput[]
    deleteMany?: ApprovalRequestScalarWhereInput | ApprovalRequestScalarWhereInput[]
  }

  export type AgentRunStepUncheckedUpdateManyWithoutAgentRunNestedInput = {
    create?: XOR<AgentRunStepCreateWithoutAgentRunInput, AgentRunStepUncheckedCreateWithoutAgentRunInput> | AgentRunStepCreateWithoutAgentRunInput[] | AgentRunStepUncheckedCreateWithoutAgentRunInput[]
    connectOrCreate?: AgentRunStepCreateOrConnectWithoutAgentRunInput | AgentRunStepCreateOrConnectWithoutAgentRunInput[]
    upsert?: AgentRunStepUpsertWithWhereUniqueWithoutAgentRunInput | AgentRunStepUpsertWithWhereUniqueWithoutAgentRunInput[]
    createMany?: AgentRunStepCreateManyAgentRunInputEnvelope
    set?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    disconnect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    delete?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    connect?: AgentRunStepWhereUniqueInput | AgentRunStepWhereUniqueInput[]
    update?: AgentRunStepUpdateWithWhereUniqueWithoutAgentRunInput | AgentRunStepUpdateWithWhereUniqueWithoutAgentRunInput[]
    updateMany?: AgentRunStepUpdateManyWithWhereWithoutAgentRunInput | AgentRunStepUpdateManyWithWhereWithoutAgentRunInput[]
    deleteMany?: AgentRunStepScalarWhereInput | AgentRunStepScalarWhereInput[]
  }

  export type ApprovalRequestUncheckedUpdateManyWithoutAgentRunNestedInput = {
    create?: XOR<ApprovalRequestCreateWithoutAgentRunInput, ApprovalRequestUncheckedCreateWithoutAgentRunInput> | ApprovalRequestCreateWithoutAgentRunInput[] | ApprovalRequestUncheckedCreateWithoutAgentRunInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutAgentRunInput | ApprovalRequestCreateOrConnectWithoutAgentRunInput[]
    upsert?: ApprovalRequestUpsertWithWhereUniqueWithoutAgentRunInput | ApprovalRequestUpsertWithWhereUniqueWithoutAgentRunInput[]
    createMany?: ApprovalRequestCreateManyAgentRunInputEnvelope
    set?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    disconnect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    delete?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    update?: ApprovalRequestUpdateWithWhereUniqueWithoutAgentRunInput | ApprovalRequestUpdateWithWhereUniqueWithoutAgentRunInput[]
    updateMany?: ApprovalRequestUpdateManyWithWhereWithoutAgentRunInput | ApprovalRequestUpdateManyWithWhereWithoutAgentRunInput[]
    deleteMany?: ApprovalRequestScalarWhereInput | ApprovalRequestScalarWhereInput[]
  }

  export type OrganizationCreateNestedOneWithoutAgentRunStepsInput = {
    create?: XOR<OrganizationCreateWithoutAgentRunStepsInput, OrganizationUncheckedCreateWithoutAgentRunStepsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutAgentRunStepsInput
    connect?: OrganizationWhereUniqueInput
  }

  export type AgentRunCreateNestedOneWithoutStepsInput = {
    create?: XOR<AgentRunCreateWithoutStepsInput, AgentRunUncheckedCreateWithoutStepsInput>
    connectOrCreate?: AgentRunCreateOrConnectWithoutStepsInput
    connect?: AgentRunWhereUniqueInput
  }

  export type ApprovalRequestCreateNestedManyWithoutAgentRunStepInput = {
    create?: XOR<ApprovalRequestCreateWithoutAgentRunStepInput, ApprovalRequestUncheckedCreateWithoutAgentRunStepInput> | ApprovalRequestCreateWithoutAgentRunStepInput[] | ApprovalRequestUncheckedCreateWithoutAgentRunStepInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutAgentRunStepInput | ApprovalRequestCreateOrConnectWithoutAgentRunStepInput[]
    createMany?: ApprovalRequestCreateManyAgentRunStepInputEnvelope
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
  }

  export type ApprovalRequestUncheckedCreateNestedManyWithoutAgentRunStepInput = {
    create?: XOR<ApprovalRequestCreateWithoutAgentRunStepInput, ApprovalRequestUncheckedCreateWithoutAgentRunStepInput> | ApprovalRequestCreateWithoutAgentRunStepInput[] | ApprovalRequestUncheckedCreateWithoutAgentRunStepInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutAgentRunStepInput | ApprovalRequestCreateOrConnectWithoutAgentRunStepInput[]
    createMany?: ApprovalRequestCreateManyAgentRunStepInputEnvelope
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
  }

  export type EnumStepTypeFieldUpdateOperationsInput = {
    set?: $Enums.StepType
  }

  export type EnumStepStatusFieldUpdateOperationsInput = {
    set?: $Enums.StepStatus
  }

  export type OrganizationUpdateOneRequiredWithoutAgentRunStepsNestedInput = {
    create?: XOR<OrganizationCreateWithoutAgentRunStepsInput, OrganizationUncheckedCreateWithoutAgentRunStepsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutAgentRunStepsInput
    upsert?: OrganizationUpsertWithoutAgentRunStepsInput
    connect?: OrganizationWhereUniqueInput
    update?: XOR<XOR<OrganizationUpdateToOneWithWhereWithoutAgentRunStepsInput, OrganizationUpdateWithoutAgentRunStepsInput>, OrganizationUncheckedUpdateWithoutAgentRunStepsInput>
  }

  export type AgentRunUpdateOneRequiredWithoutStepsNestedInput = {
    create?: XOR<AgentRunCreateWithoutStepsInput, AgentRunUncheckedCreateWithoutStepsInput>
    connectOrCreate?: AgentRunCreateOrConnectWithoutStepsInput
    upsert?: AgentRunUpsertWithoutStepsInput
    connect?: AgentRunWhereUniqueInput
    update?: XOR<XOR<AgentRunUpdateToOneWithWhereWithoutStepsInput, AgentRunUpdateWithoutStepsInput>, AgentRunUncheckedUpdateWithoutStepsInput>
  }

  export type ApprovalRequestUpdateManyWithoutAgentRunStepNestedInput = {
    create?: XOR<ApprovalRequestCreateWithoutAgentRunStepInput, ApprovalRequestUncheckedCreateWithoutAgentRunStepInput> | ApprovalRequestCreateWithoutAgentRunStepInput[] | ApprovalRequestUncheckedCreateWithoutAgentRunStepInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutAgentRunStepInput | ApprovalRequestCreateOrConnectWithoutAgentRunStepInput[]
    upsert?: ApprovalRequestUpsertWithWhereUniqueWithoutAgentRunStepInput | ApprovalRequestUpsertWithWhereUniqueWithoutAgentRunStepInput[]
    createMany?: ApprovalRequestCreateManyAgentRunStepInputEnvelope
    set?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    disconnect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    delete?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    update?: ApprovalRequestUpdateWithWhereUniqueWithoutAgentRunStepInput | ApprovalRequestUpdateWithWhereUniqueWithoutAgentRunStepInput[]
    updateMany?: ApprovalRequestUpdateManyWithWhereWithoutAgentRunStepInput | ApprovalRequestUpdateManyWithWhereWithoutAgentRunStepInput[]
    deleteMany?: ApprovalRequestScalarWhereInput | ApprovalRequestScalarWhereInput[]
  }

  export type ApprovalRequestUncheckedUpdateManyWithoutAgentRunStepNestedInput = {
    create?: XOR<ApprovalRequestCreateWithoutAgentRunStepInput, ApprovalRequestUncheckedCreateWithoutAgentRunStepInput> | ApprovalRequestCreateWithoutAgentRunStepInput[] | ApprovalRequestUncheckedCreateWithoutAgentRunStepInput[]
    connectOrCreate?: ApprovalRequestCreateOrConnectWithoutAgentRunStepInput | ApprovalRequestCreateOrConnectWithoutAgentRunStepInput[]
    upsert?: ApprovalRequestUpsertWithWhereUniqueWithoutAgentRunStepInput | ApprovalRequestUpsertWithWhereUniqueWithoutAgentRunStepInput[]
    createMany?: ApprovalRequestCreateManyAgentRunStepInputEnvelope
    set?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    disconnect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    delete?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    connect?: ApprovalRequestWhereUniqueInput | ApprovalRequestWhereUniqueInput[]
    update?: ApprovalRequestUpdateWithWhereUniqueWithoutAgentRunStepInput | ApprovalRequestUpdateWithWhereUniqueWithoutAgentRunStepInput[]
    updateMany?: ApprovalRequestUpdateManyWithWhereWithoutAgentRunStepInput | ApprovalRequestUpdateManyWithWhereWithoutAgentRunStepInput[]
    deleteMany?: ApprovalRequestScalarWhereInput | ApprovalRequestScalarWhereInput[]
  }

  export type OrganizationCreateNestedOneWithoutApprovalRequestsInput = {
    create?: XOR<OrganizationCreateWithoutApprovalRequestsInput, OrganizationUncheckedCreateWithoutApprovalRequestsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutApprovalRequestsInput
    connect?: OrganizationWhereUniqueInput
  }

  export type AgentRunCreateNestedOneWithoutApprovalRequestsInput = {
    create?: XOR<AgentRunCreateWithoutApprovalRequestsInput, AgentRunUncheckedCreateWithoutApprovalRequestsInput>
    connectOrCreate?: AgentRunCreateOrConnectWithoutApprovalRequestsInput
    connect?: AgentRunWhereUniqueInput
  }

  export type AgentRunStepCreateNestedOneWithoutApprovalRequestsInput = {
    create?: XOR<AgentRunStepCreateWithoutApprovalRequestsInput, AgentRunStepUncheckedCreateWithoutApprovalRequestsInput>
    connectOrCreate?: AgentRunStepCreateOrConnectWithoutApprovalRequestsInput
    connect?: AgentRunStepWhereUniqueInput
  }

  export type UserCreateNestedOneWithoutApprovalDecisionsInput = {
    create?: XOR<UserCreateWithoutApprovalDecisionsInput, UserUncheckedCreateWithoutApprovalDecisionsInput>
    connectOrCreate?: UserCreateOrConnectWithoutApprovalDecisionsInput
    connect?: UserWhereUniqueInput
  }

  export type EnumApprovalStatusFieldUpdateOperationsInput = {
    set?: $Enums.ApprovalStatus
  }

  export type OrganizationUpdateOneRequiredWithoutApprovalRequestsNestedInput = {
    create?: XOR<OrganizationCreateWithoutApprovalRequestsInput, OrganizationUncheckedCreateWithoutApprovalRequestsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutApprovalRequestsInput
    upsert?: OrganizationUpsertWithoutApprovalRequestsInput
    connect?: OrganizationWhereUniqueInput
    update?: XOR<XOR<OrganizationUpdateToOneWithWhereWithoutApprovalRequestsInput, OrganizationUpdateWithoutApprovalRequestsInput>, OrganizationUncheckedUpdateWithoutApprovalRequestsInput>
  }

  export type AgentRunUpdateOneRequiredWithoutApprovalRequestsNestedInput = {
    create?: XOR<AgentRunCreateWithoutApprovalRequestsInput, AgentRunUncheckedCreateWithoutApprovalRequestsInput>
    connectOrCreate?: AgentRunCreateOrConnectWithoutApprovalRequestsInput
    upsert?: AgentRunUpsertWithoutApprovalRequestsInput
    connect?: AgentRunWhereUniqueInput
    update?: XOR<XOR<AgentRunUpdateToOneWithWhereWithoutApprovalRequestsInput, AgentRunUpdateWithoutApprovalRequestsInput>, AgentRunUncheckedUpdateWithoutApprovalRequestsInput>
  }

  export type AgentRunStepUpdateOneWithoutApprovalRequestsNestedInput = {
    create?: XOR<AgentRunStepCreateWithoutApprovalRequestsInput, AgentRunStepUncheckedCreateWithoutApprovalRequestsInput>
    connectOrCreate?: AgentRunStepCreateOrConnectWithoutApprovalRequestsInput
    upsert?: AgentRunStepUpsertWithoutApprovalRequestsInput
    disconnect?: AgentRunStepWhereInput | boolean
    delete?: AgentRunStepWhereInput | boolean
    connect?: AgentRunStepWhereUniqueInput
    update?: XOR<XOR<AgentRunStepUpdateToOneWithWhereWithoutApprovalRequestsInput, AgentRunStepUpdateWithoutApprovalRequestsInput>, AgentRunStepUncheckedUpdateWithoutApprovalRequestsInput>
  }

  export type UserUpdateOneWithoutApprovalDecisionsNestedInput = {
    create?: XOR<UserCreateWithoutApprovalDecisionsInput, UserUncheckedCreateWithoutApprovalDecisionsInput>
    connectOrCreate?: UserCreateOrConnectWithoutApprovalDecisionsInput
    upsert?: UserUpsertWithoutApprovalDecisionsInput
    disconnect?: UserWhereInput | boolean
    delete?: UserWhereInput | boolean
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutApprovalDecisionsInput, UserUpdateWithoutApprovalDecisionsInput>, UserUncheckedUpdateWithoutApprovalDecisionsInput>
  }

  export type OrganizationCreateNestedOneWithoutBudgetPoliciesInput = {
    create?: XOR<OrganizationCreateWithoutBudgetPoliciesInput, OrganizationUncheckedCreateWithoutBudgetPoliciesInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutBudgetPoliciesInput
    connect?: OrganizationWhereUniqueInput
  }

  export type AgentJobCreateNestedOneWithoutBudgetPolicyInput = {
    create?: XOR<AgentJobCreateWithoutBudgetPolicyInput, AgentJobUncheckedCreateWithoutBudgetPolicyInput>
    connectOrCreate?: AgentJobCreateOrConnectWithoutBudgetPolicyInput
    connect?: AgentJobWhereUniqueInput
  }

  export type OrganizationUpdateOneRequiredWithoutBudgetPoliciesNestedInput = {
    create?: XOR<OrganizationCreateWithoutBudgetPoliciesInput, OrganizationUncheckedCreateWithoutBudgetPoliciesInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutBudgetPoliciesInput
    upsert?: OrganizationUpsertWithoutBudgetPoliciesInput
    connect?: OrganizationWhereUniqueInput
    update?: XOR<XOR<OrganizationUpdateToOneWithWhereWithoutBudgetPoliciesInput, OrganizationUpdateWithoutBudgetPoliciesInput>, OrganizationUncheckedUpdateWithoutBudgetPoliciesInput>
  }

  export type AgentJobUpdateOneRequiredWithoutBudgetPolicyNestedInput = {
    create?: XOR<AgentJobCreateWithoutBudgetPolicyInput, AgentJobUncheckedCreateWithoutBudgetPolicyInput>
    connectOrCreate?: AgentJobCreateOrConnectWithoutBudgetPolicyInput
    upsert?: AgentJobUpsertWithoutBudgetPolicyInput
    connect?: AgentJobWhereUniqueInput
    update?: XOR<XOR<AgentJobUpdateToOneWithWhereWithoutBudgetPolicyInput, AgentJobUpdateWithoutBudgetPolicyInput>, AgentJobUncheckedUpdateWithoutBudgetPolicyInput>
  }

  export type OrganizationCreateNestedOneWithoutAuditLogsInput = {
    create?: XOR<OrganizationCreateWithoutAuditLogsInput, OrganizationUncheckedCreateWithoutAuditLogsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutAuditLogsInput
    connect?: OrganizationWhereUniqueInput
  }

  export type UserCreateNestedOneWithoutAuditLogsInput = {
    create?: XOR<UserCreateWithoutAuditLogsInput, UserUncheckedCreateWithoutAuditLogsInput>
    connectOrCreate?: UserCreateOrConnectWithoutAuditLogsInput
    connect?: UserWhereUniqueInput
  }

  export type OrganizationUpdateOneRequiredWithoutAuditLogsNestedInput = {
    create?: XOR<OrganizationCreateWithoutAuditLogsInput, OrganizationUncheckedCreateWithoutAuditLogsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutAuditLogsInput
    upsert?: OrganizationUpsertWithoutAuditLogsInput
    connect?: OrganizationWhereUniqueInput
    update?: XOR<XOR<OrganizationUpdateToOneWithWhereWithoutAuditLogsInput, OrganizationUpdateWithoutAuditLogsInput>, OrganizationUncheckedUpdateWithoutAuditLogsInput>
  }

  export type UserUpdateOneWithoutAuditLogsNestedInput = {
    create?: XOR<UserCreateWithoutAuditLogsInput, UserUncheckedCreateWithoutAuditLogsInput>
    connectOrCreate?: UserCreateOrConnectWithoutAuditLogsInput
    upsert?: UserUpsertWithoutAuditLogsInput
    disconnect?: UserWhereInput | boolean
    delete?: UserWhereInput | boolean
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutAuditLogsInput, UserUpdateWithoutAuditLogsInput>, UserUncheckedUpdateWithoutAuditLogsInput>
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedEnumUserRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.UserRole | EnumUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumUserRoleFilter<$PrismaModel> | $Enums.UserRole
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedEnumUserRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.UserRole | EnumUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumUserRoleWithAggregatesFilter<$PrismaModel> | $Enums.UserRole
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumUserRoleFilter<$PrismaModel>
    _max?: NestedEnumUserRoleFilter<$PrismaModel>
  }

  export type NestedEnumJobStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.JobStatus | EnumJobStatusFieldRefInput<$PrismaModel>
    in?: $Enums.JobStatus[] | ListEnumJobStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.JobStatus[] | ListEnumJobStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumJobStatusFilter<$PrismaModel> | $Enums.JobStatus
  }

  export type NestedEnumTriggerTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.TriggerType | EnumTriggerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.TriggerType[] | ListEnumTriggerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.TriggerType[] | ListEnumTriggerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumTriggerTypeFilter<$PrismaModel> | $Enums.TriggerType
  }

  export type NestedEnumHttpMethodFilter<$PrismaModel = never> = {
    equals?: $Enums.HttpMethod | EnumHttpMethodFieldRefInput<$PrismaModel>
    in?: $Enums.HttpMethod[] | ListEnumHttpMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.HttpMethod[] | ListEnumHttpMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumHttpMethodFilter<$PrismaModel> | $Enums.HttpMethod
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedEnumJobStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.JobStatus | EnumJobStatusFieldRefInput<$PrismaModel>
    in?: $Enums.JobStatus[] | ListEnumJobStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.JobStatus[] | ListEnumJobStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumJobStatusWithAggregatesFilter<$PrismaModel> | $Enums.JobStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumJobStatusFilter<$PrismaModel>
    _max?: NestedEnumJobStatusFilter<$PrismaModel>
  }

  export type NestedEnumTriggerTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TriggerType | EnumTriggerTypeFieldRefInput<$PrismaModel>
    in?: $Enums.TriggerType[] | ListEnumTriggerTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.TriggerType[] | ListEnumTriggerTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumTriggerTypeWithAggregatesFilter<$PrismaModel> | $Enums.TriggerType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTriggerTypeFilter<$PrismaModel>
    _max?: NestedEnumTriggerTypeFilter<$PrismaModel>
  }

  export type NestedEnumHttpMethodWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.HttpMethod | EnumHttpMethodFieldRefInput<$PrismaModel>
    in?: $Enums.HttpMethod[] | ListEnumHttpMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.HttpMethod[] | ListEnumHttpMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumHttpMethodWithAggregatesFilter<$PrismaModel> | $Enums.HttpMethod
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumHttpMethodFilter<$PrismaModel>
    _max?: NestedEnumHttpMethodFilter<$PrismaModel>
  }
  export type NestedJsonNullableFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<NestedJsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type NestedEnumRunStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.RunStatus | EnumRunStatusFieldRefInput<$PrismaModel>
    in?: $Enums.RunStatus[] | ListEnumRunStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.RunStatus[] | ListEnumRunStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumRunStatusFilter<$PrismaModel> | $Enums.RunStatus
  }

  export type NestedEnumTriggerSourceFilter<$PrismaModel = never> = {
    equals?: $Enums.TriggerSource | EnumTriggerSourceFieldRefInput<$PrismaModel>
    in?: $Enums.TriggerSource[] | ListEnumTriggerSourceFieldRefInput<$PrismaModel>
    notIn?: $Enums.TriggerSource[] | ListEnumTriggerSourceFieldRefInput<$PrismaModel>
    not?: NestedEnumTriggerSourceFilter<$PrismaModel> | $Enums.TriggerSource
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedDecimalNullableFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel> | null
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalNullableFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string | null
  }

  export type NestedEnumRunStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.RunStatus | EnumRunStatusFieldRefInput<$PrismaModel>
    in?: $Enums.RunStatus[] | ListEnumRunStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.RunStatus[] | ListEnumRunStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumRunStatusWithAggregatesFilter<$PrismaModel> | $Enums.RunStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumRunStatusFilter<$PrismaModel>
    _max?: NestedEnumRunStatusFilter<$PrismaModel>
  }

  export type NestedEnumTriggerSourceWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TriggerSource | EnumTriggerSourceFieldRefInput<$PrismaModel>
    in?: $Enums.TriggerSource[] | ListEnumTriggerSourceFieldRefInput<$PrismaModel>
    notIn?: $Enums.TriggerSource[] | ListEnumTriggerSourceFieldRefInput<$PrismaModel>
    not?: NestedEnumTriggerSourceWithAggregatesFilter<$PrismaModel> | $Enums.TriggerSource
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTriggerSourceFilter<$PrismaModel>
    _max?: NestedEnumTriggerSourceFilter<$PrismaModel>
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDecimalNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel> | null
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel> | null
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalNullableWithAggregatesFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedDecimalNullableFilter<$PrismaModel>
    _sum?: NestedDecimalNullableFilter<$PrismaModel>
    _min?: NestedDecimalNullableFilter<$PrismaModel>
    _max?: NestedDecimalNullableFilter<$PrismaModel>
  }

  export type NestedEnumStepTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.StepType | EnumStepTypeFieldRefInput<$PrismaModel>
    in?: $Enums.StepType[] | ListEnumStepTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.StepType[] | ListEnumStepTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumStepTypeFilter<$PrismaModel> | $Enums.StepType
  }

  export type NestedEnumStepStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.StepStatus | EnumStepStatusFieldRefInput<$PrismaModel>
    in?: $Enums.StepStatus[] | ListEnumStepStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.StepStatus[] | ListEnumStepStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumStepStatusFilter<$PrismaModel> | $Enums.StepStatus
  }

  export type NestedEnumStepTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.StepType | EnumStepTypeFieldRefInput<$PrismaModel>
    in?: $Enums.StepType[] | ListEnumStepTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.StepType[] | ListEnumStepTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumStepTypeWithAggregatesFilter<$PrismaModel> | $Enums.StepType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumStepTypeFilter<$PrismaModel>
    _max?: NestedEnumStepTypeFilter<$PrismaModel>
  }

  export type NestedEnumStepStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.StepStatus | EnumStepStatusFieldRefInput<$PrismaModel>
    in?: $Enums.StepStatus[] | ListEnumStepStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.StepStatus[] | ListEnumStepStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumStepStatusWithAggregatesFilter<$PrismaModel> | $Enums.StepStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumStepStatusFilter<$PrismaModel>
    _max?: NestedEnumStepStatusFilter<$PrismaModel>
  }

  export type NestedEnumApprovalStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.ApprovalStatus | EnumApprovalStatusFieldRefInput<$PrismaModel>
    in?: $Enums.ApprovalStatus[] | ListEnumApprovalStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.ApprovalStatus[] | ListEnumApprovalStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumApprovalStatusFilter<$PrismaModel> | $Enums.ApprovalStatus
  }

  export type NestedEnumApprovalStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ApprovalStatus | EnumApprovalStatusFieldRefInput<$PrismaModel>
    in?: $Enums.ApprovalStatus[] | ListEnumApprovalStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.ApprovalStatus[] | ListEnumApprovalStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumApprovalStatusWithAggregatesFilter<$PrismaModel> | $Enums.ApprovalStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumApprovalStatusFilter<$PrismaModel>
    _max?: NestedEnumApprovalStatusFilter<$PrismaModel>
  }

  export type UserCreateWithoutOrganizationInput = {
    id?: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
    createdJobs?: AgentJobCreateNestedManyWithoutCreatedByInput
    approvalDecisions?: ApprovalRequestCreateNestedManyWithoutDecidedByInput
    auditLogs?: AuditLogCreateNestedManyWithoutActorInput
  }

  export type UserUncheckedCreateWithoutOrganizationInput = {
    id?: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
    createdJobs?: AgentJobUncheckedCreateNestedManyWithoutCreatedByInput
    approvalDecisions?: ApprovalRequestUncheckedCreateNestedManyWithoutDecidedByInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutActorInput
  }

  export type UserCreateOrConnectWithoutOrganizationInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutOrganizationInput, UserUncheckedCreateWithoutOrganizationInput>
  }

  export type UserCreateManyOrganizationInputEnvelope = {
    data: UserCreateManyOrganizationInput | UserCreateManyOrganizationInput[]
    skipDuplicates?: boolean
  }

  export type AgentJobCreateWithoutOrganizationInput = {
    id?: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    createdBy: UserCreateNestedOneWithoutCreatedJobsInput
    runs?: AgentRunCreateNestedManyWithoutAgentJobInput
    budgetPolicy?: BudgetPolicyCreateNestedOneWithoutAgentJobInput
  }

  export type AgentJobUncheckedCreateWithoutOrganizationInput = {
    id?: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdByUserId: string
    createdAt?: Date | string
    updatedAt?: Date | string
    runs?: AgentRunUncheckedCreateNestedManyWithoutAgentJobInput
    budgetPolicy?: BudgetPolicyUncheckedCreateNestedOneWithoutAgentJobInput
  }

  export type AgentJobCreateOrConnectWithoutOrganizationInput = {
    where: AgentJobWhereUniqueInput
    create: XOR<AgentJobCreateWithoutOrganizationInput, AgentJobUncheckedCreateWithoutOrganizationInput>
  }

  export type AgentJobCreateManyOrganizationInputEnvelope = {
    data: AgentJobCreateManyOrganizationInput | AgentJobCreateManyOrganizationInput[]
    skipDuplicates?: boolean
  }

  export type AgentRunCreateWithoutOrganizationInput = {
    id?: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    agentJob: AgentJobCreateNestedOneWithoutRunsInput
    steps?: AgentRunStepCreateNestedManyWithoutAgentRunInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutAgentRunInput
  }

  export type AgentRunUncheckedCreateWithoutOrganizationInput = {
    id?: string
    agentJobId: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: AgentRunStepUncheckedCreateNestedManyWithoutAgentRunInput
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutAgentRunInput
  }

  export type AgentRunCreateOrConnectWithoutOrganizationInput = {
    where: AgentRunWhereUniqueInput
    create: XOR<AgentRunCreateWithoutOrganizationInput, AgentRunUncheckedCreateWithoutOrganizationInput>
  }

  export type AgentRunCreateManyOrganizationInputEnvelope = {
    data: AgentRunCreateManyOrganizationInput | AgentRunCreateManyOrganizationInput[]
    skipDuplicates?: boolean
  }

  export type AgentRunStepCreateWithoutOrganizationInput = {
    id?: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
    agentRun: AgentRunCreateNestedOneWithoutStepsInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutAgentRunStepInput
  }

  export type AgentRunStepUncheckedCreateWithoutOrganizationInput = {
    id?: string
    agentRunId: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutAgentRunStepInput
  }

  export type AgentRunStepCreateOrConnectWithoutOrganizationInput = {
    where: AgentRunStepWhereUniqueInput
    create: XOR<AgentRunStepCreateWithoutOrganizationInput, AgentRunStepUncheckedCreateWithoutOrganizationInput>
  }

  export type AgentRunStepCreateManyOrganizationInputEnvelope = {
    data: AgentRunStepCreateManyOrganizationInput | AgentRunStepCreateManyOrganizationInput[]
    skipDuplicates?: boolean
  }

  export type ApprovalRequestCreateWithoutOrganizationInput = {
    id?: string
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decisionReason?: string | null
    agentRun: AgentRunCreateNestedOneWithoutApprovalRequestsInput
    agentRunStep?: AgentRunStepCreateNestedOneWithoutApprovalRequestsInput
    decidedBy?: UserCreateNestedOneWithoutApprovalDecisionsInput
  }

  export type ApprovalRequestUncheckedCreateWithoutOrganizationInput = {
    id?: string
    agentRunId: string
    agentRunStepId?: string | null
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decidedByUserId?: string | null
    decisionReason?: string | null
  }

  export type ApprovalRequestCreateOrConnectWithoutOrganizationInput = {
    where: ApprovalRequestWhereUniqueInput
    create: XOR<ApprovalRequestCreateWithoutOrganizationInput, ApprovalRequestUncheckedCreateWithoutOrganizationInput>
  }

  export type ApprovalRequestCreateManyOrganizationInputEnvelope = {
    data: ApprovalRequestCreateManyOrganizationInput | ApprovalRequestCreateManyOrganizationInput[]
    skipDuplicates?: boolean
  }

  export type BudgetPolicyCreateWithoutOrganizationInput = {
    id?: string
    maxTokensPerRun?: number | null
    maxCostUsdPerRun?: Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: number | null
    maxRunsPerMonth?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    agentJob: AgentJobCreateNestedOneWithoutBudgetPolicyInput
  }

  export type BudgetPolicyUncheckedCreateWithoutOrganizationInput = {
    id?: string
    agentJobId: string
    maxTokensPerRun?: number | null
    maxCostUsdPerRun?: Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: number | null
    maxRunsPerMonth?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BudgetPolicyCreateOrConnectWithoutOrganizationInput = {
    where: BudgetPolicyWhereUniqueInput
    create: XOR<BudgetPolicyCreateWithoutOrganizationInput, BudgetPolicyUncheckedCreateWithoutOrganizationInput>
  }

  export type BudgetPolicyCreateManyOrganizationInputEnvelope = {
    data: BudgetPolicyCreateManyOrganizationInput | BudgetPolicyCreateManyOrganizationInput[]
    skipDuplicates?: boolean
  }

  export type AuditLogCreateWithoutOrganizationInput = {
    id?: string
    entityType: string
    entityId: string
    action: string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    actor?: UserCreateNestedOneWithoutAuditLogsInput
  }

  export type AuditLogUncheckedCreateWithoutOrganizationInput = {
    id?: string
    actorUserId?: string | null
    entityType: string
    entityId: string
    action: string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type AuditLogCreateOrConnectWithoutOrganizationInput = {
    where: AuditLogWhereUniqueInput
    create: XOR<AuditLogCreateWithoutOrganizationInput, AuditLogUncheckedCreateWithoutOrganizationInput>
  }

  export type AuditLogCreateManyOrganizationInputEnvelope = {
    data: AuditLogCreateManyOrganizationInput | AuditLogCreateManyOrganizationInput[]
    skipDuplicates?: boolean
  }

  export type UserUpsertWithWhereUniqueWithoutOrganizationInput = {
    where: UserWhereUniqueInput
    update: XOR<UserUpdateWithoutOrganizationInput, UserUncheckedUpdateWithoutOrganizationInput>
    create: XOR<UserCreateWithoutOrganizationInput, UserUncheckedCreateWithoutOrganizationInput>
  }

  export type UserUpdateWithWhereUniqueWithoutOrganizationInput = {
    where: UserWhereUniqueInput
    data: XOR<UserUpdateWithoutOrganizationInput, UserUncheckedUpdateWithoutOrganizationInput>
  }

  export type UserUpdateManyWithWhereWithoutOrganizationInput = {
    where: UserScalarWhereInput
    data: XOR<UserUpdateManyMutationInput, UserUncheckedUpdateManyWithoutOrganizationInput>
  }

  export type UserScalarWhereInput = {
    AND?: UserScalarWhereInput | UserScalarWhereInput[]
    OR?: UserScalarWhereInput[]
    NOT?: UserScalarWhereInput | UserScalarWhereInput[]
    id?: StringFilter<"User"> | string
    organizationId?: StringFilter<"User"> | string
    email?: StringFilter<"User"> | string
    name?: StringNullableFilter<"User"> | string | null
    role?: EnumUserRoleFilter<"User"> | $Enums.UserRole
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
  }

  export type AgentJobUpsertWithWhereUniqueWithoutOrganizationInput = {
    where: AgentJobWhereUniqueInput
    update: XOR<AgentJobUpdateWithoutOrganizationInput, AgentJobUncheckedUpdateWithoutOrganizationInput>
    create: XOR<AgentJobCreateWithoutOrganizationInput, AgentJobUncheckedCreateWithoutOrganizationInput>
  }

  export type AgentJobUpdateWithWhereUniqueWithoutOrganizationInput = {
    where: AgentJobWhereUniqueInput
    data: XOR<AgentJobUpdateWithoutOrganizationInput, AgentJobUncheckedUpdateWithoutOrganizationInput>
  }

  export type AgentJobUpdateManyWithWhereWithoutOrganizationInput = {
    where: AgentJobScalarWhereInput
    data: XOR<AgentJobUpdateManyMutationInput, AgentJobUncheckedUpdateManyWithoutOrganizationInput>
  }

  export type AgentJobScalarWhereInput = {
    AND?: AgentJobScalarWhereInput | AgentJobScalarWhereInput[]
    OR?: AgentJobScalarWhereInput[]
    NOT?: AgentJobScalarWhereInput | AgentJobScalarWhereInput[]
    id?: StringFilter<"AgentJob"> | string
    organizationId?: StringFilter<"AgentJob"> | string
    name?: StringFilter<"AgentJob"> | string
    description?: StringNullableFilter<"AgentJob"> | string | null
    status?: EnumJobStatusFilter<"AgentJob"> | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFilter<"AgentJob"> | $Enums.TriggerType
    cronExpression?: StringNullableFilter<"AgentJob"> | string | null
    timezone?: StringFilter<"AgentJob"> | string
    endpointUrl?: StringFilter<"AgentJob"> | string
    httpMethod?: EnumHttpMethodFilter<"AgentJob"> | $Enums.HttpMethod
    headersJson?: JsonNullableFilter<"AgentJob">
    maxDurationSeconds?: IntFilter<"AgentJob"> | number
    maxRetries?: IntFilter<"AgentJob"> | number
    retryBackoffSeconds?: IntFilter<"AgentJob"> | number
    requireApprovalBeforeRun?: BoolFilter<"AgentJob"> | boolean
    requireApprovalBeforeExternalAction?: BoolFilter<"AgentJob"> | boolean
    createdByUserId?: StringFilter<"AgentJob"> | string
    createdAt?: DateTimeFilter<"AgentJob"> | Date | string
    updatedAt?: DateTimeFilter<"AgentJob"> | Date | string
  }

  export type AgentRunUpsertWithWhereUniqueWithoutOrganizationInput = {
    where: AgentRunWhereUniqueInput
    update: XOR<AgentRunUpdateWithoutOrganizationInput, AgentRunUncheckedUpdateWithoutOrganizationInput>
    create: XOR<AgentRunCreateWithoutOrganizationInput, AgentRunUncheckedCreateWithoutOrganizationInput>
  }

  export type AgentRunUpdateWithWhereUniqueWithoutOrganizationInput = {
    where: AgentRunWhereUniqueInput
    data: XOR<AgentRunUpdateWithoutOrganizationInput, AgentRunUncheckedUpdateWithoutOrganizationInput>
  }

  export type AgentRunUpdateManyWithWhereWithoutOrganizationInput = {
    where: AgentRunScalarWhereInput
    data: XOR<AgentRunUpdateManyMutationInput, AgentRunUncheckedUpdateManyWithoutOrganizationInput>
  }

  export type AgentRunScalarWhereInput = {
    AND?: AgentRunScalarWhereInput | AgentRunScalarWhereInput[]
    OR?: AgentRunScalarWhereInput[]
    NOT?: AgentRunScalarWhereInput | AgentRunScalarWhereInput[]
    id?: StringFilter<"AgentRun"> | string
    organizationId?: StringFilter<"AgentRun"> | string
    agentJobId?: StringFilter<"AgentRun"> | string
    status?: EnumRunStatusFilter<"AgentRun"> | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFilter<"AgentRun"> | $Enums.TriggerSource
    startedAt?: DateTimeNullableFilter<"AgentRun"> | Date | string | null
    finishedAt?: DateTimeNullableFilter<"AgentRun"> | Date | string | null
    durationMs?: IntNullableFilter<"AgentRun"> | number | null
    attemptNumber?: IntFilter<"AgentRun"> | number
    idempotencyKey?: StringFilter<"AgentRun"> | string
    inputJson?: JsonNullableFilter<"AgentRun">
    outputJson?: JsonNullableFilter<"AgentRun">
    errorMessage?: StringNullableFilter<"AgentRun"> | string | null
    totalTokens?: IntNullableFilter<"AgentRun"> | number | null
    estimatedCostUsd?: DecimalNullableFilter<"AgentRun"> | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFilter<"AgentRun"> | Date | string
    updatedAt?: DateTimeFilter<"AgentRun"> | Date | string
  }

  export type AgentRunStepUpsertWithWhereUniqueWithoutOrganizationInput = {
    where: AgentRunStepWhereUniqueInput
    update: XOR<AgentRunStepUpdateWithoutOrganizationInput, AgentRunStepUncheckedUpdateWithoutOrganizationInput>
    create: XOR<AgentRunStepCreateWithoutOrganizationInput, AgentRunStepUncheckedCreateWithoutOrganizationInput>
  }

  export type AgentRunStepUpdateWithWhereUniqueWithoutOrganizationInput = {
    where: AgentRunStepWhereUniqueInput
    data: XOR<AgentRunStepUpdateWithoutOrganizationInput, AgentRunStepUncheckedUpdateWithoutOrganizationInput>
  }

  export type AgentRunStepUpdateManyWithWhereWithoutOrganizationInput = {
    where: AgentRunStepScalarWhereInput
    data: XOR<AgentRunStepUpdateManyMutationInput, AgentRunStepUncheckedUpdateManyWithoutOrganizationInput>
  }

  export type AgentRunStepScalarWhereInput = {
    AND?: AgentRunStepScalarWhereInput | AgentRunStepScalarWhereInput[]
    OR?: AgentRunStepScalarWhereInput[]
    NOT?: AgentRunStepScalarWhereInput | AgentRunStepScalarWhereInput[]
    id?: StringFilter<"AgentRunStep"> | string
    organizationId?: StringFilter<"AgentRunStep"> | string
    agentRunId?: StringFilter<"AgentRunStep"> | string
    stepIndex?: IntFilter<"AgentRunStep"> | number
    stepType?: EnumStepTypeFilter<"AgentRunStep"> | $Enums.StepType
    name?: StringFilter<"AgentRunStep"> | string
    status?: EnumStepStatusFilter<"AgentRunStep"> | $Enums.StepStatus
    inputJson?: JsonNullableFilter<"AgentRunStep">
    outputJson?: JsonNullableFilter<"AgentRunStep">
    errorMessage?: StringNullableFilter<"AgentRunStep"> | string | null
    tokensUsed?: IntNullableFilter<"AgentRunStep"> | number | null
    estimatedCostUsd?: DecimalNullableFilter<"AgentRunStep"> | Decimal | DecimalJsLike | number | string | null
    startedAt?: DateTimeNullableFilter<"AgentRunStep"> | Date | string | null
    finishedAt?: DateTimeNullableFilter<"AgentRunStep"> | Date | string | null
    createdAt?: DateTimeFilter<"AgentRunStep"> | Date | string
  }

  export type ApprovalRequestUpsertWithWhereUniqueWithoutOrganizationInput = {
    where: ApprovalRequestWhereUniqueInput
    update: XOR<ApprovalRequestUpdateWithoutOrganizationInput, ApprovalRequestUncheckedUpdateWithoutOrganizationInput>
    create: XOR<ApprovalRequestCreateWithoutOrganizationInput, ApprovalRequestUncheckedCreateWithoutOrganizationInput>
  }

  export type ApprovalRequestUpdateWithWhereUniqueWithoutOrganizationInput = {
    where: ApprovalRequestWhereUniqueInput
    data: XOR<ApprovalRequestUpdateWithoutOrganizationInput, ApprovalRequestUncheckedUpdateWithoutOrganizationInput>
  }

  export type ApprovalRequestUpdateManyWithWhereWithoutOrganizationInput = {
    where: ApprovalRequestScalarWhereInput
    data: XOR<ApprovalRequestUpdateManyMutationInput, ApprovalRequestUncheckedUpdateManyWithoutOrganizationInput>
  }

  export type ApprovalRequestScalarWhereInput = {
    AND?: ApprovalRequestScalarWhereInput | ApprovalRequestScalarWhereInput[]
    OR?: ApprovalRequestScalarWhereInput[]
    NOT?: ApprovalRequestScalarWhereInput | ApprovalRequestScalarWhereInput[]
    id?: StringFilter<"ApprovalRequest"> | string
    organizationId?: StringFilter<"ApprovalRequest"> | string
    agentRunId?: StringFilter<"ApprovalRequest"> | string
    agentRunStepId?: StringNullableFilter<"ApprovalRequest"> | string | null
    status?: EnumApprovalStatusFilter<"ApprovalRequest"> | $Enums.ApprovalStatus
    title?: StringFilter<"ApprovalRequest"> | string
    message?: StringFilter<"ApprovalRequest"> | string
    requestedBySystem?: BoolFilter<"ApprovalRequest"> | boolean
    requestedAt?: DateTimeFilter<"ApprovalRequest"> | Date | string
    decidedAt?: DateTimeNullableFilter<"ApprovalRequest"> | Date | string | null
    decidedByUserId?: StringNullableFilter<"ApprovalRequest"> | string | null
    decisionReason?: StringNullableFilter<"ApprovalRequest"> | string | null
  }

  export type BudgetPolicyUpsertWithWhereUniqueWithoutOrganizationInput = {
    where: BudgetPolicyWhereUniqueInput
    update: XOR<BudgetPolicyUpdateWithoutOrganizationInput, BudgetPolicyUncheckedUpdateWithoutOrganizationInput>
    create: XOR<BudgetPolicyCreateWithoutOrganizationInput, BudgetPolicyUncheckedCreateWithoutOrganizationInput>
  }

  export type BudgetPolicyUpdateWithWhereUniqueWithoutOrganizationInput = {
    where: BudgetPolicyWhereUniqueInput
    data: XOR<BudgetPolicyUpdateWithoutOrganizationInput, BudgetPolicyUncheckedUpdateWithoutOrganizationInput>
  }

  export type BudgetPolicyUpdateManyWithWhereWithoutOrganizationInput = {
    where: BudgetPolicyScalarWhereInput
    data: XOR<BudgetPolicyUpdateManyMutationInput, BudgetPolicyUncheckedUpdateManyWithoutOrganizationInput>
  }

  export type BudgetPolicyScalarWhereInput = {
    AND?: BudgetPolicyScalarWhereInput | BudgetPolicyScalarWhereInput[]
    OR?: BudgetPolicyScalarWhereInput[]
    NOT?: BudgetPolicyScalarWhereInput | BudgetPolicyScalarWhereInput[]
    id?: StringFilter<"BudgetPolicy"> | string
    organizationId?: StringFilter<"BudgetPolicy"> | string
    agentJobId?: StringFilter<"BudgetPolicy"> | string
    maxTokensPerRun?: IntNullableFilter<"BudgetPolicy"> | number | null
    maxCostUsdPerRun?: DecimalNullableFilter<"BudgetPolicy"> | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: IntNullableFilter<"BudgetPolicy"> | number | null
    maxRunsPerMonth?: IntNullableFilter<"BudgetPolicy"> | number | null
    createdAt?: DateTimeFilter<"BudgetPolicy"> | Date | string
    updatedAt?: DateTimeFilter<"BudgetPolicy"> | Date | string
  }

  export type AuditLogUpsertWithWhereUniqueWithoutOrganizationInput = {
    where: AuditLogWhereUniqueInput
    update: XOR<AuditLogUpdateWithoutOrganizationInput, AuditLogUncheckedUpdateWithoutOrganizationInput>
    create: XOR<AuditLogCreateWithoutOrganizationInput, AuditLogUncheckedCreateWithoutOrganizationInput>
  }

  export type AuditLogUpdateWithWhereUniqueWithoutOrganizationInput = {
    where: AuditLogWhereUniqueInput
    data: XOR<AuditLogUpdateWithoutOrganizationInput, AuditLogUncheckedUpdateWithoutOrganizationInput>
  }

  export type AuditLogUpdateManyWithWhereWithoutOrganizationInput = {
    where: AuditLogScalarWhereInput
    data: XOR<AuditLogUpdateManyMutationInput, AuditLogUncheckedUpdateManyWithoutOrganizationInput>
  }

  export type AuditLogScalarWhereInput = {
    AND?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
    OR?: AuditLogScalarWhereInput[]
    NOT?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
    id?: StringFilter<"AuditLog"> | string
    organizationId?: StringFilter<"AuditLog"> | string
    actorUserId?: StringNullableFilter<"AuditLog"> | string | null
    entityType?: StringFilter<"AuditLog"> | string
    entityId?: StringFilter<"AuditLog"> | string
    action?: StringFilter<"AuditLog"> | string
    metadataJson?: JsonNullableFilter<"AuditLog">
    createdAt?: DateTimeFilter<"AuditLog"> | Date | string
  }

  export type OrganizationCreateWithoutUsersInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    agentJobs?: AgentJobCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateWithoutUsersInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    agentJobs?: AgentJobUncheckedCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepUncheckedCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyUncheckedCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationCreateOrConnectWithoutUsersInput = {
    where: OrganizationWhereUniqueInput
    create: XOR<OrganizationCreateWithoutUsersInput, OrganizationUncheckedCreateWithoutUsersInput>
  }

  export type AgentJobCreateWithoutCreatedByInput = {
    id?: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentJobsInput
    runs?: AgentRunCreateNestedManyWithoutAgentJobInput
    budgetPolicy?: BudgetPolicyCreateNestedOneWithoutAgentJobInput
  }

  export type AgentJobUncheckedCreateWithoutCreatedByInput = {
    id?: string
    organizationId: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    runs?: AgentRunUncheckedCreateNestedManyWithoutAgentJobInput
    budgetPolicy?: BudgetPolicyUncheckedCreateNestedOneWithoutAgentJobInput
  }

  export type AgentJobCreateOrConnectWithoutCreatedByInput = {
    where: AgentJobWhereUniqueInput
    create: XOR<AgentJobCreateWithoutCreatedByInput, AgentJobUncheckedCreateWithoutCreatedByInput>
  }

  export type AgentJobCreateManyCreatedByInputEnvelope = {
    data: AgentJobCreateManyCreatedByInput | AgentJobCreateManyCreatedByInput[]
    skipDuplicates?: boolean
  }

  export type ApprovalRequestCreateWithoutDecidedByInput = {
    id?: string
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decisionReason?: string | null
    organization: OrganizationCreateNestedOneWithoutApprovalRequestsInput
    agentRun: AgentRunCreateNestedOneWithoutApprovalRequestsInput
    agentRunStep?: AgentRunStepCreateNestedOneWithoutApprovalRequestsInput
  }

  export type ApprovalRequestUncheckedCreateWithoutDecidedByInput = {
    id?: string
    organizationId: string
    agentRunId: string
    agentRunStepId?: string | null
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decisionReason?: string | null
  }

  export type ApprovalRequestCreateOrConnectWithoutDecidedByInput = {
    where: ApprovalRequestWhereUniqueInput
    create: XOR<ApprovalRequestCreateWithoutDecidedByInput, ApprovalRequestUncheckedCreateWithoutDecidedByInput>
  }

  export type ApprovalRequestCreateManyDecidedByInputEnvelope = {
    data: ApprovalRequestCreateManyDecidedByInput | ApprovalRequestCreateManyDecidedByInput[]
    skipDuplicates?: boolean
  }

  export type AuditLogCreateWithoutActorInput = {
    id?: string
    entityType: string
    entityId: string
    action: string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAuditLogsInput
  }

  export type AuditLogUncheckedCreateWithoutActorInput = {
    id?: string
    organizationId: string
    entityType: string
    entityId: string
    action: string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type AuditLogCreateOrConnectWithoutActorInput = {
    where: AuditLogWhereUniqueInput
    create: XOR<AuditLogCreateWithoutActorInput, AuditLogUncheckedCreateWithoutActorInput>
  }

  export type AuditLogCreateManyActorInputEnvelope = {
    data: AuditLogCreateManyActorInput | AuditLogCreateManyActorInput[]
    skipDuplicates?: boolean
  }

  export type OrganizationUpsertWithoutUsersInput = {
    update: XOR<OrganizationUpdateWithoutUsersInput, OrganizationUncheckedUpdateWithoutUsersInput>
    create: XOR<OrganizationCreateWithoutUsersInput, OrganizationUncheckedCreateWithoutUsersInput>
    where?: OrganizationWhereInput
  }

  export type OrganizationUpdateToOneWithWhereWithoutUsersInput = {
    where?: OrganizationWhereInput
    data: XOR<OrganizationUpdateWithoutUsersInput, OrganizationUncheckedUpdateWithoutUsersInput>
  }

  export type OrganizationUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    agentJobs?: AgentJobUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    agentJobs?: AgentJobUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUncheckedUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUncheckedUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type AgentJobUpsertWithWhereUniqueWithoutCreatedByInput = {
    where: AgentJobWhereUniqueInput
    update: XOR<AgentJobUpdateWithoutCreatedByInput, AgentJobUncheckedUpdateWithoutCreatedByInput>
    create: XOR<AgentJobCreateWithoutCreatedByInput, AgentJobUncheckedCreateWithoutCreatedByInput>
  }

  export type AgentJobUpdateWithWhereUniqueWithoutCreatedByInput = {
    where: AgentJobWhereUniqueInput
    data: XOR<AgentJobUpdateWithoutCreatedByInput, AgentJobUncheckedUpdateWithoutCreatedByInput>
  }

  export type AgentJobUpdateManyWithWhereWithoutCreatedByInput = {
    where: AgentJobScalarWhereInput
    data: XOR<AgentJobUpdateManyMutationInput, AgentJobUncheckedUpdateManyWithoutCreatedByInput>
  }

  export type ApprovalRequestUpsertWithWhereUniqueWithoutDecidedByInput = {
    where: ApprovalRequestWhereUniqueInput
    update: XOR<ApprovalRequestUpdateWithoutDecidedByInput, ApprovalRequestUncheckedUpdateWithoutDecidedByInput>
    create: XOR<ApprovalRequestCreateWithoutDecidedByInput, ApprovalRequestUncheckedCreateWithoutDecidedByInput>
  }

  export type ApprovalRequestUpdateWithWhereUniqueWithoutDecidedByInput = {
    where: ApprovalRequestWhereUniqueInput
    data: XOR<ApprovalRequestUpdateWithoutDecidedByInput, ApprovalRequestUncheckedUpdateWithoutDecidedByInput>
  }

  export type ApprovalRequestUpdateManyWithWhereWithoutDecidedByInput = {
    where: ApprovalRequestScalarWhereInput
    data: XOR<ApprovalRequestUpdateManyMutationInput, ApprovalRequestUncheckedUpdateManyWithoutDecidedByInput>
  }

  export type AuditLogUpsertWithWhereUniqueWithoutActorInput = {
    where: AuditLogWhereUniqueInput
    update: XOR<AuditLogUpdateWithoutActorInput, AuditLogUncheckedUpdateWithoutActorInput>
    create: XOR<AuditLogCreateWithoutActorInput, AuditLogUncheckedCreateWithoutActorInput>
  }

  export type AuditLogUpdateWithWhereUniqueWithoutActorInput = {
    where: AuditLogWhereUniqueInput
    data: XOR<AuditLogUpdateWithoutActorInput, AuditLogUncheckedUpdateWithoutActorInput>
  }

  export type AuditLogUpdateManyWithWhereWithoutActorInput = {
    where: AuditLogScalarWhereInput
    data: XOR<AuditLogUpdateManyMutationInput, AuditLogUncheckedUpdateManyWithoutActorInput>
  }

  export type OrganizationCreateWithoutAgentJobsInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateWithoutAgentJobsInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepUncheckedCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyUncheckedCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationCreateOrConnectWithoutAgentJobsInput = {
    where: OrganizationWhereUniqueInput
    create: XOR<OrganizationCreateWithoutAgentJobsInput, OrganizationUncheckedCreateWithoutAgentJobsInput>
  }

  export type UserCreateWithoutCreatedJobsInput = {
    id?: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutUsersInput
    approvalDecisions?: ApprovalRequestCreateNestedManyWithoutDecidedByInput
    auditLogs?: AuditLogCreateNestedManyWithoutActorInput
  }

  export type UserUncheckedCreateWithoutCreatedJobsInput = {
    id?: string
    organizationId: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
    approvalDecisions?: ApprovalRequestUncheckedCreateNestedManyWithoutDecidedByInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutActorInput
  }

  export type UserCreateOrConnectWithoutCreatedJobsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutCreatedJobsInput, UserUncheckedCreateWithoutCreatedJobsInput>
  }

  export type AgentRunCreateWithoutAgentJobInput = {
    id?: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentRunsInput
    steps?: AgentRunStepCreateNestedManyWithoutAgentRunInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutAgentRunInput
  }

  export type AgentRunUncheckedCreateWithoutAgentJobInput = {
    id?: string
    organizationId: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: AgentRunStepUncheckedCreateNestedManyWithoutAgentRunInput
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutAgentRunInput
  }

  export type AgentRunCreateOrConnectWithoutAgentJobInput = {
    where: AgentRunWhereUniqueInput
    create: XOR<AgentRunCreateWithoutAgentJobInput, AgentRunUncheckedCreateWithoutAgentJobInput>
  }

  export type AgentRunCreateManyAgentJobInputEnvelope = {
    data: AgentRunCreateManyAgentJobInput | AgentRunCreateManyAgentJobInput[]
    skipDuplicates?: boolean
  }

  export type BudgetPolicyCreateWithoutAgentJobInput = {
    id?: string
    maxTokensPerRun?: number | null
    maxCostUsdPerRun?: Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: number | null
    maxRunsPerMonth?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutBudgetPoliciesInput
  }

  export type BudgetPolicyUncheckedCreateWithoutAgentJobInput = {
    id?: string
    organizationId: string
    maxTokensPerRun?: number | null
    maxCostUsdPerRun?: Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: number | null
    maxRunsPerMonth?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BudgetPolicyCreateOrConnectWithoutAgentJobInput = {
    where: BudgetPolicyWhereUniqueInput
    create: XOR<BudgetPolicyCreateWithoutAgentJobInput, BudgetPolicyUncheckedCreateWithoutAgentJobInput>
  }

  export type OrganizationUpsertWithoutAgentJobsInput = {
    update: XOR<OrganizationUpdateWithoutAgentJobsInput, OrganizationUncheckedUpdateWithoutAgentJobsInput>
    create: XOR<OrganizationCreateWithoutAgentJobsInput, OrganizationUncheckedCreateWithoutAgentJobsInput>
    where?: OrganizationWhereInput
  }

  export type OrganizationUpdateToOneWithWhereWithoutAgentJobsInput = {
    where?: OrganizationWhereInput
    data: XOR<OrganizationUpdateWithoutAgentJobsInput, OrganizationUncheckedUpdateWithoutAgentJobsInput>
  }

  export type OrganizationUpdateWithoutAgentJobsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateWithoutAgentJobsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUncheckedUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUncheckedUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type UserUpsertWithoutCreatedJobsInput = {
    update: XOR<UserUpdateWithoutCreatedJobsInput, UserUncheckedUpdateWithoutCreatedJobsInput>
    create: XOR<UserCreateWithoutCreatedJobsInput, UserUncheckedCreateWithoutCreatedJobsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutCreatedJobsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutCreatedJobsInput, UserUncheckedUpdateWithoutCreatedJobsInput>
  }

  export type UserUpdateWithoutCreatedJobsInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutUsersNestedInput
    approvalDecisions?: ApprovalRequestUpdateManyWithoutDecidedByNestedInput
    auditLogs?: AuditLogUpdateManyWithoutActorNestedInput
  }

  export type UserUncheckedUpdateWithoutCreatedJobsInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    approvalDecisions?: ApprovalRequestUncheckedUpdateManyWithoutDecidedByNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutActorNestedInput
  }

  export type AgentRunUpsertWithWhereUniqueWithoutAgentJobInput = {
    where: AgentRunWhereUniqueInput
    update: XOR<AgentRunUpdateWithoutAgentJobInput, AgentRunUncheckedUpdateWithoutAgentJobInput>
    create: XOR<AgentRunCreateWithoutAgentJobInput, AgentRunUncheckedCreateWithoutAgentJobInput>
  }

  export type AgentRunUpdateWithWhereUniqueWithoutAgentJobInput = {
    where: AgentRunWhereUniqueInput
    data: XOR<AgentRunUpdateWithoutAgentJobInput, AgentRunUncheckedUpdateWithoutAgentJobInput>
  }

  export type AgentRunUpdateManyWithWhereWithoutAgentJobInput = {
    where: AgentRunScalarWhereInput
    data: XOR<AgentRunUpdateManyMutationInput, AgentRunUncheckedUpdateManyWithoutAgentJobInput>
  }

  export type BudgetPolicyUpsertWithoutAgentJobInput = {
    update: XOR<BudgetPolicyUpdateWithoutAgentJobInput, BudgetPolicyUncheckedUpdateWithoutAgentJobInput>
    create: XOR<BudgetPolicyCreateWithoutAgentJobInput, BudgetPolicyUncheckedCreateWithoutAgentJobInput>
    where?: BudgetPolicyWhereInput
  }

  export type BudgetPolicyUpdateToOneWithWhereWithoutAgentJobInput = {
    where?: BudgetPolicyWhereInput
    data: XOR<BudgetPolicyUpdateWithoutAgentJobInput, BudgetPolicyUncheckedUpdateWithoutAgentJobInput>
  }

  export type BudgetPolicyUpdateWithoutAgentJobInput = {
    id?: StringFieldUpdateOperationsInput | string
    maxTokensPerRun?: NullableIntFieldUpdateOperationsInput | number | null
    maxCostUsdPerRun?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: NullableIntFieldUpdateOperationsInput | number | null
    maxRunsPerMonth?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutBudgetPoliciesNestedInput
  }

  export type BudgetPolicyUncheckedUpdateWithoutAgentJobInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    maxTokensPerRun?: NullableIntFieldUpdateOperationsInput | number | null
    maxCostUsdPerRun?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: NullableIntFieldUpdateOperationsInput | number | null
    maxRunsPerMonth?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationCreateWithoutAgentRunsInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateWithoutAgentRunsInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobUncheckedCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepUncheckedCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyUncheckedCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationCreateOrConnectWithoutAgentRunsInput = {
    where: OrganizationWhereUniqueInput
    create: XOR<OrganizationCreateWithoutAgentRunsInput, OrganizationUncheckedCreateWithoutAgentRunsInput>
  }

  export type AgentJobCreateWithoutRunsInput = {
    id?: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentJobsInput
    createdBy: UserCreateNestedOneWithoutCreatedJobsInput
    budgetPolicy?: BudgetPolicyCreateNestedOneWithoutAgentJobInput
  }

  export type AgentJobUncheckedCreateWithoutRunsInput = {
    id?: string
    organizationId: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdByUserId: string
    createdAt?: Date | string
    updatedAt?: Date | string
    budgetPolicy?: BudgetPolicyUncheckedCreateNestedOneWithoutAgentJobInput
  }

  export type AgentJobCreateOrConnectWithoutRunsInput = {
    where: AgentJobWhereUniqueInput
    create: XOR<AgentJobCreateWithoutRunsInput, AgentJobUncheckedCreateWithoutRunsInput>
  }

  export type AgentRunStepCreateWithoutAgentRunInput = {
    id?: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentRunStepsInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutAgentRunStepInput
  }

  export type AgentRunStepUncheckedCreateWithoutAgentRunInput = {
    id?: string
    organizationId: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutAgentRunStepInput
  }

  export type AgentRunStepCreateOrConnectWithoutAgentRunInput = {
    where: AgentRunStepWhereUniqueInput
    create: XOR<AgentRunStepCreateWithoutAgentRunInput, AgentRunStepUncheckedCreateWithoutAgentRunInput>
  }

  export type AgentRunStepCreateManyAgentRunInputEnvelope = {
    data: AgentRunStepCreateManyAgentRunInput | AgentRunStepCreateManyAgentRunInput[]
    skipDuplicates?: boolean
  }

  export type ApprovalRequestCreateWithoutAgentRunInput = {
    id?: string
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decisionReason?: string | null
    organization: OrganizationCreateNestedOneWithoutApprovalRequestsInput
    agentRunStep?: AgentRunStepCreateNestedOneWithoutApprovalRequestsInput
    decidedBy?: UserCreateNestedOneWithoutApprovalDecisionsInput
  }

  export type ApprovalRequestUncheckedCreateWithoutAgentRunInput = {
    id?: string
    organizationId: string
    agentRunStepId?: string | null
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decidedByUserId?: string | null
    decisionReason?: string | null
  }

  export type ApprovalRequestCreateOrConnectWithoutAgentRunInput = {
    where: ApprovalRequestWhereUniqueInput
    create: XOR<ApprovalRequestCreateWithoutAgentRunInput, ApprovalRequestUncheckedCreateWithoutAgentRunInput>
  }

  export type ApprovalRequestCreateManyAgentRunInputEnvelope = {
    data: ApprovalRequestCreateManyAgentRunInput | ApprovalRequestCreateManyAgentRunInput[]
    skipDuplicates?: boolean
  }

  export type OrganizationUpsertWithoutAgentRunsInput = {
    update: XOR<OrganizationUpdateWithoutAgentRunsInput, OrganizationUncheckedUpdateWithoutAgentRunsInput>
    create: XOR<OrganizationCreateWithoutAgentRunsInput, OrganizationUncheckedCreateWithoutAgentRunsInput>
    where?: OrganizationWhereInput
  }

  export type OrganizationUpdateToOneWithWhereWithoutAgentRunsInput = {
    where?: OrganizationWhereInput
    data: XOR<OrganizationUpdateWithoutAgentRunsInput, OrganizationUncheckedUpdateWithoutAgentRunsInput>
  }

  export type OrganizationUpdateWithoutAgentRunsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateWithoutAgentRunsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUncheckedUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUncheckedUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type AgentJobUpsertWithoutRunsInput = {
    update: XOR<AgentJobUpdateWithoutRunsInput, AgentJobUncheckedUpdateWithoutRunsInput>
    create: XOR<AgentJobCreateWithoutRunsInput, AgentJobUncheckedCreateWithoutRunsInput>
    where?: AgentJobWhereInput
  }

  export type AgentJobUpdateToOneWithWhereWithoutRunsInput = {
    where?: AgentJobWhereInput
    data: XOR<AgentJobUpdateWithoutRunsInput, AgentJobUncheckedUpdateWithoutRunsInput>
  }

  export type AgentJobUpdateWithoutRunsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentJobsNestedInput
    createdBy?: UserUpdateOneRequiredWithoutCreatedJobsNestedInput
    budgetPolicy?: BudgetPolicyUpdateOneWithoutAgentJobNestedInput
  }

  export type AgentJobUncheckedUpdateWithoutRunsInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    budgetPolicy?: BudgetPolicyUncheckedUpdateOneWithoutAgentJobNestedInput
  }

  export type AgentRunStepUpsertWithWhereUniqueWithoutAgentRunInput = {
    where: AgentRunStepWhereUniqueInput
    update: XOR<AgentRunStepUpdateWithoutAgentRunInput, AgentRunStepUncheckedUpdateWithoutAgentRunInput>
    create: XOR<AgentRunStepCreateWithoutAgentRunInput, AgentRunStepUncheckedCreateWithoutAgentRunInput>
  }

  export type AgentRunStepUpdateWithWhereUniqueWithoutAgentRunInput = {
    where: AgentRunStepWhereUniqueInput
    data: XOR<AgentRunStepUpdateWithoutAgentRunInput, AgentRunStepUncheckedUpdateWithoutAgentRunInput>
  }

  export type AgentRunStepUpdateManyWithWhereWithoutAgentRunInput = {
    where: AgentRunStepScalarWhereInput
    data: XOR<AgentRunStepUpdateManyMutationInput, AgentRunStepUncheckedUpdateManyWithoutAgentRunInput>
  }

  export type ApprovalRequestUpsertWithWhereUniqueWithoutAgentRunInput = {
    where: ApprovalRequestWhereUniqueInput
    update: XOR<ApprovalRequestUpdateWithoutAgentRunInput, ApprovalRequestUncheckedUpdateWithoutAgentRunInput>
    create: XOR<ApprovalRequestCreateWithoutAgentRunInput, ApprovalRequestUncheckedCreateWithoutAgentRunInput>
  }

  export type ApprovalRequestUpdateWithWhereUniqueWithoutAgentRunInput = {
    where: ApprovalRequestWhereUniqueInput
    data: XOR<ApprovalRequestUpdateWithoutAgentRunInput, ApprovalRequestUncheckedUpdateWithoutAgentRunInput>
  }

  export type ApprovalRequestUpdateManyWithWhereWithoutAgentRunInput = {
    where: ApprovalRequestScalarWhereInput
    data: XOR<ApprovalRequestUpdateManyMutationInput, ApprovalRequestUncheckedUpdateManyWithoutAgentRunInput>
  }

  export type OrganizationCreateWithoutAgentRunStepsInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateWithoutAgentRunStepsInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobUncheckedCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyUncheckedCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationCreateOrConnectWithoutAgentRunStepsInput = {
    where: OrganizationWhereUniqueInput
    create: XOR<OrganizationCreateWithoutAgentRunStepsInput, OrganizationUncheckedCreateWithoutAgentRunStepsInput>
  }

  export type AgentRunCreateWithoutStepsInput = {
    id?: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentRunsInput
    agentJob: AgentJobCreateNestedOneWithoutRunsInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutAgentRunInput
  }

  export type AgentRunUncheckedCreateWithoutStepsInput = {
    id?: string
    organizationId: string
    agentJobId: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutAgentRunInput
  }

  export type AgentRunCreateOrConnectWithoutStepsInput = {
    where: AgentRunWhereUniqueInput
    create: XOR<AgentRunCreateWithoutStepsInput, AgentRunUncheckedCreateWithoutStepsInput>
  }

  export type ApprovalRequestCreateWithoutAgentRunStepInput = {
    id?: string
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decisionReason?: string | null
    organization: OrganizationCreateNestedOneWithoutApprovalRequestsInput
    agentRun: AgentRunCreateNestedOneWithoutApprovalRequestsInput
    decidedBy?: UserCreateNestedOneWithoutApprovalDecisionsInput
  }

  export type ApprovalRequestUncheckedCreateWithoutAgentRunStepInput = {
    id?: string
    organizationId: string
    agentRunId: string
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decidedByUserId?: string | null
    decisionReason?: string | null
  }

  export type ApprovalRequestCreateOrConnectWithoutAgentRunStepInput = {
    where: ApprovalRequestWhereUniqueInput
    create: XOR<ApprovalRequestCreateWithoutAgentRunStepInput, ApprovalRequestUncheckedCreateWithoutAgentRunStepInput>
  }

  export type ApprovalRequestCreateManyAgentRunStepInputEnvelope = {
    data: ApprovalRequestCreateManyAgentRunStepInput | ApprovalRequestCreateManyAgentRunStepInput[]
    skipDuplicates?: boolean
  }

  export type OrganizationUpsertWithoutAgentRunStepsInput = {
    update: XOR<OrganizationUpdateWithoutAgentRunStepsInput, OrganizationUncheckedUpdateWithoutAgentRunStepsInput>
    create: XOR<OrganizationCreateWithoutAgentRunStepsInput, OrganizationUncheckedCreateWithoutAgentRunStepsInput>
    where?: OrganizationWhereInput
  }

  export type OrganizationUpdateToOneWithWhereWithoutAgentRunStepsInput = {
    where?: OrganizationWhereInput
    data: XOR<OrganizationUpdateWithoutAgentRunStepsInput, OrganizationUncheckedUpdateWithoutAgentRunStepsInput>
  }

  export type OrganizationUpdateWithoutAgentRunStepsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateWithoutAgentRunStepsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUncheckedUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type AgentRunUpsertWithoutStepsInput = {
    update: XOR<AgentRunUpdateWithoutStepsInput, AgentRunUncheckedUpdateWithoutStepsInput>
    create: XOR<AgentRunCreateWithoutStepsInput, AgentRunUncheckedCreateWithoutStepsInput>
    where?: AgentRunWhereInput
  }

  export type AgentRunUpdateToOneWithWhereWithoutStepsInput = {
    where?: AgentRunWhereInput
    data: XOR<AgentRunUpdateWithoutStepsInput, AgentRunUncheckedUpdateWithoutStepsInput>
  }

  export type AgentRunUpdateWithoutStepsInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentRunsNestedInput
    agentJob?: AgentJobUpdateOneRequiredWithoutRunsNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutAgentRunNestedInput
  }

  export type AgentRunUncheckedUpdateWithoutStepsInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentJobId?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutAgentRunNestedInput
  }

  export type ApprovalRequestUpsertWithWhereUniqueWithoutAgentRunStepInput = {
    where: ApprovalRequestWhereUniqueInput
    update: XOR<ApprovalRequestUpdateWithoutAgentRunStepInput, ApprovalRequestUncheckedUpdateWithoutAgentRunStepInput>
    create: XOR<ApprovalRequestCreateWithoutAgentRunStepInput, ApprovalRequestUncheckedCreateWithoutAgentRunStepInput>
  }

  export type ApprovalRequestUpdateWithWhereUniqueWithoutAgentRunStepInput = {
    where: ApprovalRequestWhereUniqueInput
    data: XOR<ApprovalRequestUpdateWithoutAgentRunStepInput, ApprovalRequestUncheckedUpdateWithoutAgentRunStepInput>
  }

  export type ApprovalRequestUpdateManyWithWhereWithoutAgentRunStepInput = {
    where: ApprovalRequestScalarWhereInput
    data: XOR<ApprovalRequestUpdateManyMutationInput, ApprovalRequestUncheckedUpdateManyWithoutAgentRunStepInput>
  }

  export type OrganizationCreateWithoutApprovalRequestsInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateWithoutApprovalRequestsInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobUncheckedCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepUncheckedCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyUncheckedCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationCreateOrConnectWithoutApprovalRequestsInput = {
    where: OrganizationWhereUniqueInput
    create: XOR<OrganizationCreateWithoutApprovalRequestsInput, OrganizationUncheckedCreateWithoutApprovalRequestsInput>
  }

  export type AgentRunCreateWithoutApprovalRequestsInput = {
    id?: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentRunsInput
    agentJob: AgentJobCreateNestedOneWithoutRunsInput
    steps?: AgentRunStepCreateNestedManyWithoutAgentRunInput
  }

  export type AgentRunUncheckedCreateWithoutApprovalRequestsInput = {
    id?: string
    organizationId: string
    agentJobId: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: AgentRunStepUncheckedCreateNestedManyWithoutAgentRunInput
  }

  export type AgentRunCreateOrConnectWithoutApprovalRequestsInput = {
    where: AgentRunWhereUniqueInput
    create: XOR<AgentRunCreateWithoutApprovalRequestsInput, AgentRunUncheckedCreateWithoutApprovalRequestsInput>
  }

  export type AgentRunStepCreateWithoutApprovalRequestsInput = {
    id?: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentRunStepsInput
    agentRun: AgentRunCreateNestedOneWithoutStepsInput
  }

  export type AgentRunStepUncheckedCreateWithoutApprovalRequestsInput = {
    id?: string
    organizationId: string
    agentRunId: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
  }

  export type AgentRunStepCreateOrConnectWithoutApprovalRequestsInput = {
    where: AgentRunStepWhereUniqueInput
    create: XOR<AgentRunStepCreateWithoutApprovalRequestsInput, AgentRunStepUncheckedCreateWithoutApprovalRequestsInput>
  }

  export type UserCreateWithoutApprovalDecisionsInput = {
    id?: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutUsersInput
    createdJobs?: AgentJobCreateNestedManyWithoutCreatedByInput
    auditLogs?: AuditLogCreateNestedManyWithoutActorInput
  }

  export type UserUncheckedCreateWithoutApprovalDecisionsInput = {
    id?: string
    organizationId: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
    createdJobs?: AgentJobUncheckedCreateNestedManyWithoutCreatedByInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutActorInput
  }

  export type UserCreateOrConnectWithoutApprovalDecisionsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutApprovalDecisionsInput, UserUncheckedCreateWithoutApprovalDecisionsInput>
  }

  export type OrganizationUpsertWithoutApprovalRequestsInput = {
    update: XOR<OrganizationUpdateWithoutApprovalRequestsInput, OrganizationUncheckedUpdateWithoutApprovalRequestsInput>
    create: XOR<OrganizationCreateWithoutApprovalRequestsInput, OrganizationUncheckedCreateWithoutApprovalRequestsInput>
    where?: OrganizationWhereInput
  }

  export type OrganizationUpdateToOneWithWhereWithoutApprovalRequestsInput = {
    where?: OrganizationWhereInput
    data: XOR<OrganizationUpdateWithoutApprovalRequestsInput, OrganizationUncheckedUpdateWithoutApprovalRequestsInput>
  }

  export type OrganizationUpdateWithoutApprovalRequestsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateWithoutApprovalRequestsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUncheckedUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUncheckedUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type AgentRunUpsertWithoutApprovalRequestsInput = {
    update: XOR<AgentRunUpdateWithoutApprovalRequestsInput, AgentRunUncheckedUpdateWithoutApprovalRequestsInput>
    create: XOR<AgentRunCreateWithoutApprovalRequestsInput, AgentRunUncheckedCreateWithoutApprovalRequestsInput>
    where?: AgentRunWhereInput
  }

  export type AgentRunUpdateToOneWithWhereWithoutApprovalRequestsInput = {
    where?: AgentRunWhereInput
    data: XOR<AgentRunUpdateWithoutApprovalRequestsInput, AgentRunUncheckedUpdateWithoutApprovalRequestsInput>
  }

  export type AgentRunUpdateWithoutApprovalRequestsInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentRunsNestedInput
    agentJob?: AgentJobUpdateOneRequiredWithoutRunsNestedInput
    steps?: AgentRunStepUpdateManyWithoutAgentRunNestedInput
  }

  export type AgentRunUncheckedUpdateWithoutApprovalRequestsInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentJobId?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: AgentRunStepUncheckedUpdateManyWithoutAgentRunNestedInput
  }

  export type AgentRunStepUpsertWithoutApprovalRequestsInput = {
    update: XOR<AgentRunStepUpdateWithoutApprovalRequestsInput, AgentRunStepUncheckedUpdateWithoutApprovalRequestsInput>
    create: XOR<AgentRunStepCreateWithoutApprovalRequestsInput, AgentRunStepUncheckedCreateWithoutApprovalRequestsInput>
    where?: AgentRunStepWhereInput
  }

  export type AgentRunStepUpdateToOneWithWhereWithoutApprovalRequestsInput = {
    where?: AgentRunStepWhereInput
    data: XOR<AgentRunStepUpdateWithoutApprovalRequestsInput, AgentRunStepUncheckedUpdateWithoutApprovalRequestsInput>
  }

  export type AgentRunStepUpdateWithoutApprovalRequestsInput = {
    id?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentRunStepsNestedInput
    agentRun?: AgentRunUpdateOneRequiredWithoutStepsNestedInput
  }

  export type AgentRunStepUncheckedUpdateWithoutApprovalRequestsInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserUpsertWithoutApprovalDecisionsInput = {
    update: XOR<UserUpdateWithoutApprovalDecisionsInput, UserUncheckedUpdateWithoutApprovalDecisionsInput>
    create: XOR<UserCreateWithoutApprovalDecisionsInput, UserUncheckedCreateWithoutApprovalDecisionsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutApprovalDecisionsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutApprovalDecisionsInput, UserUncheckedUpdateWithoutApprovalDecisionsInput>
  }

  export type UserUpdateWithoutApprovalDecisionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutUsersNestedInput
    createdJobs?: AgentJobUpdateManyWithoutCreatedByNestedInput
    auditLogs?: AuditLogUpdateManyWithoutActorNestedInput
  }

  export type UserUncheckedUpdateWithoutApprovalDecisionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    createdJobs?: AgentJobUncheckedUpdateManyWithoutCreatedByNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutActorNestedInput
  }

  export type OrganizationCreateWithoutBudgetPoliciesInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateWithoutBudgetPoliciesInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobUncheckedCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepUncheckedCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutOrganizationInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationCreateOrConnectWithoutBudgetPoliciesInput = {
    where: OrganizationWhereUniqueInput
    create: XOR<OrganizationCreateWithoutBudgetPoliciesInput, OrganizationUncheckedCreateWithoutBudgetPoliciesInput>
  }

  export type AgentJobCreateWithoutBudgetPolicyInput = {
    id?: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutAgentJobsInput
    createdBy: UserCreateNestedOneWithoutCreatedJobsInput
    runs?: AgentRunCreateNestedManyWithoutAgentJobInput
  }

  export type AgentJobUncheckedCreateWithoutBudgetPolicyInput = {
    id?: string
    organizationId: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdByUserId: string
    createdAt?: Date | string
    updatedAt?: Date | string
    runs?: AgentRunUncheckedCreateNestedManyWithoutAgentJobInput
  }

  export type AgentJobCreateOrConnectWithoutBudgetPolicyInput = {
    where: AgentJobWhereUniqueInput
    create: XOR<AgentJobCreateWithoutBudgetPolicyInput, AgentJobUncheckedCreateWithoutBudgetPolicyInput>
  }

  export type OrganizationUpsertWithoutBudgetPoliciesInput = {
    update: XOR<OrganizationUpdateWithoutBudgetPoliciesInput, OrganizationUncheckedUpdateWithoutBudgetPoliciesInput>
    create: XOR<OrganizationCreateWithoutBudgetPoliciesInput, OrganizationUncheckedCreateWithoutBudgetPoliciesInput>
    where?: OrganizationWhereInput
  }

  export type OrganizationUpdateToOneWithWhereWithoutBudgetPoliciesInput = {
    where?: OrganizationWhereInput
    data: XOR<OrganizationUpdateWithoutBudgetPoliciesInput, OrganizationUncheckedUpdateWithoutBudgetPoliciesInput>
  }

  export type OrganizationUpdateWithoutBudgetPoliciesInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateWithoutBudgetPoliciesInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUncheckedUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutOrganizationNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type AgentJobUpsertWithoutBudgetPolicyInput = {
    update: XOR<AgentJobUpdateWithoutBudgetPolicyInput, AgentJobUncheckedUpdateWithoutBudgetPolicyInput>
    create: XOR<AgentJobCreateWithoutBudgetPolicyInput, AgentJobUncheckedCreateWithoutBudgetPolicyInput>
    where?: AgentJobWhereInput
  }

  export type AgentJobUpdateToOneWithWhereWithoutBudgetPolicyInput = {
    where?: AgentJobWhereInput
    data: XOR<AgentJobUpdateWithoutBudgetPolicyInput, AgentJobUncheckedUpdateWithoutBudgetPolicyInput>
  }

  export type AgentJobUpdateWithoutBudgetPolicyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentJobsNestedInput
    createdBy?: UserUpdateOneRequiredWithoutCreatedJobsNestedInput
    runs?: AgentRunUpdateManyWithoutAgentJobNestedInput
  }

  export type AgentJobUncheckedUpdateWithoutBudgetPolicyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    runs?: AgentRunUncheckedUpdateManyWithoutAgentJobNestedInput
  }

  export type OrganizationCreateWithoutAuditLogsInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateWithoutAuditLogsInput = {
    id?: string
    name: string
    slug: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutOrganizationInput
    agentJobs?: AgentJobUncheckedCreateNestedManyWithoutOrganizationInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutOrganizationInput
    agentRunSteps?: AgentRunStepUncheckedCreateNestedManyWithoutOrganizationInput
    approvalRequests?: ApprovalRequestUncheckedCreateNestedManyWithoutOrganizationInput
    budgetPolicies?: BudgetPolicyUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationCreateOrConnectWithoutAuditLogsInput = {
    where: OrganizationWhereUniqueInput
    create: XOR<OrganizationCreateWithoutAuditLogsInput, OrganizationUncheckedCreateWithoutAuditLogsInput>
  }

  export type UserCreateWithoutAuditLogsInput = {
    id?: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutUsersInput
    createdJobs?: AgentJobCreateNestedManyWithoutCreatedByInput
    approvalDecisions?: ApprovalRequestCreateNestedManyWithoutDecidedByInput
  }

  export type UserUncheckedCreateWithoutAuditLogsInput = {
    id?: string
    organizationId: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
    createdJobs?: AgentJobUncheckedCreateNestedManyWithoutCreatedByInput
    approvalDecisions?: ApprovalRequestUncheckedCreateNestedManyWithoutDecidedByInput
  }

  export type UserCreateOrConnectWithoutAuditLogsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutAuditLogsInput, UserUncheckedCreateWithoutAuditLogsInput>
  }

  export type OrganizationUpsertWithoutAuditLogsInput = {
    update: XOR<OrganizationUpdateWithoutAuditLogsInput, OrganizationUncheckedUpdateWithoutAuditLogsInput>
    create: XOR<OrganizationCreateWithoutAuditLogsInput, OrganizationUncheckedCreateWithoutAuditLogsInput>
    where?: OrganizationWhereInput
  }

  export type OrganizationUpdateToOneWithWhereWithoutAuditLogsInput = {
    where?: OrganizationWhereInput
    data: XOR<OrganizationUpdateWithoutAuditLogsInput, OrganizationUncheckedUpdateWithoutAuditLogsInput>
  }

  export type OrganizationUpdateWithoutAuditLogsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateWithoutAuditLogsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutOrganizationNestedInput
    agentJobs?: AgentJobUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutOrganizationNestedInput
    agentRunSteps?: AgentRunStepUncheckedUpdateManyWithoutOrganizationNestedInput
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutOrganizationNestedInput
    budgetPolicies?: BudgetPolicyUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type UserUpsertWithoutAuditLogsInput = {
    update: XOR<UserUpdateWithoutAuditLogsInput, UserUncheckedUpdateWithoutAuditLogsInput>
    create: XOR<UserCreateWithoutAuditLogsInput, UserUncheckedCreateWithoutAuditLogsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutAuditLogsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutAuditLogsInput, UserUncheckedUpdateWithoutAuditLogsInput>
  }

  export type UserUpdateWithoutAuditLogsInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutUsersNestedInput
    createdJobs?: AgentJobUpdateManyWithoutCreatedByNestedInput
    approvalDecisions?: ApprovalRequestUpdateManyWithoutDecidedByNestedInput
  }

  export type UserUncheckedUpdateWithoutAuditLogsInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    createdJobs?: AgentJobUncheckedUpdateManyWithoutCreatedByNestedInput
    approvalDecisions?: ApprovalRequestUncheckedUpdateManyWithoutDecidedByNestedInput
  }

  export type UserCreateManyOrganizationInput = {
    id?: string
    email: string
    name?: string | null
    role?: $Enums.UserRole
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentJobCreateManyOrganizationInput = {
    id?: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdByUserId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentRunCreateManyOrganizationInput = {
    id?: string
    agentJobId: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentRunStepCreateManyOrganizationInput = {
    id?: string
    agentRunId: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
  }

  export type ApprovalRequestCreateManyOrganizationInput = {
    id?: string
    agentRunId: string
    agentRunStepId?: string | null
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decidedByUserId?: string | null
    decisionReason?: string | null
  }

  export type BudgetPolicyCreateManyOrganizationInput = {
    id?: string
    agentJobId: string
    maxTokensPerRun?: number | null
    maxCostUsdPerRun?: Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: number | null
    maxRunsPerMonth?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AuditLogCreateManyOrganizationInput = {
    id?: string
    actorUserId?: string | null
    entityType: string
    entityId: string
    action: string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type UserUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    createdJobs?: AgentJobUpdateManyWithoutCreatedByNestedInput
    approvalDecisions?: ApprovalRequestUpdateManyWithoutDecidedByNestedInput
    auditLogs?: AuditLogUpdateManyWithoutActorNestedInput
  }

  export type UserUncheckedUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    createdJobs?: AgentJobUncheckedUpdateManyWithoutCreatedByNestedInput
    approvalDecisions?: ApprovalRequestUncheckedUpdateManyWithoutDecidedByNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutActorNestedInput
  }

  export type UserUncheckedUpdateManyWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    role?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentJobUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    createdBy?: UserUpdateOneRequiredWithoutCreatedJobsNestedInput
    runs?: AgentRunUpdateManyWithoutAgentJobNestedInput
    budgetPolicy?: BudgetPolicyUpdateOneWithoutAgentJobNestedInput
  }

  export type AgentJobUncheckedUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    runs?: AgentRunUncheckedUpdateManyWithoutAgentJobNestedInput
    budgetPolicy?: BudgetPolicyUncheckedUpdateOneWithoutAgentJobNestedInput
  }

  export type AgentJobUncheckedUpdateManyWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    agentJob?: AgentJobUpdateOneRequiredWithoutRunsNestedInput
    steps?: AgentRunStepUpdateManyWithoutAgentRunNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutAgentRunNestedInput
  }

  export type AgentRunUncheckedUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentJobId?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: AgentRunStepUncheckedUpdateManyWithoutAgentRunNestedInput
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutAgentRunNestedInput
  }

  export type AgentRunUncheckedUpdateManyWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentJobId?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunStepUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    agentRun?: AgentRunUpdateOneRequiredWithoutStepsNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutAgentRunStepNestedInput
  }

  export type AgentRunStepUncheckedUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutAgentRunStepNestedInput
  }

  export type AgentRunStepUncheckedUpdateManyWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ApprovalRequestUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
    agentRun?: AgentRunUpdateOneRequiredWithoutApprovalRequestsNestedInput
    agentRunStep?: AgentRunStepUpdateOneWithoutApprovalRequestsNestedInput
    decidedBy?: UserUpdateOneWithoutApprovalDecisionsNestedInput
  }

  export type ApprovalRequestUncheckedUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    agentRunStepId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decidedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type ApprovalRequestUncheckedUpdateManyWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    agentRunStepId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decidedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type BudgetPolicyUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    maxTokensPerRun?: NullableIntFieldUpdateOperationsInput | number | null
    maxCostUsdPerRun?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: NullableIntFieldUpdateOperationsInput | number | null
    maxRunsPerMonth?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    agentJob?: AgentJobUpdateOneRequiredWithoutBudgetPolicyNestedInput
  }

  export type BudgetPolicyUncheckedUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentJobId?: StringFieldUpdateOperationsInput | string
    maxTokensPerRun?: NullableIntFieldUpdateOperationsInput | number | null
    maxCostUsdPerRun?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: NullableIntFieldUpdateOperationsInput | number | null
    maxRunsPerMonth?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BudgetPolicyUncheckedUpdateManyWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentJobId?: StringFieldUpdateOperationsInput | string
    maxTokensPerRun?: NullableIntFieldUpdateOperationsInput | number | null
    maxCostUsdPerRun?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    maxRunsPerDay?: NullableIntFieldUpdateOperationsInput | number | null
    maxRunsPerMonth?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    entityType?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    actor?: UserUpdateOneWithoutAuditLogsNestedInput
  }

  export type AuditLogUncheckedUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    actorUserId?: NullableStringFieldUpdateOperationsInput | string | null
    entityType?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogUncheckedUpdateManyWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    actorUserId?: NullableStringFieldUpdateOperationsInput | string | null
    entityType?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentJobCreateManyCreatedByInput = {
    id?: string
    organizationId: string
    name: string
    description?: string | null
    status?: $Enums.JobStatus
    triggerType: $Enums.TriggerType
    cronExpression?: string | null
    timezone?: string
    endpointUrl: string
    httpMethod?: $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: number
    maxRetries?: number
    retryBackoffSeconds?: number
    requireApprovalBeforeRun?: boolean
    requireApprovalBeforeExternalAction?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ApprovalRequestCreateManyDecidedByInput = {
    id?: string
    organizationId: string
    agentRunId: string
    agentRunStepId?: string | null
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decisionReason?: string | null
  }

  export type AuditLogCreateManyActorInput = {
    id?: string
    organizationId: string
    entityType: string
    entityId: string
    action: string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type AgentJobUpdateWithoutCreatedByInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentJobsNestedInput
    runs?: AgentRunUpdateManyWithoutAgentJobNestedInput
    budgetPolicy?: BudgetPolicyUpdateOneWithoutAgentJobNestedInput
  }

  export type AgentJobUncheckedUpdateWithoutCreatedByInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    runs?: AgentRunUncheckedUpdateManyWithoutAgentJobNestedInput
    budgetPolicy?: BudgetPolicyUncheckedUpdateOneWithoutAgentJobNestedInput
  }

  export type AgentJobUncheckedUpdateManyWithoutCreatedByInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumJobStatusFieldUpdateOperationsInput | $Enums.JobStatus
    triggerType?: EnumTriggerTypeFieldUpdateOperationsInput | $Enums.TriggerType
    cronExpression?: NullableStringFieldUpdateOperationsInput | string | null
    timezone?: StringFieldUpdateOperationsInput | string
    endpointUrl?: StringFieldUpdateOperationsInput | string
    httpMethod?: EnumHttpMethodFieldUpdateOperationsInput | $Enums.HttpMethod
    headersJson?: NullableJsonNullValueInput | InputJsonValue
    maxDurationSeconds?: IntFieldUpdateOperationsInput | number
    maxRetries?: IntFieldUpdateOperationsInput | number
    retryBackoffSeconds?: IntFieldUpdateOperationsInput | number
    requireApprovalBeforeRun?: BoolFieldUpdateOperationsInput | boolean
    requireApprovalBeforeExternalAction?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ApprovalRequestUpdateWithoutDecidedByInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
    organization?: OrganizationUpdateOneRequiredWithoutApprovalRequestsNestedInput
    agentRun?: AgentRunUpdateOneRequiredWithoutApprovalRequestsNestedInput
    agentRunStep?: AgentRunStepUpdateOneWithoutApprovalRequestsNestedInput
  }

  export type ApprovalRequestUncheckedUpdateWithoutDecidedByInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    agentRunStepId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type ApprovalRequestUncheckedUpdateManyWithoutDecidedByInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    agentRunStepId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type AuditLogUpdateWithoutActorInput = {
    id?: StringFieldUpdateOperationsInput | string
    entityType?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAuditLogsNestedInput
  }

  export type AuditLogUncheckedUpdateWithoutActorInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    entityType?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogUncheckedUpdateManyWithoutActorInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    entityType?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    metadataJson?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunCreateManyAgentJobInput = {
    id?: string
    organizationId: string
    status?: $Enums.RunStatus
    triggerSource: $Enums.TriggerSource
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    durationMs?: number | null
    attemptNumber?: number
    idempotencyKey: string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    totalTokens?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentRunUpdateWithoutAgentJobInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentRunsNestedInput
    steps?: AgentRunStepUpdateManyWithoutAgentRunNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutAgentRunNestedInput
  }

  export type AgentRunUncheckedUpdateWithoutAgentJobInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: AgentRunStepUncheckedUpdateManyWithoutAgentRunNestedInput
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutAgentRunNestedInput
  }

  export type AgentRunUncheckedUpdateManyWithoutAgentJobInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    status?: EnumRunStatusFieldUpdateOperationsInput | $Enums.RunStatus
    triggerSource?: EnumTriggerSourceFieldUpdateOperationsInput | $Enums.TriggerSource
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    durationMs?: NullableIntFieldUpdateOperationsInput | number | null
    attemptNumber?: IntFieldUpdateOperationsInput | number
    idempotencyKey?: StringFieldUpdateOperationsInput | string
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunStepCreateManyAgentRunInput = {
    id?: string
    organizationId: string
    stepIndex: number
    stepType: $Enums.StepType
    name: string
    status?: $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: string | null
    tokensUsed?: number | null
    estimatedCostUsd?: Decimal | DecimalJsLike | number | string | null
    startedAt?: Date | string | null
    finishedAt?: Date | string | null
    createdAt?: Date | string
  }

  export type ApprovalRequestCreateManyAgentRunInput = {
    id?: string
    organizationId: string
    agentRunStepId?: string | null
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decidedByUserId?: string | null
    decisionReason?: string | null
  }

  export type AgentRunStepUpdateWithoutAgentRunInput = {
    id?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutAgentRunStepsNestedInput
    approvalRequests?: ApprovalRequestUpdateManyWithoutAgentRunStepNestedInput
  }

  export type AgentRunStepUncheckedUpdateWithoutAgentRunInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    approvalRequests?: ApprovalRequestUncheckedUpdateManyWithoutAgentRunStepNestedInput
  }

  export type AgentRunStepUncheckedUpdateManyWithoutAgentRunInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    stepIndex?: IntFieldUpdateOperationsInput | number
    stepType?: EnumStepTypeFieldUpdateOperationsInput | $Enums.StepType
    name?: StringFieldUpdateOperationsInput | string
    status?: EnumStepStatusFieldUpdateOperationsInput | $Enums.StepStatus
    inputJson?: NullableJsonNullValueInput | InputJsonValue
    outputJson?: NullableJsonNullValueInput | InputJsonValue
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    tokensUsed?: NullableIntFieldUpdateOperationsInput | number | null
    estimatedCostUsd?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ApprovalRequestUpdateWithoutAgentRunInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
    organization?: OrganizationUpdateOneRequiredWithoutApprovalRequestsNestedInput
    agentRunStep?: AgentRunStepUpdateOneWithoutApprovalRequestsNestedInput
    decidedBy?: UserUpdateOneWithoutApprovalDecisionsNestedInput
  }

  export type ApprovalRequestUncheckedUpdateWithoutAgentRunInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunStepId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decidedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type ApprovalRequestUncheckedUpdateManyWithoutAgentRunInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunStepId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decidedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type ApprovalRequestCreateManyAgentRunStepInput = {
    id?: string
    organizationId: string
    agentRunId: string
    status?: $Enums.ApprovalStatus
    title: string
    message: string
    requestedBySystem?: boolean
    requestedAt?: Date | string
    decidedAt?: Date | string | null
    decidedByUserId?: string | null
    decisionReason?: string | null
  }

  export type ApprovalRequestUpdateWithoutAgentRunStepInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
    organization?: OrganizationUpdateOneRequiredWithoutApprovalRequestsNestedInput
    agentRun?: AgentRunUpdateOneRequiredWithoutApprovalRequestsNestedInput
    decidedBy?: UserUpdateOneWithoutApprovalDecisionsNestedInput
  }

  export type ApprovalRequestUncheckedUpdateWithoutAgentRunStepInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decidedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type ApprovalRequestUncheckedUpdateManyWithoutAgentRunStepInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    agentRunId?: StringFieldUpdateOperationsInput | string
    status?: EnumApprovalStatusFieldUpdateOperationsInput | $Enums.ApprovalStatus
    title?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    requestedBySystem?: BoolFieldUpdateOperationsInput | boolean
    requestedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    decidedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    decidedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    decisionReason?: NullableStringFieldUpdateOperationsInput | string | null
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use OrganizationCountOutputTypeDefaultArgs instead
     */
    export type OrganizationCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = OrganizationCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use UserCountOutputTypeDefaultArgs instead
     */
    export type UserCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = UserCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use AgentJobCountOutputTypeDefaultArgs instead
     */
    export type AgentJobCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = AgentJobCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use AgentRunCountOutputTypeDefaultArgs instead
     */
    export type AgentRunCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = AgentRunCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use AgentRunStepCountOutputTypeDefaultArgs instead
     */
    export type AgentRunStepCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = AgentRunStepCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use OrganizationDefaultArgs instead
     */
    export type OrganizationArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = OrganizationDefaultArgs<ExtArgs>
    /**
     * @deprecated Use UserDefaultArgs instead
     */
    export type UserArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = UserDefaultArgs<ExtArgs>
    /**
     * @deprecated Use AgentJobDefaultArgs instead
     */
    export type AgentJobArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = AgentJobDefaultArgs<ExtArgs>
    /**
     * @deprecated Use AgentRunDefaultArgs instead
     */
    export type AgentRunArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = AgentRunDefaultArgs<ExtArgs>
    /**
     * @deprecated Use AgentRunStepDefaultArgs instead
     */
    export type AgentRunStepArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = AgentRunStepDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ApprovalRequestDefaultArgs instead
     */
    export type ApprovalRequestArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ApprovalRequestDefaultArgs<ExtArgs>
    /**
     * @deprecated Use BudgetPolicyDefaultArgs instead
     */
    export type BudgetPolicyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = BudgetPolicyDefaultArgs<ExtArgs>
    /**
     * @deprecated Use AuditLogDefaultArgs instead
     */
    export type AuditLogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = AuditLogDefaultArgs<ExtArgs>

  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}