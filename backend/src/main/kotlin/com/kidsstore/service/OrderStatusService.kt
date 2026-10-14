package com.kidsstore.service

import com.kidsstore.common.ApiException
import com.kidsstore.common.FieldMessage
import com.kidsstore.common.badRequest
import com.kidsstore.common.conflict
import com.kidsstore.domain.*
import com.kidsstore.repo.*
import com.kidsstore.telegram.NotificationService
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.time.OffsetDateTime

/**
 * The single place order and payment state may change. Used by the admin panel, by Telegram inline
 * buttons, and by customer cancellation requests, so no caller can bypass the transition rules.
 */
@Service
open class OrderStatusService(
    private val orders: OrderRepository,
    private val orderItems: OrderItemRepository,
    private val variants: ProductVariantRepository,
    private val events: OrderStatusEventRepository,
    private val inventory: InventoryMovementRepository,
    private val notifications: NotificationService,
    private val storeConfig: StoreConfigService,
    private val audit: AuditService,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    companion object {
        val ALLOWED: Map<OrderStatus, Set<OrderStatus>> = mapOf(
            OrderStatus.PENDING_CONFIRMATION to setOf(OrderStatus.CONFIRMED, OrderStatus.CANCELLED),
            OrderStatus.CONFIRMED to setOf(OrderStatus.PROCESSING, OrderStatus.CANCELLED),
            OrderStatus.PROCESSING to setOf(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.FAILED_DELIVERY, OrderStatus.CANCELLED),
            OrderStatus.OUT_FOR_DELIVERY to setOf(OrderStatus.DELIVERED, OrderStatus.FAILED_DELIVERY),
            OrderStatus.FAILED_DELIVERY to setOf(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.PROCESSING, OrderStatus.CANCELLED),
            OrderStatus.DELIVERED to emptySet(),
            OrderStatus.CANCELLED to emptySet(),
        )
    }

    @Transactional
    open fun requireOrder(orderId: Long): Order = orders.findById(orderId).orElseThrow {
        com.kidsstore.common.notFound("order_not_found", "Order not found")
    }

    @Transactional
    open fun transition(
        orderId: Long,
        target: OrderStatus,
        actorType: ActorType,
        actorEmail: String,
        note: String? = null,
        admin: AdminActorRef? = null,
        ipAddress: String? = null,
    ): Order {
        val order = requireOrder(orderId)
        val from = order.status
        if (target == OrderStatus.DELIVERED) return deliver(orderId, actorType, actorEmail, note, admin, ipAddress)
        if (target == OrderStatus.CANCELLED) return cancel(orderId, note ?: "Cancelled", actorType, actorEmail, admin, ipAddress)
        if (ALLOWED[from]?.contains(target) != true) {
            throw conflict("invalid_transition", "Cannot move an order from ${from.name} to ${target.name}")
        }
        val now = OffsetDateTime.now()
        order.status = target
        order.updatedAt = now
        when (target) {
            OrderStatus.CONFIRMED -> order.confirmedAt = now
            OrderStatus.PROCESSING -> order.processingAt = now
            OrderStatus.OUT_FOR_DELIVERY -> order.outForDeliveryAt = now
            OrderStatus.FAILED_DELIVERY -> order.failedDeliveryCount += 1
            else -> Unit
        }
        val saved = orders.save(order)
        recordStatusEvent(saved, from, target, saved.paymentStatus, saved.paymentStatus, actorType, actorEmail, note)

        val headline = when (target) {
            OrderStatus.CONFIRMED -> "ORDER CONFIRMED"
            OrderStatus.PROCESSING -> "ORDER BEING PREPARED"
            OrderStatus.OUT_FOR_DELIVERY -> "ORDER OUT FOR DELIVERY"
            OrderStatus.FAILED_DELIVERY -> "FAILED DELIVERY ATTEMPT"
            else -> "ORDER UPDATED"
        }
        val eventType = when (target) {
            OrderStatus.CONFIRMED -> NotificationEventType.ORDER_CONFIRMED
            OrderStatus.FAILED_DELIVERY -> NotificationEventType.FAILED_DELIVERY
            else -> null
        }
        eventType?.let {
            notifications.enqueueOrderStatus(saved, it, headline, extra = note, keySuffix = "attempt:${saved.failedDeliveryCount}")
        }
        audit.record(
            action = "ORDER_STATUS_${target.name}",
            entityType = "ORDER",
            entityId = saved.id,
            summary = "${saved.orderNumber}: ${from.name} -> ${target.name}",
            actorEmail = actorEmail,
            actorType = actorType,
            admin = admin?.principal,
            ipAddress = ipAddress,
        )
        return saved
    }

    @Transactional
    open fun deliver(
        orderId: Long,
        actorType: ActorType,
        actorEmail: String,
        note: String? = null,
        admin: AdminActorRef? = null,
        ipAddress: String? = null,
    ): Order {
        val order = requireOrder(orderId)
        if (order.status != OrderStatus.OUT_FOR_DELIVERY && order.status != OrderStatus.FAILED_DELIVERY) {
            throw conflict("invalid_transition", "Only an order that is out for delivery can be marked delivered")
        }
        val from = order.status
        val now = OffsetDateTime.now()
        order.status = OrderStatus.DELIVERED
        order.deliveredAt = now
        order.updatedAt = now
        val saved = orders.save(order)
        recordStatusEvent(saved, from, OrderStatus.DELIVERED, saved.paymentStatus, saved.paymentStatus, actorType, actorEmail, note)
        // Delivered does NOT mean paid: cash is only recorded by a person who collected it.
        notifications.enqueueOrderStatus(saved, NotificationEventType.ORDER_DELIVERED, "ORDER DELIVERED",
            extra = "Cash collection is still outstanding: ${com.kidsstore.common.Money.format(saved.totalAmount, saved.currency)}",
            keySuffix = "first")
        audit.record("ORDER_DELIVERED", "ORDER", saved.id, "${saved.orderNumber} delivered",
            actorEmail = actorEmail, actorType = actorType, admin = admin?.principal, ipAddress = ipAddress)
        return saved
    }

    @Transactional
    open fun cancel(
        orderId: Long,
        reason: String,
        actorType: ActorType,
        actorEmail: String,
        admin: AdminActorRef? = null,
        ipAddress: String? = null,
        restoreStockOverride: Boolean? = null,
    ): Order {
        require(reason.isNotBlank()) { throw badRequest("reason_required", "A cancellation reason is required",
            listOf(FieldMessage("reason", "Required"))) }
        val order = requireOrder(orderId)
        if (order.status == OrderStatus.CANCELLED) throw conflict("already_cancelled", "That order is already cancelled")
        if (order.status == OrderStatus.DELIVERED) {
            throw conflict("delivered_cannot_cancel", "A delivered order cannot be cancelled; record a refund instead")
        }
        if (actorType == ActorType.CUSTOMER) {
            val settings = storeConfig.settings()
            if (!customerCancelAllowed(order, settings)) {
                throw conflict("cancel_window_closed",
                    "This order can no longer be cancelled directly. Call the store: ${settings.contactPhone}")
            }
        }
        val settings = storeConfig.settings()
        val from = order.status
        val now = OffsetDateTime.now()
        order.status = OrderStatus.CANCELLED
        order.cancelledAt = now
        order.cancellationReason = reason
        order.cancelledBy = actorEmail
        order.updatedAt = now

        val restore = restoreStockOverride
            ?: (settings.restoreStockOnCancellation && from != OrderStatus.OUT_FOR_DELIVERY)
        if (restore) {
            restoreStock(order)
            order.stockRestored = true
        }
        val saved = orders.save(order)
        recordStatusEvent(saved, from, OrderStatus.CANCELLED, saved.paymentStatus, saved.paymentStatus, actorType, actorEmail, reason)
        if (actorType == ActorType.CUSTOMER) {
            notifications.enqueueOrderStatus(saved, NotificationEventType.CANCEL_REQUEST,
                "CUSTOMER CANCELLATION REQUEST", extra = "Reason: $reason", keySuffix = "request")
        } else {
            notifications.enqueueOrderStatus(saved, NotificationEventType.ORDER_CANCELLED,
                "ORDER CANCELLED", extra = "Reason: $reason" + if (saved.stockRestored) " (stock restored)" else " (stock NOT restored)",
                keySuffix = "admin")
        }
        audit.record("ORDER_CANCELLED", "ORDER", saved.id, "${saved.orderNumber} cancelled: $reason",
            actorEmail = actorEmail, actorType = actorType, admin = admin?.principal, ipAddress = ipAddress)
        return saved
    }

    /** Customer-initiated request: recorded, then an administrator performs the real cancellation. */
    @Transactional
    open fun requestCustomerCancellation(order: Order, reason: String): Order {
        if (order.status == OrderStatus.CANCELLED || order.status == OrderStatus.DELIVERED) {
            throw conflict("cancel_not_possible", "This order can no longer be cancelled")
        }
        val settings = storeConfig.settings()
        if (!customerCancelAllowed(order, settings)) {
            throw conflict("cancel_window_closed", "Cancel window has passed. Call the store: ${settings.contactPhone}")
        }
        order.cancelRequestedAt = OffsetDateTime.now()
        order.updatedAt = OffsetDateTime.now()
        val saved = orders.save(order)
        notifications.enqueueOrderStatus(saved, NotificationEventType.CANCEL_REQUEST,
            "CUSTOMER CANCELLATION REQUEST", extra = "Reason: $reason", keySuffix = "customer-request")
        return saved
    }

    @Transactional
    open fun recordCashCollection(
        orderId: Long,
        collectedBy: String,
        amount: BigDecimal?,
        admin: AdminActorRef? = null,
        actorType: ActorType = ActorType.ADMIN,
        ipAddress: String? = null,
    ): Order {
        val order = requireOrder(orderId)
        if (order.paymentStatus == PaymentStatus.PAID) throw conflict("already_paid", "Cash for this order is already recorded")
        if (order.status != OrderStatus.DELIVERED) {
            throw conflict("not_delivered", "Record cash collection only after the order is delivered")
        }
        if (order.status == OrderStatus.CANCELLED) throw conflict("cancelled_order", "A cancelled order has no cash to collect")
        val collected = amount ?: order.totalAmount
        if (collected <= BigDecimal.ZERO) throw badRequest("invalid_amount", "Collected amount must be greater than zero")
        val fromPayment = order.paymentStatus
        order.paymentStatus = PaymentStatus.PAID
        order.amountCollected = com.kidsstore.common.Money.parse(collected)
        order.paymentCollectedAt = OffsetDateTime.now()
        order.paymentCollectedBy = collectedBy
        order.updatedAt = OffsetDateTime.now()
        val saved = orders.save(order)
        recordStatusEvent(saved, saved.status, saved.status, fromPayment, PaymentStatus.PAID, actorType, collectedBy,
            "Cash collected ${com.kidsstore.common.Money.format(collected, saved.currency)}")
        notifications.enqueueOrderStatus(saved, NotificationEventType.CASH_COLLECTED, "CASH COLLECTED",
            extra = "Collected ${com.kidsstore.common.Money.format(collected, saved.currency)} by $collectedBy",
            keySuffix = "paid")
        audit.record("ORDER_CASH_COLLECTED", "ORDER", saved.id,
            "${saved.orderNumber} paid ${com.kidsstore.common.Money.format(collected, saved.currency)}",
            actorEmail = collectedBy, actorType = actorType, admin = admin?.principal, ipAddress = ipAddress)
        return saved
    }

    @Transactional
    open fun assignCourier(orderId: Long, courierName: String?, courierPhone: String?, actorEmail: String): Order {
        val order = requireOrder(orderId)
        courierName?.let { order.courierName = it }
        courierPhone?.let { order.courierPhone = it }
        order.updatedAt = OffsetDateTime.now()
        val saved = orders.save(order)
        audit.record("ORDER_COURIER_ASSIGNED", "ORDER", saved.id, "${saved.orderNumber} courier ${saved.courierName}",
            actorEmail = actorEmail)
        return saved
    }

    private fun customerCancelAllowed(order: Order, settings: StoreSettings): Boolean {
        val cutoff = settings.allowCustomerCancelUntil
        val allowedStates = when (cutoff) {
            OrderStatus.PENDING_CONFIRMATION -> setOf(OrderStatus.PENDING_CONFIRMATION)
            OrderStatus.CONFIRMED -> setOf(OrderStatus.PENDING_CONFIRMATION, OrderStatus.CONFIRMED)
            OrderStatus.PROCESSING -> setOf(OrderStatus.PENDING_CONFIRMATION, OrderStatus.CONFIRMED, OrderStatus.PROCESSING)
            else -> setOf(OrderStatus.PENDING_CONFIRMATION)
        }
        return order.status in allowedStates
    }

    private fun restoreStock(order: Order) {
        orderItems.findForOrders(listOf(order.id!!)).forEach { item ->
            val variantId = item.variant?.id ?: return@forEach
            val variant = variants.findByIdForUpdate(variantId) ?: return@forEach
            variant.stock = variant.stock + item.quantity
            variant.updatedAt = OffsetDateTime.now()
            variants.save(variant)
            inventory.save(
                InventoryMovement().apply {
                    this.variant = variant
                    this.product = variant.product
                    this.changeQty = item.quantity
                    this.balanceAfter = variant.stock
                    this.reason = InventoryReason.CANCEL_RESTORED
                    this.referenceType = "ORDER"
                    this.referenceId = order.id
                    this.actorType = ActorType.SYSTEM
                    this.actorEmail = "cancellation"
                    this.note = "Stock restored for ${order.orderNumber}"
                    this.createdAt = OffsetDateTime.now()
                }
            )
        }
    }

    private fun recordStatusEvent(
        order: Order,
        from: OrderStatus?,
        to: OrderStatus,
        paymentFrom: PaymentStatus?,
        paymentTo: PaymentStatus?,
        actorType: ActorType,
        actorEmail: String,
        note: String?,
    ) {
        events.save(
            OrderStatusEvent().apply {
                this.order = order
                this.fromStatus = from
                this.toStatus = to
                this.fromPaymentStatus = paymentFrom
                this.toPaymentStatus = paymentTo
                this.note = note
                this.actorType = actorType
                this.actorEmail = actorEmail
                this.createdAt = OffsetDateTime.now()
            }
        )
    }
}

/** Carries the admin identity into audit rows without dragging Spring security types around. */
data class AdminActorRef(val principal: com.kidsstore.security.AdminPrincipal?)
