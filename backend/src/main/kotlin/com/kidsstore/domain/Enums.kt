package com.kidsstore.domain

enum class AdminRole { OWNER, MANAGER, DELIVERY_STAFF }

enum class ProductStatus { DRAFT, PUBLISHED, ARCHIVED }

enum class Audience { CHILD, ADULT, FAMILY }

enum class Gender { BOY, GIRL, UNISEX, WOMAN, MAN }

enum class SizingSystem { AGE, NUMERIC, SHOE, LETTER, ONE_SIZE }

/** The unit age_group.min_age / max_age are counted in. */
enum class AgeUnit { MONTH, YEAR }

enum class OrderStatus {
    PENDING_CONFIRMATION,
    CONFIRMED,
    PROCESSING,
    OUT_FOR_DELIVERY,
    DELIVERED,
    FAILED_DELIVERY,
    CANCELLED;

    val isTerminal: Boolean get() = this == DELIVERED || this == CANCELLED
}

enum class PaymentStatus { UNPAID, PAID, REFUNDED }

enum class PaymentMethod { CASH_ON_DELIVERY }

enum class PlacementSource { TELEGRAM, WEB }

enum class NotificationEventType {
    NEW_ORDER,
    CANCEL_REQUEST,
    ORDER_CANCELLED,
    FAILED_DELIVERY,
    ORDER_DELIVERED,
    CASH_COLLECTED,
    LOW_STOCK,
    OUT_OF_STOCK,
    ORDER_CONFIRMED,
    TEST
}

enum class OutboxStatus { PENDING, SENDING, SENT, RETRY, DEAD_LETTER, CANCELLED }

enum class InventoryReason { ORDER_RESERVED, CANCEL_RESTORED, ADMIN_ADJUST, STOCK_SET, INITIAL_STOCK }

enum class ActorType { ADMIN, CUSTOMER, SYSTEM, TELEGRAM_BUTTON }

enum class SessionSource { TELEGRAM, WEB_PHONE }

enum class BannerPlacement { HERO, HOME, GRID }

enum class BannerLinkType { CATEGORY, PRODUCT, COLLECTION, NONE }

enum class PairingCodeStatus { PENDING, CONSUMED, EXPIRED, REJECTED }

enum class CustomerOrderEventType { ORDER_CREATED, STATUS_CHANGED, PAYMENT_CHANGED, CANCEL_REQUESTED, CANCELLED }
