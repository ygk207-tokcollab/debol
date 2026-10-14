package com.kidsstore.service

import com.kidsstore.common.EthiopianPhone
import com.kidsstore.common.Money
import com.kidsstore.domain.Order
import com.kidsstore.domain.OrderStatus
import com.kidsstore.repo.AuditLogRepository
import com.kidsstore.repo.NotificationOutboxRepository
import com.kidsstore.repo.OrderItemRepository
import com.kidsstore.repo.OrderRepository
import com.kidsstore.repo.OrderStatusEventRepository
import com.kidsstore.repo.ProductImageRepository
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.time.OffsetDateTime

data class OrderItemView(
    val productNameEn: String,
    val sizeLabel: String,
    val colorName: String,
    val quantity: Int,
    val unitPrice: BigDecimal,
    val lineTotal: BigDecimal,
    val productSlug: String?,
    val variantId: Long?,
    val imageUrl: String?,
)

data class OrderStatusView(val fromStatus: OrderStatus?, val toStatus: OrderStatus, val note: String?,
                           val actorType: String, val actor: String?, val at: OffsetDateTime)

data class NotificationView(val id: Long, val eventType: String, val status: String, val attempts: Int,
                           val lastError: String?, val sentAt: OffsetDateTime?, val nextAttemptAt: OffsetDateTime,
                           val createdAt: OffsetDateTime, val message: String)

data class OrderSummaryDto(
    val id: Long,
    val orderNumber: String,
    val status: OrderStatus,
    val paymentStatus: String,
    val paymentMethod: String,
    val currency: String,
    val subtotal: BigDecimal,
    val deliveryFee: BigDecimal,
    val totalAmount: BigDecimal,
    val amountCollected: BigDecimal,
    val customerName: String,
    val customerPhone: String,
    val city: String,
    val region: String,
    val itemCount: Int,
    val placedVia: String,
    val cancelRequested: Boolean,
    val createdAt: OffsetDateTime,
    val updatedAt: OffsetDateTime,
)

data class OrderDetailDto(
    val id: Long,
    val orderNumber: String,
    val status: OrderStatus,
    val allowedStatuses: List<OrderStatus>,
    val paymentStatus: String,
    val paymentMethod: String,
    val currency: String,
    val subtotal: BigDecimal,
    val deliveryFee: BigDecimal,
    val discountAmount: BigDecimal,
    val totalAmount: BigDecimal,
    val amountCollected: BigDecimal,
    val balanceDue: BigDecimal,
    val customerName: String,
    val customerPhone: String,
    val dialPhone: String,
    val secondaryPhone: String?,
    val telegramUserId: Long?,
    val placedVia: String,
    val region: String,
    val city: String,
    val subCity: String?,
    val neighborhood: String?,
    val addressLine: String,
    val deliveryInstructions: String?,
    val preferredDeliveryTime: String?,
    val deliveryZoneName: String?,
    val estimatedDays: Int?,
    val courierName: String?,
    val courierPhone: String?,
    val createdAt: OffsetDateTime,
    val confirmedAt: OffsetDateTime?,
    val processingAt: OffsetDateTime?,
    val outForDeliveryAt: OffsetDateTime?,
    val deliveredAt: OffsetDateTime?,
    val cancelledAt: OffsetDateTime?,
    val cancelRequestedAt: OffsetDateTime?,
    val cancellationReason: String?,
    val cancelledBy: String?,
    val stockRestored: Boolean,
    val failedDeliveryCount: Int,
    val paymentCollectedAt: OffsetDateTime?,
    val paymentCollectedBy: String?,
    val updatedAt: OffsetDateTime,
    val items: List<OrderItemView>,
    val history: List<OrderStatusView>,
    val notifications: List<NotificationView>?,
    val auditTrail: List<Map<String, Any?>>?,
)

