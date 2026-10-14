package com.kidsstore.domain

import jakarta.persistence.*
import java.time.OffsetDateTime

@Entity
@Table(name = "customer")
open class Customer {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(name = "full_name", nullable = false) open var fullName: String = ""
    @Column(nullable = false, unique = true, length = 32) open var phone: String = ""
    @Column(name = "secondary_phone", length = 32) open var secondaryPhone: String? = null
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
    @Column(name = "last_order_at") open var lastOrderAt: OffsetDateTime? = null
}

@Entity
@Table(name = "telegram_account")
open class TelegramAccount {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "customer_id") open var customer: Customer? = null

    @Column(name = "telegram_user_id", nullable = false, unique = true) open var telegramUserId: Long = 0
    @Column(name = "telegram_username", length = 64) open var telegramUsername: String? = null
    @Column(name = "first_name", length = 120) open var firstName: String? = null
    @Column(name = "last_name", length = 120) open var lastName: String? = null
    @Column(name = "language_code", length = 8) open var languageCode: String? = null
    @Column(name = "photo_url", length = 1024) open var photoUrl: String? = null
    @Column(name = "verified_at", nullable = false) open var verifiedAt: OffsetDateTime = OffsetDateTime.now()
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "customer_address")
open class CustomerAddress {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "customer_id") open var customer: Customer? = null

    @Column(length = 64) open var label: String? = null
    @Column(nullable = false, length = 120) open var region: String = ""
    @Column(nullable = false, length = 120) open var city: String = ""
    @Column(name = "sub_city", length = 120) open var subCity: String? = null
    @Column(length = 120) open var neighborhood: String? = null
    @Column(name = "address_line", nullable = false) open var addressLine: String = ""
    open var instructions: String? = null
    @Column(name = "is_default", nullable = false) open var isDefault: Boolean = false
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "customer_session")
open class CustomerSession {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "customer_id") open var customer: Customer? = null

    @Column(name = "token_hash", nullable = false, unique = true, length = 128) open var tokenHash: String = ""

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) open var source: SessionSource = SessionSource.WEB_PHONE

    @Column(name = "telegram_user_id") open var telegramUserId: Long? = null
    @Column(name = "expires_at", nullable = false) open var expiresAt: OffsetDateTime = OffsetDateTime.now()
    @Column(nullable = false) open var revoked: Boolean = false
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "cart")
open class Cart {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(name = "cart_key", nullable = false, unique = true, length = 64) open var cartKey: String = ""

    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "customer_id") open var customer: Customer? = null

    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
    @Column(name = "updated_at", nullable = false) open var updatedAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "cart_item")
open class CartItem {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "cart_id") open var cart: Cart? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "variant_id") open var variant: ProductVariant? = null

    @Column(nullable = false) open var quantity: Int = 1
    @Column(name = "added_at", nullable = false) open var addedAt: OffsetDateTime = OffsetDateTime.now()
}
