package com.kidsstore.telegram

import com.kidsstore.common.Money
import com.kidsstore.common.Tokens
import com.kidsstore.domain.*
import com.kidsstore.repo.NotificationOutboxRepository
import com.kidsstore.repo.OrderItemRepository
import com.kidsstore.repo.StockAlertRepository
import com.kidsstore.service.StoreConfigService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.OffsetDateTime

/** Renders the exact text an administrator receives, always from persisted values. */
@Service
open class MessageRenderer(private val orderItems: OrderItemRepository, private val storeConfig: StoreConfigService) {

    @Transactional(readOnly = true)
    open fun newOrderMessage(order: Order): String {
        val settings = storeConfig.settings()
        val lines = orderItems.findForOrders(listOf(order.id!!))
        return buildString {
            append("NEW ").append(settings.storeNameEn).append(" ORDER\n\n")
            append("Order number: ").append(order.orderNumber).append("\n\n")
            append("Customer: ").append(order.customerName).append("\n")
            append("Phone: ").append(order.customerPhone).append("\n")
            order.telegramUserId?.let { append("Telegram user id: ").append(it).append("\n") }
            append("\nItems:\n")
            lines.forEach { item ->
                append("- ").append(item.productNameEn)
                append(" — Size ").append(item.sizeLabel)
                append(" — ").append(item.colorName)
                append(" — Quantity ").append(item.quantity)
                append(" (").append(Money.format(item.lineTotal, order.currency)).append(")\n")
            }
            append("\nSubtotal: ").append(Money.format(order.subtotal, order.currency)).append("\n")
            append("Delivery fee: ").append(Money.format(order.deliveryFee, order.currency)).append("\n")
            append("TOTAL TO COLLECT: ").append(Money.format(order.totalAmount, order.currency)).append("\n\n")
            append("Payment: CASH ON DELIVERY\n")
            append("Payment status: ").append(order.paymentStatus.name.replace('_', ' ')).append("\n\n")
            append("Delivery address: ").append(addressLine(order)).append("\n")
            order.deliveryInstructions?.takeIf { it.isNotBlank() }?.let { append("Customer instructions: ").append(it).append("\n") }
            order.preferredDeliveryTime?.takeIf { it.isNotBlank() }?.let { append("Preferred time: ").append(it).append("\n") }
            append("\nOrder status: ").append(order.status.name.replace('_', ' ')).append("\n")
            append("Placed: ").append(order.createdAt.toString()).append("\n")
        }
    }

    open fun statusMessage(order: Order, headline: String, extra: String? = null): String = buildString {
        append(headline).append("\n\n")
        append("Order number: ").append(order.orderNumber).append("\n")
        append("Customer: ").append(order.customerName).append(" (").append(order.customerPhone).append(")\n")
        append("Total: ").append(Money.format(order.totalAmount, order.currency)).append("\n")
        append("Order status: ").append(order.status.name.replace('_', ' ')).append("\n")
        append("Payment status: ").append(order.paymentStatus.name.replace('_', ' ')).append("\n")
        extra?.let { append("\n").append(it).append("\n") }
    }

    open fun stockMessage(variant: ProductVariant, outOfStock: Boolean, currencyLabel: String): String = buildString {
        val product = variant.product
        append(if (outOfStock) "OUT OF STOCK\n\n" else "LOW STOCK ALERT\n\n")
        append("Product: ").append(product?.nameEn ?: "unknown").append("\n")
        append("Variant: ").append(variant.sizeLabel).append(" / ").append(variant.colorName).append("\n")
        variant.sku?.let { append("SKU: ").append(it).append("\n") }
        append("Stock remaining: ").append(variant.stock).append("\n")
        append("Restock from the ").append(currencyLabel).append(" admin inventory screen.")
    }

    private fun addressLine(order: Order): String = listOfNotNull(
        order.region, order.city, order.subCity, order.neighborhood, order.addressLine,
    ).filter { it.isNotBlank() }.joinToString(", ")
}

/**
 * Notification enqueueing. Every call happens inside the caller's database transaction, so an
 * event row is committed exactly when (and only when) the business change it describes is.
 */
