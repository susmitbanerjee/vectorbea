package com.vectorbea.proxy.http

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermission
import kotlinx.coroutines.delay

object SocketPermissions {
    suspend fun waitForSocketAndSetPermissions(socketPath: String) {
        val path = Path.of(socketPath)

        repeat(100) {
            if (Files.exists(path)) {
                setPermissions(path)
                return
            }
            delay(50)
        }
    }

    fun prepareSocketPath(socketPath: String) {
        val path = Path.of(socketPath)
        Files.deleteIfExists(path)
        Files.createDirectories(path.parent)
    }

    private fun setPermissions(path: Path) {
        try {
            Files.setPosixFilePermissions(
                path,
                setOf(
                    PosixFilePermission.OWNER_READ,
                    PosixFilePermission.OWNER_WRITE,
                    PosixFilePermission.GROUP_READ,
                    PosixFilePermission.GROUP_WRITE,
                    PosixFilePermission.OTHERS_READ,
                    PosixFilePermission.OTHERS_WRITE
                )
            )
        } catch (_: UnsupportedOperationException) {
            // Non-POSIX file system, nothing to do.
        }
    }
}
