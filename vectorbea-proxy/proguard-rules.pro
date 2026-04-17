# =============================================================================
# VectorBea Proxy — ProGuard obfuscation + shrink rules
#
# Strategy
# ────────
# Third-party libraries, protobuf/gRPC generated stubs, and every
# @Serializable data class are preserved verbatim (correct wire formats
# and framework contracts require stable names).
#
# Our proprietary package (com.vectorbea.proxy) has class and method names
# obfuscated, with the following explicit exceptions:
#
#   • MainKt.main()           — JVM entry point; must be findable by the JVM
#   • @Serializable classes   — field names ARE the JSON keys; renaming breaks
#                               serialization because we don't use @SerialName
#   • gRPC service overrides  — names are pinned by the generated base-class
#                               vtable; ProGuard preserves them automatically
#                               once the base class is kept
#
# What gets obfuscated
# ────────────────────
#   PromptService, PromptCache, AuditDispatcher, SharedRulesStore,
#   HubClient (class name + private methods), GrpcServer, SocketPermissions,
#   AppConfig, and all routing/wiring code in Main.kt
# =============================================================================


# ── General options ───────────────────────────────────────────────────────────

# Linux file system is case-sensitive; mixed-case obfuscated names can collide.
-dontusemixedcaseclassnames

# Don't silently skip non-public library classes — fail loudly instead.
-dontskipnonpubliclibraryclasses

# Print a summary of kept and removed elements to stdout during the build.
-verbose

# Optimise the bytecode in multiple passes (safe for a server JVM target).
-optimizationpasses 3

# Don't optimize across method boundaries — can cause subtle coroutine issues.
-dontoptimize


# ── Attributes to preserve ────────────────────────────────────────────────────
#
# These JVM bytecode attributes must survive or runtime behaviour breaks:
#
#   *Annotation*    — @Serializable, @SerialName, Kotlin compiler annotations
#   Signature       — generic type information used by Ktor, coroutines, gRPC
#   InnerClasses    — required for nested class references (e.g. Companion)
#   EnclosingMethod — required together with InnerClasses
#   Exceptions      — checked-exception declarations on JVM methods
#   SourceFile /
#   LineNumberTable — keep for meaningful stack traces in production logs

-keepattributes *Annotation*,
                Signature,
                InnerClasses,
                EnclosingMethod,
                Exceptions,
                SourceFile,
                LineNumberTable


# ═════════════════════════════════════════════════════════════════════════════
# ENTRY POINTS
# ═════════════════════════════════════════════════════════════════════════════

# The JVM starts execution here. The class name must be exactly what is set in
# the manifest Main-Class attribute (com.vectorbea.proxy.MainKt).
-keep class com.vectorbea.proxy.MainKt {
    public static void main(java.lang.String[]);
}


# ═════════════════════════════════════════════════════════════════════════════
# KOTLIN RUNTIME
# ═════════════════════════════════════════════════════════════════════════════

# @Metadata is embedded by the Kotlin compiler in every class. It is read at
# runtime by Kotlin reflection, coroutines (continuation dispatch), and the
# kotlinx.serialization compiler plugin output. Removing or renaming it causes
# ClassCastExceptions and SerializationException at runtime.
-keep class kotlin.Metadata { *; }

# Keep the entire Kotlin stdlib. ProGuard will still remove unreferenced
# classes within it (shrinking), but it must not rename anything.
-keep class kotlin.** { *; }
-dontwarn kotlin.**


# ═════════════════════════════════════════════════════════════════════════════
# KOTLIN COROUTINES
# ═════════════════════════════════════════════════════════════════════════════

# Coroutines use internal class names for state-machine dispatch, continuation
# interception, and structured concurrency. Any renaming breaks the runtime.
-keep class kotlinx.coroutines.** { *; }
-keepclassmembernames class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**


# ═════════════════════════════════════════════════════════════════════════════
# KOTLINX.SERIALIZATION
# ═════════════════════════════════════════════════════════════════════════════
#
# The kotlinx.serialization compiler plugin generates a hidden $serializer
# companion object for every @Serializable class. At runtime, the Json encoder
# calls serializer() on the companion, which then reads field names to build
# the JSON keys.
#
# Critical constraints:
#   1. The @Serializable class itself must not be renamed (the compiler plugin
#      registers serializers by class reference).
#   2. All FIELDS must keep their names — they become JSON keys unless @SerialName
#      is present. None of our models use @SerialName.
#   3. The generated $serializer inner class and its descriptor must survive.
#   4. The companion's serializer() method must be reachable.

-keep class kotlinx.serialization.** { *; }
-dontwarn kotlinx.serialization.**
-dontnote kotlinx.serialization.AnnotationsKt

# Preserve every class annotated with @Serializable together with all its
# fields (JSON keys), its Companion object, and the serializer() factory method.
-keep @kotlinx.serialization.Serializable class ** {
    <fields>;
    *** Companion;
    *** serializer(...);
}