@Service
open class NotificationService(
    private val outbox: NotificationOutboxRepository,
    private val renderer: MessageRenderer,
    private val storeConfig: StoreConfigService,
    private val stockAlerts: StockAlertRepository,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Transactional
    open fun enqueueNewOrder(order: Order) {
        enqueue(
            eventType = NotificationEventType.NEW_ORDER,
            message = renderer.newOrderMessage(order),
            idempotencyKey = "NEW_ORDER:ORDER:${order.id}",
            order = order,
            aggregateId = order.id,
            inlineActions = true,
        )
    }

    @Transactional
    open fun enqueueOrderStatus(order: Order, eventType: NotificationEventType, headline: String, extra: String? = null, keySuffix: String? = null) {
        enqueue(
            eventType = eventType,
            message = renderer.statusMessage(order, headline, extra),
            idempotencyKey = buildString {
                append(eventType.name).append(":ORDER:").append(order.id)
                append(':').append(order.status.name)
                keySuffix?.let { append(':').append(it) }
            },
            order = order,
            aggregateId = order.id,
            inlineActions = eventType == NotificationEventType.FAILED_DELIVERY ||
                eventType == NotificationEventType.ORDER_CANCELLED ||
                eventType == NotificationEventType.CASH_COLLECTED,
        )
    }

    /**
     * Stock alerts are deduplicated on (variant, alert type, stock level) so repeated orders of a
     * popular item do not spam the administrator.
     */
    @Transactional
    open fun enqueueStockAlert(order: Order?, variant: ProductVariant, defaultThreshold: Int) {
        val outOfStock = variant.stock == 0
        val low = variant.isLowStock(defaultThreshold)
        if (!outOfStock && !low) return
        val type = if (outOfStock) NotificationEventType.OUT_OF_STOCK else NotificationEventType.LOW_STOCK
        val alreadyNotified = stockAlerts.findByVariantIdAndAlertTypeAndStockAtNotice(variant.id!!, type.name, variant.stock)
        if (alreadyNotified != null) return
        stockAlerts.save(
            StockAlert().apply {
                this.variant = variant
                this.alertType = type.name
                this.stockAtNotice = variant.stock
                this.acknowledged = false
                this.createdAt = OffsetDateTime.now()
            }
        )
        enqueue(
            eventType = type,
            message = renderer.stockMessage(variant, outOfStock, storeConfig.settings().currency),
            // Variant stock keeps changing, so the stock level is part of the key.
            idempotencyKey = "$type:VARIANT:${variant.id}:${variant.stock}",
            order = order,
            aggregateId = variant.id,
        )
    }

    @Transactional
    open fun enqueueTest(label: String = "Test notification from the store backend.") {
        enqueue(
            eventType = NotificationEventType.TEST,
            message = "$label\nTime: ${OffsetDateTime.now()}",
            idempotencyKey = "TEST:${Tokens.urlSafe(8)}",
            order = null,
            aggregateId = null,
        )
    }

    @Transactional
    open fun enqueue(
        eventType: NotificationEventType,
        message: String,
        idempotencyKey: String,
        order: Order?,
        aggregateId: Long?,
        inlineActions: Boolean = false,
    ): NotificationOutbox {
        val settings = storeConfig.settings()
        val existing = outbox.findByIdempotencyKey(idempotencyKey)
        if (existing != null) return existing

        val row = NotificationOutbox().apply {
            this.eventType = eventType
            this.aggregateType = if (order != null) "ORDER" else "VARIANT"
            this.aggregateId = aggregateId ?: order?.id
            this.order = order
            this.idempotencyKey = idempotencyKey
            this.chatId = settings.telegramChatId
            this.message = message
            this.adminLink = order?.let { orderAdminLink(settings, it.id) }
            this.inlineActions = inlineActions && order != null
            this.status = if (settings.telegramReady()) OutboxStatus.PENDING else OutboxStatus.RETRY
            this.attempts = 0
            this.maxAttempts = 8
            // Un-paired notifications wait with a visible reason instead of pretending success.
            this.nextAttemptAt = OffsetDateTime.now()
            this.lastError = if (settings.telegramReady()) null else "telegram_not_configured"
            this.createdAt = OffsetDateTime.now()
            this.updatedAt = OffsetDateTime.now()
        }
        return outbox.save(row)
    }

    private fun orderAdminLink(settings: StoreSettings, orderId: Long?): String? {
        val base = settings.adminNotifyUrl ?: settings.miniAppUrl ?: return null
        return "${base.trimEnd('/')}/admin/orders/$orderId"
    }
}
