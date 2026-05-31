package com.vectorbea.recovery.model
enum class ReplaySafety { SAFE_TO_REPLAY, IDEMPOTENT_WITH_KEY, REQUIRES_APPROVAL, NOT_REPLAYABLE, UNKNOWN }