/** Reads order data for both the customer screens and the admin panel from one place. */
@Service
open class OrderViews(
    private val orders: OrderRepository,
    private val orderItems: OrderItemRepository,
    private val events: OrderStatusEventRepository,
    private val images: ProductImageRepository,
    private val outbox: NotificationOutboxRepository,
    private val audit: AuditLogRepository,
) {

    @Transactional(readOnly = true)
    open fun summaries(list: List<Order>): List<OrderSummaryDto> {
        if (list.isEmpty()) return emptyList()
        val itemsByOrder = orderItems.findForOrders(list.mapNotNull { it.id }).groupBy { it.order?.id }
        return list.map { order ->
            val lines = itemsByOrder[order.id] ?: emptyList()
            OrderSummaryDto(
                id = order.id!!,
                orderNumber = order.orderNumber,
                status = order.status,
                paymentStatus = order.paymentStatus.name,
                paymentMethod = order.paymentMethod.name,
                currency = order.currency,
                subtotal = Money.parse(order.subtotal),
                deliveryFee = Money.parse(order.deliveryFee),
                totalAmount = Money.parse(order.totalAmount),
                amountCollected = Money.parse(order.amountCollected),
                customerName = order.customerName,
                customerPhone = order.customerPhone,
                city = order.city,
                region = order.region,
                itemCount = lines.sumOf { it.quantity },
                placedVia = order.placementSource.name,
                cancelRequested = order.cancelRequestedAt != null,
                createdAt = order.createdAt,
                updatedAt = order.updatedAt,
            )
        }
    }

    @Transactional(readOnly = true)
    open fun summary(orderId: Long): OrderSummaryDto = summaries(listOf(load(orderId))).first()

    @Transactional(readOnly = true)
    open fun detail(orderId: Long, adminView: Boolean): OrderDetailDto {
        val order = load(orderId)
        val lines = orderItems.findForOrders(listOf(orderId))
        val imageByProduct = lines.mapNotNull { it.product?.id }.distinct()
            .let { ids -> images.findForProducts(ids).groupBy { it.product?.id } }
        val history = events.findForOrder(orderId).map {
            OrderStatusView(it.fromStatus, it.toStatus, it.note, it.actorType.name, it.actorEmail, it.createdAt)
        }
        return OrderDetailDto(
            id = order.id!!,
            orderNumber = order.orderNumber,
            status = order.status,
            allowedStatuses = OrderStatusService.ALLOWED[order.status]?.toList() ?: emptyList(),
            paymentStatus = order.paymentStatus.name,
            paymentMethod = order.paymentMethod.name,
            currency = order.currency,
            subtotal = Money.parse(order.subtotal),
            deliveryFee = Money.parse(order.deliveryFee),
            discountAmount = Money.parse(order.discountAmount),
            totalAmount = Money.parse(order.totalAmount),
            amountCollected = Money.parse(order.amountCollected),
            balanceDue = Money.parse(order.totalAmount - order.amountCollected),
            customerName = order.customerName,
            customerPhone = order.customerPhone,
            dialPhone = EthiopianPhone.dialUri(order.customerPhone),
            secondaryPhone = order.secondaryPhone,
            telegramUserId = order.telegramUserId,
            placedVia = order.placementSource.name,
            region = order.region,
            city = order.city,
            subCity = order.subCity,
            neighborhood = order.neighborhood,
            addressLine = order.addressLine,
            deliveryInstructions = order.deliveryInstructions,
            preferredDeliveryTime = order.preferredDeliveryTime,
            deliveryZoneName = order.deliveryZone?.nameEn,
            estimatedDays = order.deliveryZone?.estimatedDays,
            courierName = order.courierName,
            courierPhone = order.courierPhone,
            createdAt = order.createdAt,
            confirmedAt = order.confirmedAt,
            processingAt = order.processingAt,
            outForDeliveryAt = order.outForDeliveryAt,
            deliveredAt = order.deliveredAt,
            cancelledAt = order.cancelledAt,
            cancelRequestedAt = order.cancelRequestedAt,
            cancellationReason = order.cancellationReason,
            cancelledBy = order.cancelledBy,
            stockRestored = order.stockRestored,
            failedDeliveryCount = order.failedDeliveryCount,
            paymentCollectedAt = order.paymentCollectedAt,
            paymentCollectedBy = order.paymentCollectedBy,
            updatedAt = order.updatedAt,
            items = lines.map { item ->
                OrderItemView(
                    productNameEn = item.productNameEn,
                    sizeLabel = item.sizeLabel,
                    colorName = item.colorName,
                    quantity = item.quantity,
                    unitPrice = Money.parse(item.unitPrice),
                    lineTotal = Money.parse(item.lineTotal),
                    productSlug = item.productSlug,
                    variantId = item.variant?.id,
                    imageUrl = item.product?.id?.let { id ->
                        (imageByProduct[id] ?: emptyList()).firstOrNull { it.isPrimary }?.url
                            ?: (imageByProduct[id] ?: emptyList()).firstOrNull()?.url
                    },
                )
            },
            history = history,
            notifications = if (adminView) adminNotifications(orderId) else null,
            auditTrail = if (adminView) adminAudit(order) else null,
        )
    }

    @Transactional(readOnly = true)
    open fun load(orderId: Long): Order = orders.findById(orderId).orElseThrow {
        com.kidsstore.common.notFound("order_not_found", "Order not found")
    }

    @Transactional(readOnly = true)
    open fun loadByNumber(orderNumber: String): Order = orders.findByOrderNumber(orderNumber) ?: throw com.kidsstore.common.notFound(
        "order_not_found", "Order not found"
    )

    private fun adminNotifications(orderId: Long): List<NotificationView> =
        outbox.findForOrder(orderId).map {
            NotificationView(
                id = it.id!!, eventType = it.eventType.name, status = it.status.name, attempts = it.attempts,
                lastError = it.lastError, sentAt = it.sentAt, nextAttemptAt = it.nextAttemptAt,
                createdAt = it.createdAt, message = it.message,
            )
        }

    private fun adminAudit(order: Order): List<Map<String, Any?>> =
        audit.findForEntity("ORDER", order.id.toString(), PageRequest.of(0, 50)).content.map {
            mapOf(
                "id" to it.id, "action" to it.action, "actorType" to it.actorType.name,
                "actor" to it.actorEmail, "summary" to it.summary, "at" to it.createdAt,
            )
        }
}
