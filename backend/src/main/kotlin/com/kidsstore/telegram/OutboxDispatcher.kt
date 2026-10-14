package com.kidsstore.telegram

import com.kidsstore.config.AppProperties
import com.kidsstore.domain.OutboxStatus
import com.kidsstore.repo.NotificationOutboxRepository
import com.kidsstore.repo.OrderRepository
import org.slf4j.LoggerFactory
import org.springframework.data.domain.PageRequest
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import java.time.OffsetDateTime

/** Everything the sender needs, read inside one transaction so the network call happens outside it. */
data class OutboxPayload(
    val id: Long,
    val chatId: Long?,
    val message: String,
    val inlineActions: Boolean,
    val orderId: Long?,
    val orderNumber: String?,
    val orderStatus: com.kidsstore.domain.OrderStatus?,
    val adminLink: String?,
)

@Service
open class OutboxStateService(
    private val outbox: NotificationOutboxRepository,
    private val orders: OrderRepository,
    private val props: AppProperties,
    private val storeConfig: com.kidsstore.service.StoreConfigService,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** Claim due rows; locked_until keeps a second worker from picking the same row. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    open fun claim(): List<OutboxPayload> {
        val now = OffsetDateTime.now()
        val rows = outbox.claimDue(now, PageRequest.of(0, props.telegram.dispatchBatchSize))
        return rows.map { row ->
            row.status = OutboxStatus.SENDING
            row.lockedUntil = now.plusSeconds(90)
            row.updatedAt = OffsetDateTime.now()
            val order = row.order?.id?.let { orders.findById(it).orElse(null) }
            OutboxPayload(
                id = row.id!!,
                chatId = row.chatId,
                message = row.message,
                inlineActions = row.inlineActions,
                orderId = order?.id,
                orderNumber = order?.orderNumber,
                orderStatus = order?.status,
                adminLink = row.adminLink,
            )
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    open fun markSent(id: Long, telegramMessageId: Long) {
        outbox.findById(id).ifPresent { row ->
            row.status = OutboxStatus.SENT
            row.sentAt = OffsetDateTime.now()
            row.telegramMessageId = telegramMessageId
            row.lastAttemptAt = OffsetDateTime.now()
            row.lastError = null
            row.lockedUntil = null
            row.updatedAt = OffsetDateTime.now()
            outbox.save(row)
        }
    }

    /**
     * Retryable failures keep the row with exponential backoff; non-retryable ones (bad chat, bot
     * blocked) go to the dead letter queue so the admin panel can show and retry them.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    open fun markFailure(id: Long, error: TelegramApiException) {
        outbox.findById(id).ifPresent { row ->
            row.attempts += 1
            row.lastAttemptAt = OffsetDateTime.now()
            row.lockedUntil = null
            row.lastError = "${error.errorType}: ${error.message}".take(1000)
            row.updatedAt = OffsetDateTime.now()
            if (!error.retryable || row.attempts >= row.maxAttempts) {
                row.status = OutboxStatus.DEAD_LETTER
            } else {
                row.status = OutboxStatus.RETRY
                row.nextAttemptAt = OffsetDateTime.now().plusSeconds(backoffSeconds(row.attempts, error.retryAfterSeconds))
            }
            outbox.save(row)
            log.warn("Outbox {} attempt {} failed: {}", row.id, row.attempts, row.lastError)
        }
    }

    /** A configured-but-unpaired chat keeps the row pending with a visible reason instead of failing hard. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    open fun markNotConfigured(id: Long, reason: String) {
        outbox.findById(id).ifPresent { row ->
            row.attempts += 1
            row.lockedUntil = null
            row.lastError = reason
            row.status = if (row.attempts >= row.maxAttempts) OutboxStatus.DEAD_LETTER else OutboxStatus.RETRY
            row.nextAttemptAt = OffsetDateTime.now().plusSeconds(backoffSeconds(row.attempts, null))
            row.updatedAt = OffsetDateTime.now()
            pairedChatId()?.let { row.chatId = it }
            outbox.save(row)
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    open fun attachChatId(id: Long, chatId: Long) {
        outbox.findById(id).ifPresent { row ->
            row.chatId = chatId
            row.updatedAt = OffsetDateTime.now()
            outbox.save(row)
        }
    }

    private fun backoffSeconds(attempts: Int, retryAfter: Long?): Long {
        if (retryAfter != null && retryAfter > 0) return retryAfter + 1
        val base = props.telegram.backoffBaseSeconds.toLong()
        val delay = base * (1L shl (attempts - 1).coerceIn(0, 12))
        return delay.coerceAtMost(props.telegram.backoffMaxSeconds.toLong())
    }

    private fun pairedChatId(): Long? = try {
        storeConfig.settings().telegramChatId
    } catch (ex: Exception) {
        null
    }
}

@Service
open class OutboxDispatcher(
    private val state: OutboxStateService,
    private val client: TelegramBotClient,
    private val storeConfig: com.kidsstore.service.StoreConfigService,
    private val props: AppProperties,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Scheduled(fixedDelayString = "\${kidsstore.telegram.dispatch-interval-ms:5000}")
    open fun dispatch() {
        if (!props.telegram.enabled) return
        val due = state.claim()
        if (due.isEmpty()) return
        val settings = storeConfig.settings()
        due.forEach { payload -> deliver(payload, settings) }
    }

    private fun deliver(payload: OutboxPayload, settings: com.kidsstore.domain.StoreSettings) {
        val chatId = payload.chatId ?: settings.telegramChatId
        if (chatId == null) {
            state.markNotConfigured(payload.id, "telegram_admin_not_paired")
            return
        }
        if (!client.configured) {
            state.markNotConfigured(payload.id, "telegram_bot_token_missing")
            return
        }
        state.attachChatId(payload.id, chatId)
        try {
            val markup = if (payload.inlineActions && payload.orderId != null && payload.orderStatus != null) {
                InlineKeyboard.orderButtons(payload.orderId, payload.orderNumber ?: "", payload.orderStatus,
                    settings.adminNotifyUrl ?: settings.miniAppUrl)
            } else {
                null
            }
            val messageId = client.sendMessage(chatId, payload.message, markup)
            state.markSent(payload.id, messageId)
            log.info("Notification {} delivered to Telegram (message {})", payload.id, messageId)
        } catch (ex: TelegramApiException) {
            state.markFailure(payload.id, ex)
        } catch (ex: Exception) {
            state.markFailure(payload.id, TelegramApiException("sendMessage", "unexpected", ex.message ?: "error", retryable = true))
        }
    }
}
