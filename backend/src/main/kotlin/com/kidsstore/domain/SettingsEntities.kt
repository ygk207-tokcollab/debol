package com.kidsstore.domain

import jakarta.persistence.*
import java.math.BigDecimal
import java.time.OffsetDateTime

@Entity
@Table(name = "store_settings")
open class StoreSettings {
@Id open var id: Long? = null

    @Column(name = "store_name_en", nullable = false) open var storeNameEn: String = ""
    @Column(name = "tagline_en") open var taglineEn: String? = null
    @Column(name = "logo_url", length = 1024) open var logoUrl: String? = null

    @Column(name = "contact_phone", nullable = false, length = 32) open var contactPhone: String = ""
    @Column(name = "contact_secondary_phone", length = 32) open var contactSecondaryPhone: String? = null
    @Column(name = "contact_email") open var contactEmail: String? = null
    @Column(name = "contact_telegram_username", length = 64) open var contactTelegramUsername: String? = null

    @Column(nullable = false, length = 8) open var currency: String = "ETB"

    @Column(name = "low_stock_threshold", nullable = false) open var lowStockThreshold: Int = 3
    @Enumerated(EnumType.STRING)
    @Column(name = "allow_customer_cancel_until", nullable = false, length = 32) open var allowCustomerCancelUntil: OrderStatus = OrderStatus.PROCESSING
    @Column(name = "restore_stock_on_cancellation", nullable = false) open var restoreStockOnCancellation: Boolean = true
    @Column(name = "require_admin_confirmation", nullable = false) open var requireAdminConfirmation: Boolean = true
    @Column(name = "free_delivery_over", precision = 12, scale = 2) open var freeDeliveryOver: BigDecimal? = null

    @Column(name = "mini_app_url", length = 1024) open var miniAppUrl: String? = null
    @Column(name = "bot_username", length = 64) open var botUsername: String? = null
    @Column(name = "admin_notify_url", length = 1024) open var adminNotifyUrl: String? = null

    @Column(name = "telegram_enabled", nullable = false) open var telegramEnabled: Boolean = true
    @Column(name = "telegram_admin_contact_phone", length = 32) open var telegramAdminContactPhone: String? = null
    @Column(name = "telegram_chat_id") open var telegramChatId: Long? = null
    @Column(name = "telegram_user_id") open var telegramUserId: Long? = null
    @Column(name = "telegram_setup_complete", nullable = false) open var telegramSetupComplete: Boolean = false

    @Column(name = "updated_at", nullable = false) open var updatedAt: OffsetDateTime = OffsetDateTime.now()

    @Transient
    fun telegramReady(): Boolean = telegramEnabled && telegramSetupComplete && telegramChatId != null
}

@Entity
@Table(name = "delivery_zone")
open class DeliveryZone {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(name = "name_en", nullable = false) open var nameEn: String = ""
    @Column(nullable = false, length = 120) open var region: String = ""
    @Column(nullable = false, length = 120) open var city: String = ""
    @Column(name = "sub_city", length = 120) open var subCity: String? = null
    @Column(nullable = false, precision = 12, scale = 2) open var fee: BigDecimal = BigDecimal.ZERO
    @Column(name = "free_over", precision = 12, scale = 2) open var freeOver: BigDecimal? = null
    @Column(name = "estimated_days", nullable = false) open var estimatedDays: Int = 2
    @Column(nullable = false) open var active: Boolean = true
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "administrator")
open class Administrator {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(nullable = false, unique = true) open var email: String = ""
    @Column(name = "full_name", nullable = false) open var fullName: String = ""
    @Column(length = 32) open var phone: String? = null
    @Column(name = "password_hash", nullable = false) open var passwordHash: String = ""

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 32) open var role: AdminRole = AdminRole.MANAGER

    @Column(nullable = false) open var active: Boolean = true
    @Column(name = "token_version", nullable = false) open var tokenVersion: Int = 0
    @Column(name = "last_login_at") open var lastLoginAt: OffsetDateTime? = null
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "audit_log")
open class AuditLog {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    /** Plain id column: an audit row must survive deletion of the administrator it references. */
    @Column(name = "admin_id") open var adminId: Long? = null

    @Column(name = "actor_email") open var actorEmail: String? = null

    @Enumerated(EnumType.STRING) @Column(name = "actor_type", nullable = false, length = 24) open var actorType: ActorType = ActorType.ADMIN
    @Column(nullable = false, length = 64) open var action: String = ""
    @Column(name = "entity_type", nullable = false, length = 64) open var entityType: String = ""
    @Column(name = "entity_id", length = 64) open var entityId: String? = null
    open var summary: String? = null

    @Column(columnDefinition = "text") open var changes: String? = null
    @Column(name = "ip_address", length = 64) open var ipAddress: String? = null
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "promo_banner")
open class PromoBanner {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(name = "title_en", nullable = false) open var titleEn: String = ""
    @Column(name = "subtitle_en") open var subtitleEn: String? = null
    @Column(name = "image_url", length = 1024) open var imageUrl: String? = null

    @Enumerated(EnumType.STRING) @Column(name = "link_type", nullable = false, length = 24) open var linkType: BannerLinkType = BannerLinkType.NONE
    @Column(name = "link_value") open var linkValue: String? = null

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 24) open var placement: BannerPlacement = BannerPlacement.HERO
    @Column(name = "sort_order", nullable = false) open var sortOrder: Int = 0
    @Column(nullable = false) open var active: Boolean = true
    @Column(name = "starts_at") open var startsAt: OffsetDateTime? = null
    @Column(name = "ends_at") open var endsAt: OffsetDateTime? = null
    @Column(name = "is_sample", nullable = false) open var isSample: Boolean = false
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "collection")
open class ProductCollection {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(nullable = false, unique = true) open var slug: String = ""
    @Column(name = "name_en", nullable = false) open var nameEn: String = ""
    @Column(name = "description_en") open var descriptionEn: String? = null
    @Column(name = "sort_order", nullable = false) open var sortOrder: Int = 0
    @Column(nullable = false) open var active: Boolean = true
    @Column(name = "is_sample", nullable = false) open var isSample: Boolean = false
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "collection_item")
open class CollectionItem {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "collection_id") open var collection: ProductCollection? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "product_id") open var product: Product? = null

    @Column(name = "sort_order", nullable = false) open var sortOrder: Int = 0
}

@Entity
@Table(name = "size_guide")
open class SizeGuide {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @Enumerated(EnumType.STRING) @Column(name = "sizing_system", nullable = false, unique = true, length = 24)
    open var sizingSystem: SizingSystem = SizingSystem.NUMERIC

    @Column(name = "title_en", nullable = false) open var titleEn: String = ""
    @Column(name = "body_en", columnDefinition = "text") open var bodyEn: String? = null
    @Column(name = "updated_at", nullable = false) open var updatedAt: OffsetDateTime = OffsetDateTime.now()
}
