package com.kidsstore.telegram

import com.fasterxml.jackson.databind.JsonNode
import com.kidsstore.common.Tokens
import com.kidsstore.config.AppProperties
import com.kidsstore.domain.ActorType
import com.kidsstore.domain.OrderStatus
import com.kidsstore.domain.PairingCodeStatus
import com.kidsstore.domain.TelegramCallbackLog
import com.kidsstore.domain.TelegramPairingCode
import com.kidsstore.repo.TelegramCallbackLogRepository
import com.kidsstore.repo.TelegramPairingCodeRepository
import com.kidsstore.service.OrderStatusService
import com.kidsstore.service.StoreConfigService
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.OffsetDateTime
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Long-polls the bot for two admin-only jobs: turning a pairing code into a registered chat id, and
 * pressing inline order buttons. Neither trusts the caller: every action is re-authorized against
 * the stored administrator chat and re-validated through the same order state machine the panel uses.
 */
@Service
open class TelegramPollingWorker(
    private val client: TelegramBotClient,
    private val props: AppProperties,
    private val storeConfig: StoreConfigService,
    private val pairingCodes: TelegramPairingCodeRepository,
    private val callbacks: TelegramCallbackLogRepository,
    private val orderActions: TelegramOrderActions,
    private val notifications: NotificationService,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "telegram-polling").apply { isDaemon = true }
    }
    private var offset: Long? = null

    @jakarta.annotation.PostConstruct
    open fun start() {
        if (!props.telegram.enabled || !props.telegram.pollingEnabled || !client.configured) {
            log.info("Telegram polling not started (enabled={}, polling={}, tokenConfigured={})",
                props.telegram.enabled, props.telegram.pollingEnabled, client.configured)
            return
        }
        if (!running.compareAndSet(false, true)) return
        executor.submit {
            log.info("Telegram polling started")
            while (running.get()) {
                try {
                    pollOnce()
                } catch (ex: TelegramApiException) {
                    log.warn("Telegram polling error: {}", ex.message)
                    sleep(5000)
                } catch (ex: Exception) {
                    log.error("Telegram polling failed", ex)
                    sleep(10000)
                }
            }
        }
    }

    @PreDestroy
    open fun stop() {
        running.set(false)
        executor.shutdownNow()
    }

    private fun pollOnce() {
        val updates = client.getUpdates(offset, props.telegram.pollingTimeoutSeconds.coerceAtMost(5))
        if (updates.isEmpty()) return
        updates.forEach { update ->
            offset = maxOf(offset ?: 0, update.get("update_id").asLong() + 1)
            try {
                update.get("message")?.let { handleIt(it) }
                update.get("callback_query")?.let { orderActions.handle(it) }
            } catch (ex: Exception) {
                log.warn("Could not process Telegram update {}: {}", update.get("update_id")?.asLong(), ex.message)
            }
        }
    }

    private fun handleIt(message: JsonNode) {
        val chatId = message.path("chat").path("id").asLong()
        val from = message.path("from")
        val userId = from.path("id").asLong()
        val text = message.path("text").asText("")

        val codeMatch = PAIRING_PATTERN.find(text.trim())
        if (codeMatch != null) {
            val code = codeMatch.groupValues[2]
            if (consumePairingCode(code, userId, chatId)) {
                client.safeSend(chatId, "This bot is now linked to the store. Order notifications will arrive here.")
                notifications.enqueueTest("Pairing complete - this is a test order notification.")
                return
            }
            client.safeSend(chatId, "That pairing code is invalid or expired. Start again from the admin panel.")
            return
        }

        if (text.startsWith("/start") || text.startsWith("/help")) {
            val settings = storeConfig.settings()
            val base = settings.miniAppUrl
            val markup = base?.takeIf { it.isNotBlank() }?.let {
                mapOf("inline_keyboard" to listOf(listOf(mapOf("text" to "Open the store", "url" to it))))
            }
            val body = buildString {
                append("Welcome to ").append(settings.storeNameEn).append("!\n")
                if (base != null) append("Tap the button below to start shopping.\n")
                else append("The store is being set up - please check back shortly.")
            }
            runCatching { client.sendMessage(chatId, body, markup) }
                .onFailure { log.info("Welcome message not delivered: {}", it.message) }
            return
        }

        if (text.startsWith("/pair")) {
            client.safeSend(chatId, "Usage: /pair <6 digit code shown in the admin panel>")
        }
    }

    /**
     * The pairing code is the proof of identity: it is generated inside the authenticated admin
     * panel, expires quickly, is single-use, and must match the configured contact number.
     */
    private fun consumePairingCode(rawCode: String, telegramUserId: Long, chatId: Long): Boolean {
        val pending = pairingCodes.findPending().filter { it.code == rawCode }
        val code = pending.firstOrNull { !it.expiresAt.isBefore(OffsetDateTime.now()) } ?: return false
        val settings = storeConfig.settings()
        if (!props.telegram.adminContactPhone.isBlank() &&
            code.requestedContactPhone != (settings.telegramAdminContactPhone ?: props.telegram.adminContactPhone)) {
            log.warn("Pairing code {} requested for an unexpected contact number", code.id)
            return false
        }
        code.status = PairingCodeStatus.CONSUMED
        code.telegramUserId = telegramUserId
        code.telegramChatId = chatId
        code.consumedAt = OffsetDateTime.now()
        pairingCodes.save(code)

        settings.telegramChatId = chatId
        settings.telegramUserId = telegramUserId
        settings.telegramSetupComplete = true
        settings.telegramAdminContactPhone = settings.telegramAdminContactPhone ?: props.telegram.adminContactPhone
        storeConfig.save(settings)
        log.info("Telegram administrator paired (user {}, chat {})", telegramUserId, chatId)
        return true
    }

    private fun sleep(ms: Long) = runCatching { Thread.sleep(ms) }

    companion object {
        private val PAIRING_PATTERN = Regex("""^/(?:start|pair)\s+(\d{6})$""")
    }
}

