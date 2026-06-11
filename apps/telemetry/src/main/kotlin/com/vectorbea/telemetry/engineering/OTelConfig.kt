package com.vectorbea.telemetry.engineering

import com.vectorbea.telemetry.config.TelemetryConfig
import io.opentelemetry.api.OpenTelemetry
import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.api.common.Attributes
import io.opentelemetry.sdk.OpenTelemetrySdk
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.SdkTracerProvider
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor
import io.opentelemetry.exporter.otlp.trace.OtlpGrpcSpanExporter
import org.slf4j.LoggerFactory

/**
 * OpenTelemetry SDK bootstrap for vectorbea-telemetry service.
 * Disabled by default unless OTEL_ENABLED=true and OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * When disabled, a no-op OpenTelemetry instance is used — the service still functions normally.
 */
object OTelConfig {
    private val log = LoggerFactory.getLogger(OTelConfig::class.java)

    fun init(config: TelemetryConfig): OpenTelemetry {
        if (!config.otelEnabled) {
            log.info("[otel] OpenTelemetry disabled (OTEL_ENABLED=false)")
            return OpenTelemetry.noop()
        }
        if (config.otelEndpoint == null) {
            log.warn("[otel] OTEL_ENABLED=true but OTEL_EXPORTER_OTLP_ENDPOINT not set — using noop")
            return OpenTelemetry.noop()
        }

        return try {
            val resource = Resource.getDefault().merge(
                Resource.create(
                    Attributes.of(
                        AttributeKey.stringKey("service.name"), config.otelServiceName,
                        AttributeKey.stringKey("deployment.environment"), config.vectorbeaEnv,
                        AttributeKey.stringKey("service.version"), config.version,
                    )
                )
            )

            val spanExporter = OtlpGrpcSpanExporter.builder()
                .setEndpoint(config.otelEndpoint)
                .also { builder ->
                    config.otelHeaders?.split(",")?.forEach { header ->
                        val parts = header.split("=", limit = 2)
                        if (parts.size == 2) builder.addHeader(parts[0].trim(), parts[1].trim())
                    }
                }
                .build()

            val tracerProvider = SdkTracerProvider.builder()
                .addSpanProcessor(BatchSpanProcessor.builder(spanExporter).build())
                .setResource(resource)
                .build()

            val otel = OpenTelemetrySdk.builder()
                .setTracerProvider(tracerProvider)
                .buildAndRegisterGlobal()

            log.info("[otel] OpenTelemetry initialized — service={} endpoint={}", config.otelServiceName, config.otelEndpoint)
            otel
        } catch (e: Exception) {
            log.error("[otel] Failed to initialize OpenTelemetry: ${e.message} — falling back to noop", e)
            OpenTelemetry.noop()
        }
    }
}
