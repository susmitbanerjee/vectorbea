package com.vectorbea.proxy.grpc

import com.vectorbea.proxy.http.SocketPermissions
import io.grpc.BindableService
import io.grpc.Server
import io.grpc.netty.NettyServerBuilder
import io.netty.channel.epoll.Epoll
import io.netty.channel.epoll.EpollEventLoopGroup
import io.netty.channel.epoll.EpollServerDomainSocketChannel
import io.netty.channel.unix.DomainSocketAddress
import org.slf4j.LoggerFactory
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Netty-backed gRPC server bound to a Unix Domain Socket.
 *
 * On Linux this uses native epoll + EpollServerDomainSocketChannel. There is
 * no TCP listener, no TLS handshake, and no localhost loopback traversal —
 * the kernel hands the bytes directly between the SDK process and the proxy
 * over the AF_UNIX socket. Typical p50 RPC latency is ~50–200 µs.
 */
class GrpcServer(
    private val socketPath: String,
    private val service: BindableService
) {
    private val logger = LoggerFactory.getLogger(GrpcServer::class.java)

    private var server: Server? = null
    private var bossGroup: EpollEventLoopGroup? = null
    private var workerGroup: EpollEventLoopGroup? = null

    fun start() {
        check(Epoll.isAvailable()) {
            "Native epoll transport is not available. The proxy must run on Linux " +
                "with netty-transport-native-epoll on the classpath. " +
                "Cause: ${Epoll.unavailabilityCause()?.message}"
        }

        // Reuse the existing helper so the socket file gets cleared and the
        // parent directory is created before bind. We set the permissions
        // after bind below.
        SocketPermissions.prepareSocketPath(socketPath)

        val boss = EpollEventLoopGroup(1)
        val worker = EpollEventLoopGroup()
        bossGroup = boss
        workerGroup = worker

        val address = DomainSocketAddress(File(socketPath))

        server = NettyServerBuilder
            .forAddress(address)
            .channelType(EpollServerDomainSocketChannel::class.java)
            .bossEventLoopGroup(boss)
            .workerEventLoopGroup(worker)
            .addService(service)
            .build()
            .start()

        // Open the socket up so non-root SDK processes in the same pod can connect.
        runCatching {
            kotlinx.coroutines.runBlocking {
                SocketPermissions.waitForSocketAndSetPermissions(socketPath)
            }
        }.onFailure { logger.warn("could not chmod gRPC socket {}", socketPath, it) }

        logger.info("vectorbea gRPC data plane listening on unix:{}", socketPath)
    }

    fun stop() {
        try {
            server?.shutdown()?.awaitTermination(5, TimeUnit.SECONDS)
        } catch (ex: InterruptedException) {
            Thread.currentThread().interrupt()
            logger.warn("interrupted while shutting down gRPC server", ex)
        } finally {
            bossGroup?.shutdownGracefully(0, 1, TimeUnit.SECONDS)
            workerGroup?.shutdownGracefully(0, 1, TimeUnit.SECONDS)
        }
    }
}