/** Convenience that never lets a bot reply break the polling loop. */
fun TelegramBotClient.safeSend(chatId: Long, text: String) {
    runCatching { sendMessage(chatId, text) }
}

@Service
open class TelegramPairingService(private val pairingCodes: TelegramPairingCodeRepository, private val storeConfig: StoreConfigService) {

    @org.springframework.transaction.annotation.Transactional
    open fun issueCode(createdByEmail: String? = null): TelegramPairingCode {
        val settings = storeConfig.settings()
        val code = pairingCodes.save(
            TelegramPairingCode().apply {
                this.code = Tokens.numericCode(6)
                this.requestedContactPhone = settings.telegramAdminContactPhone ?: "0911526922"
                this.createdByEmail = createdByEmail
                this.status = PairingCodeStatus.PENDING
                this.expiresAt = OffsetDateTime.now().plusMinutes(15)
                this.createdAt = OffsetDateTime.now()
            }
        )
        return code
    }

    /** Only unexpired, unused codes are shown; a consumed code must never be replayed. */
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    open fun pendingCodes(): List<Map<String, Any?>> =
        pairingCodes.findPending()
            .filter { it.expiresAt.isAfter(OffsetDateTime.now()) }
            .map { mapOf("code" to it.code, "expiresAt" to it.expiresAt, "createdAt" to it.createdAt) }

    @org.springframework.transaction.annotation.Transactional
    open fun registerManually(telegramUserId: Long, chatId: Long): Unit {
        val settings = storeConfig.settings()
        settings.telegramUserId = telegramUserId
        settings.telegramChatId = chatId
        settings.telegramSetupComplete = true
        storeConfig.save(settings)
    }
}

/**
 * Inline button handling. Authorization is done here on the server, not assumed because a button
 * was pressed.
 */
@Service
open class TelegramOrderActions(
    private val client: TelegramBotClient,
    private val props: AppProperties,
    private val storeConfig: StoreConfigService,
    private val orders: OrderStatusService,
    private val callbacks: TelegramCallbackLogRepository,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun handle(callbackQuery: JsonNode) {
        val callbackId = callbackQuery.path("id").asText()
        val from = callbackQuery.path("from")
        val userId = from.path("id").asLong()
        val chatId = callbackQuery.path("message").path("chat").path("id").asLong().let { if (it == 0L) null else it }
        val data = callbackQuery.path("data").asText("")

        val settings = storeConfig.settings()
        val authorized = settings.telegramSetupComplete &&
            settings.telegramUserId != null &&
            settings.telegramUserId == userId &&
            (!props.telegram.enforceCallbackChat || chatId == null || chatId == settings.telegramChatId)

        val parts = data.split(":")
        val action = parts.getOrNull(0) ?: ""
        val orderId = parts.getOrNull(1)?.toLongOrNull()

        callbacks.findByCallbackId(callbackId)?.let { duplicate ->
            runCatching { client.answerCallbackQuery(callbackId, "Already handled (${duplicate.result ?: "seen"})") }
            return
        }

        if (!authorized || orderId == null) {
            log.warn("Rejected Telegram callback {} from user {} (authorized={})", data, userId, authorized)
            callbacks.save(
                TelegramCallbackLog().apply {
                    this.callbackId = callbackId
                    this.telegramUserId = userId
                    this.chatId = chatId
                    this.action = data
                    this.orderId = orderId
                    this.authorized = false
                    this.result = "unauthorized"
                    this.createdAt = OffsetDateTime.now()
                }
            )
            runCatching { client.answerCallbackQuery(callbackId, "Not authorized") }
            return
        }

        val result = try {
            when (action) {
                "confirm" -> {
                    val order = orders.transition(orderId, OrderStatus.CONFIRMED, ActorType.TELEGRAM_BUTTON,
                        "telegram-admin:${userId}", "Confirmed from Telegram button")
                    "Confirmed ${order.orderNumber}"
                }
                "reject" -> {
                    val order = orders.cancel(orderId, "Rejected by administrator", ActorType.TELEGRAM_BUTTON,
                        "telegram-admin:${userId}")
                    "Rejected ${order.orderNumber}"
                }
                "deliver" -> {
                    val order = orders.deliver(orderId, ActorType.TELEGRAM_BUTTON, "telegram-admin:${userId}",
                        "Marked delivered from Telegram button")
                    "Marked ${order.orderNumber} delivered"
                }
                else -> "Unknown action"
            }
        } catch (ex: Exception) {
            "Not allowed: ${ex.message ?: "invalid action"}"
        }

        callbacks.save(
            TelegramCallbackLog().apply {
                this.callbackId = callbackId
                this.telegramUserId = userId
                this.chatId = chatId
                this.action = data
                this.orderId = orderId
                this.authorized = true
                this.result = result.take(512)
                this.createdAt = OffsetDateTime.now()
            }
        )
        runCatching { client.answerCallbackQuery(callbackId, result) }
        chatId?.let { client.safeSend(it, result) }
    }
}
