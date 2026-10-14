package com.kidsstore.domain

import jakarta.persistence.*
import java.math.BigDecimal
import java.time.OffsetDateTime

@Entity
@Table(name = "orders")
open class Order {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @Column(name = "order_number", nullable = false, unique = true, length = 32) open var orderNumber: String = ""

    /** Opaque token so a guest customer can open their own order confirmation without an account. */
    @Column(name = "public_token", nullable = false, unique = true, length = 64) open var publicToken: String = ""

    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "customer_id") open var customer: Customer? = null

    @Column(name = "cart_key", length = 64) open var cartKey: String? = null
    @Column(name = "telegram_user_id") open var telegramUserId: Long? = null

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 32) open var status: OrderStatus = OrderStatus.PENDING_CONFIRMATION

    @Enumerated(EnumType.STRING) @Column(name = "payment_status", nullable = false, length = 16)
    open var paymentStatus: PaymentStatus = PaymentStatus.UNPAID

    @Enumerated(EnumType.STRING) @Column(name = "payment_method", nullable = false, length = 32)
    open var paymentMethod: PaymentMethod = PaymentMethod.CASH_ON_DELIVERY

    @Column(nullable = false, length = 8) open var currency: String = "ETB"

    @Column(nullable = false, precision = 12, scale = 2) open var subtotal: BigDecimal = BigDecimal.ZERO
    @Column(name = "delivery_fee", nullable = false, precision = 12, scale = 2) open var deliveryFee: BigDecimal = BigDecimal.ZERO
    @Column(name = "discount_amount", nullable = false, precision = 12, scale = 2) open var discountAmount: BigDecimal = BigDecimal.ZERO
    @Column(name = "total_amount", nullable = false, precision = 12, scale = 2) open var totalAmount: BigDecimal = BigDecimal.ZERO
    @Column(name = "amount_collected", nullable = false, precision = 12, scale = 2) open var amountCollected: BigDecimal = BigDecimal.ZERO

    @Column(name = "customer_name", nullable = false) open var customerName: String = ""
    @Column(name = "customer_phone", nullable = false, length = 32) open var customerPhone: String = ""
    @Column(name = "secondary_phone", length = 32) open var secondaryPhone: String? = null

    @Column(nullable = false, length = 120) open var region: String = ""
    @Column(nullable = false, length = 120) open var city: String = ""
    @Column(name = "sub_city", length = 120) open var subCity: String? = null
    @Column(length = 120) open var neighborhood: String? = null
    @Column(name = "address_line", nullable = false) open var addressLine: String = ""
    @Column(name = "delivery_instructions") open var deliveryInstructions: String? = null
    @Column(name = "preferred_delivery_time", length = 120) open var preferredDeliveryTime: String? = null

    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "delivery_zone_id") open var deliveryZone: DeliveryZone? = null

    @Column(name = "courier_name", length = 120) open var courierName: String? = null
    @Column(name = "courier_phone", length = 32) open var courierPhone: String? = null

    @Enumerated(EnumType.STRING) @Column(name = "placement_source", nullable = false, length = 16)
    open var placementSource: PlacementSource = PlacementSource.WEB

    @Column(name = "idempotency_key", unique = true, length = 128) open var idempotencyKey: String? = null

    @Column(name = "cancel_requested_at") open var cancelRequestedAt: OffsetDateTime? = null
    @Column(name = "cancelled_at") open var cancelledAt: OffsetDateTime? = null
    @Column(name = "cancellation_reason", length = 512) open var cancellationReason: String? = null
    @Column(name = "cancelled_by", length = 120) open var cancelledBy: String? = null
    @Column(name = "stock_restored", nullable = false) open var stockRestored: Boolean = false

    @Column(name = "confirmed_at") open var confirmedAt: OffsetDateTime? = null
    @Column(name = "processing_at") open var processingAt: OffsetDateTime? = null
    @Column(name = "out_for_delivery_at") open var outForDeliveryAt: OffsetDateTime? = null
    @Column(name = "delivered_at") open var deliveredAt: OffsetDateTime? = null
    @Column(name = "failed_delivery_count", nullable = false) open var failedDeliveryCount: Int = 0

    @Column(name = "payment_collected_at") open var paymentCollectedAt: OffsetDateTime? = null
    @Column(name = "payment_collected_by", length = 120) open var paymentCollectedBy: String? = null

    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
    @Column(name = "updated_at", nullable = false) open var updatedAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "order_item")
open class OrderItem {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "order_id") open var order: Order? = null

    /** Nullable by design: history must survive product deletion or archival. */
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "product_id") open var product: Product? = null

    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "variant_id") open var variant: ProductVariant? = null

    @Column(name = "product_slug", length = 160) open var productSlug: String? = null
    @Column(name = "product_name_en", nullable = false) open var productNameEn: String = ""
    @Column(name = "size_label", nullable = false, length = 64) open var sizeLabel: String = ""
    @Column(name = "color_name", nullable = false, length = 64) open var colorName: String = ""

    /** Price agreed at purchase time; never re-derived from the live product. */
    @Column(name = "unit_price", nullable = false, precision = 12, scale = 2) open var unitPrice: BigDecimal = BigDecimal.ZERO
    @Column(nullable = false) open var quantity: Int = 0
    @Column(name = "line_total", nullable = false, precision = 12, scale = 2) open var lineTotal: BigDecimal = BigDecimal.ZERO
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "order_status_event")
open class OrderStatusEvent {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "order_id") open var order: Order? = null

    @Enumerated(EnumType.STRING) @Column(name = "from_status", length = 32) open var fromStatus: OrderStatus? = null

    @Enumerated(EnumType.STRING) @Column(name = "to_status", nullable = false, length = 32) open var toStatus: OrderStatus = OrderStatus.PENDING_CONFIRMATION

    @Enumerated(EnumType.STRING) @Column(name = "from_payment_status", length = 16) open var fromPaymentStatus: PaymentStatus? = null

    @Enumerated(EnumType.STRING) @Column(name = "to_payment_status", length = 16) open var toPaymentStatus: PaymentStatus? = null

    open var note: String? = null

    @Enumerated(EnumType.STRING) @Column(name = "actor_type", nullable = false, length = 24) open var actorType: ActorType = ActorType.SYSTEM
    @Column(name = "actor_email", length = 255) open var actorEmail: String? = null
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "inventory_movement")
open class InventoryMovement {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "variant_id") open var variant: ProductVariant? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "product_id") open var product: Product? = null

    @Column(name = "change_qty", nullable = false) open var changeQty: Int = 0
    @Column(name = "balance_after", nullable = false) open var balanceAfter: Int = 0

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 32) open var reason: InventoryReason = InventoryReason.ADMIN_ADJUST
    @Column(name = "reference_type", length = 32) open var referenceType: String? = null
    @Column(name = "reference_id") open var referenceId: Long? = null

    @Enumerated(EnumType.STRING) @Column(name = "actor_type", nullable = false, length = 24) open var actorType: ActorType = ActorType.SYSTEM
    @Column(name = "actor_email", length = 255) open var actorEmail: String? = null
    open var note: String? = null
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "stock_alert_read")
open class StockAlert {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "variant_id") open var variant: ProductVariant? = null

    @Column(name = "alert_type", nullable = false, length = 24) open var alertType: String = "LOW_STOCK"
    @Column(name = "stock_at_notice", nullable = false) open var stockAtNotice: Int = 0
    @Column(nullable = false) open var acknowledged: Boolean = false
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}
