package com.kidsstore.domain

import jakarta.persistence.*
import java.time.OffsetDateTime

/**
 * Transactional outbox row. Written inside the same database transaction as the business change,
 * then delivered by [com.kidsstore.telegram.OutboxDispatcher] so a Telegram outage can never lose
 * a committed order event.
 */
@Entity
@Table(name = "notification_outbox")
open class NotificationOutbox {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @Enumerated(EnumType.STRING) @Column(name = "event_type", nullable = false, length = 40)
    open var eventType: NotificationEventType = NotificationEventType.NEW_ORDER

    @Column(name = "aggregate_type", nullable = false, length = 40) open var aggregateType: String = "ORDER"
    @Column(name = "aggregate_id") open var aggregateId: Long? = null

    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "order_id") open var order: Order? = null

    /** Unique so a retried business operation can never enqueue the same alert twice. */
    @Column(name = "idempotency_key", nullable = false, unique = true, length = 200) open var idempotencyKey: String = ""

    @Column(name = "chat_id") open var chatId: Long? = null

    @Column(nullable = false, columnDefinition = "text") open var message: String = ""
    @Column(name = "parse_mode", length = 16) open var parseMode: String? = null
    @Column(name = "admin_link", length = 1024) open var adminLink: String? = null
    @Column(name = "inline_actions", nullable = false) open var inlineActions: Boolean = false

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) open var status: OutboxStatus = OutboxStatus.PENDING
    @Column(nullable = false) open var attempts: Int = 0
    @Column(name = "max_attempts", nullable = false) open var maxAttempts: Int = 8
    @Column(name = "next_attempt_at", nullable = false) open var nextAttemptAt: OffsetDateTime = OffsetDateTime.now()
    @Column(name = "last_attempt_at") open var lastAttemptAt: OffsetDateTime? = null
    @Column(name = "locked_until") open var lockedUntil: OffsetDateTime? = null
    @Column(name = "sent_at") open var sentAt: OffsetDateTime? = null
    @Column(name = "telegram_message_id") open var telegramMessageId: Long? = null
    @Column(name = "last_error", length = 1000) open var lastError: String? = null
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
    @Column(name = "updated_at", nullable = false) open var updatedAt: OffsetDateTime = OffsetDateTime.now()

    @Transient
    fun exhaustedRetries(): Boolean = attempts >= maxAttempts
}

@Entity
@Table(name = "telegram_pairing_code")
open class TelegramPairingCode {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(nullable = false, unique = true, length = 16) open var code: String = ""
    @Column(name = "requested_contact_phone", nullable = false, length = 32) open var requestedContactPhone: String = ""
    @Column(name = "created_by_email") open var createdByEmail: String? = null

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) open var status: PairingCodeStatus = PairingCodeStatus.PENDING
    @Column(name = "telegram_user_id") open var telegramUserId: Long? = null
    @Column(name = "telegram_chat_id") open var telegramChatId: Long? = null
    @Column(name = "expires_at", nullable = false) open var expiresAt: OffsetDateTime = OffsetDateTime.now()
    @Column(name = "consumed_at") open var consumedAt: OffsetDateTime? = null
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "telegram_callback_log")
open class TelegramCallbackLog {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(name = "callback_id", nullable = false, unique = true, length = 128) open var callbackId: String = ""
    @Column(name = "telegram_user_id", nullable = false) open var telegramUserId: Long = 0
    @Column(name = "chat_id") open var chatId: Long? = null
    @Column(nullable = false, length = 64) open var action: String = ""
    @Column(name = "order_id") open var orderId: Long? = null
    @Column(nullable = false) open var authorized: Boolean = false
    open var result: String? = null
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}