# Keep the generated $serializer classes (inner classes of every @Serializable).
-keep class **$$serializer { *; }

# Keep any class that declares a KSerializer-returning serializer() method —
# this catches companion objects that are not themselves @Serializable.
-keepclasseswithmembers class ** {
    public static kotlinx.serialization.KSerializer serializer();
}


# ═════════════════════════════════════════════════════════════════════════════
# KTOR (server + client)
# ═════════════════════════════════════════════════════════════════════════════
#
# Ktor discovers plugins (ContentNegotiation, CallLogging, StatusPages, etc.)
# via ServiceLoader and inline factory functions that reference class literals.
# Renaming any Ktor class breaks plugin installation at startup.

-keep class io.ktor.** { *; }
-dontwarn io.ktor.**


# ═════════════════════════════════════════════════════════════════════════════
# GRPC + PROTOBUF
# ═════════════════════════════════════════════════════════════════════════════
#
# The protobuf/gRPC Gradle plugin generates Java + Kotlin stubs during the
# build. These classes are referenced by the gRPC runtime via reflection and
# by name in generated descriptors — they must be kept exactly as generated.

# Core gRPC runtime
-keep class io.grpc.** { *; }
-dontwarn io.grpc.**

# Protobuf runtime and generated message classes
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**

# All generated protobuf message classes (extend GeneratedMessageV3 /
# AbstractMessage). This covers GetPromptRequest/Response, LogAuditRequest/
# Response, and any future messages added to vectorbee.proto.
-keep class * extends com.google.protobuf.GeneratedMessageV3 { *; }
-keep class * extends com.google.protobuf.AbstractMessage     { *; }
-keep class * extends com.google.protobuf.ProtocolMessageEnum { *; }

# Keep all Builder inner classes generated by protobuf (used for message
# construction and by gRPC serialization).
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageV3 {
    ** newBuilder();
    ** getDefaultInstance();
    ** parseFrom(...);
    <fields>;
}

# gRPC service stubs and service descriptors.
# VectorBeaGrpcService extends the generated coroutine base class which
# ultimately implements BindableService. ProGuard will preserve the overridden
# getPrompt() and logAudit() method names automatically because the base-class
# declarations are kept here.
-keep class * extends io.grpc.BindableService          { *; }
-keep class * extends io.grpc.stub.AbstractStub        { *; }

# grpc-kotlin stub base class
-keep class io.grpc.kotlin.** { *; }
-dontwarn io.grpc.kotlin.**


# ═════════════════════════════════════════════════════════════════════════════
# NETTY + EPOLL NATIVE TRANSPORT
# ═════════════════════════════════════════════════════════════════════════════
#
# Netty resolves channel implementations, event loop groups, and codec
# pipelines by class name at runtime (via Class.forName and ServiceLoader).
# The native epoll transport (EpollServerDomainSocketChannel, EpollEventLoop-
# Group) is loaded by name from the bundled .so — any renaming breaks UDS
# binding and causes the GrpcServer startup assertion to abort the process.

-keep class io.netty.** { *; }
-dontwarn io.netty.**


# ═════════════════════════════════════════════════════════════════════════════
# SLF4J / LOGBACK
# ═════════════════════════════════════════════════════════════════════════════
#
# SLF4J discovers the logging implementation via ServiceLoader using the fully-
# qualified class name. Logback's configuration parser references appender and
# encoder classes by name. Both must be kept verbatim.

-keep class org.slf4j.**     { *; }
-keep class ch.qos.logback.** { *; }
-dontwarn org.slf4j.**
-dontwarn ch.qos.logback.**


# ═════════════════════════════════════════════════════════════════════════════
# JVM MANAGEMENT BEANS  (CPU + memory telemetry in AuditDispatcher)
# ═════════════════════════════════════════════════════════════════════════════
#
# AuditDispatcher.jvmCpuPercent() obtains the OperatingSystemMXBean and then
# casts it to com.sun.management.OperatingSystemMXBean to read processCpuLoad.
# ProGuard must keep this interface so the cast and method call resolve at
# runtime, and must not warn about the sun.* / com.sun.* packages which are
# present in the JDK but not in any library jar we ship.

-keep class java.lang.management.**      { *; }
-keep class com.sun.management.**        { *; }
-keep class sun.management.**            { *; }
-dontwarn com.sun.**
-dontwarn sun.**


# ═════════════════════════════════════════════════════════════════════════════
# SUPPRESS REMAINING WARNINGS
# ═════════════════════════════════════════════════════════════════════════════
#
# A fat jar bundles hundreds of third-party library classes. Many reference
# optional dependencies (e.g. Netty's optional OpenSSL provider, gRPC's
# optional census integration) that are not on the classpath. Suppressing
# warnings prevents spurious build failures for optional integrations that
# are not exercised by the proxy.
#
# NOTE: This must appear AFTER all explicit -keep / -dontwarn rules so that
# intentional warnings are not silently swallowed by this catch-all.

-dontwarn **
