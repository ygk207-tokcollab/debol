package com.kidsstore.domain

import jakarta.persistence.*
import java.math.BigDecimal
import java.time.OffsetDateTime

/**
 * Entities use mutable body properties (not data classes) so that Hibernate gets a real
 * no-arg constructor and an open class for proxies without extra compiler plugins.
 *
 * AgeGroup is a structured age band: codes are the stable identifiers the API and the admin
 * panel filter on, while min/max plus the unit describe the band numerically so that the
 * display label can change without breaking a stored product link.
 */
@Entity
@Table(name = "age_group")
open class AgeGroup {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(nullable = false, unique = true, length = 32) open var code: String = ""
    @Column(nullable = false, length = 80) open var label: String = ""
    @Column(name = "min_age") open var minAge: Int? = null
    @Column(name = "max_age") open var maxAge: Int? = null

    @Enumerated(EnumType.STRING) @Column(name = "age_unit", nullable = false, length = 8) open var ageUnit: AgeUnit = AgeUnit.MONTH

    @Column(name = "sort_order", nullable = false) open var sortOrder: Int = 0
    @Column(nullable = false) open var active: Boolean = true
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "category")
open class Category {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(nullable = false, unique = true) open var slug: String = ""
    @Column(name = "name_en", nullable = false) open var nameEn: String = ""
    @Column(name = "description_en") open var descriptionEn: String? = null

    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "parent_id") open var parent: Category? = null

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) open var audience: Audience = Audience.CHILD
    @Column(name = "image_url", length = 1024) open var imageUrl: String? = null
    @Column(name = "sort_order", nullable = false) open var sortOrder: Int = 0
    @Column(nullable = false) open var active: Boolean = true
    @Column(name = "is_sample", nullable = false) open var isSample: Boolean = false
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "product")
open class Product {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null
    @Column(nullable = false, unique = true) open var slug: String = ""

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "category_id") open var category: Category? = null

    @Column(name = "name_en", nullable = false) open var nameEn: String = ""
    @Column(name = "description_en", columnDefinition = "text") open var descriptionEn: String? = null

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) open var audience: Audience = Audience.CHILD

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) open var gender: Gender = Gender.UNISEX

    @Enumerated(EnumType.STRING) @Column(name = "sizing_system", nullable = false, length = 24)
    open var sizingSystem: SizingSystem = SizingSystem.NUMERIC

    @Column(name = "base_price", nullable = false, precision = 12, scale = 2) open var basePrice: BigDecimal = BigDecimal.ZERO
    @Column(name = "sale_price", precision = 12, scale = 2) open var salePrice: BigDecimal? = null

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) open var status: ProductStatus = ProductStatus.DRAFT
    @Column(nullable = false) open var featured: Boolean = false
    @Column(name = "is_sample", nullable = false) open var isSample: Boolean = false
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
    @Column(name = "updated_at", nullable = false) open var updatedAt: OffsetDateTime = OffsetDateTime.now()
    @Column(name = "published_at") open var publishedAt: OffsetDateTime? = null
    @Column(name = "archived_at") open var archivedAt: OffsetDateTime? = null

    /** Read-only mapping used for joins and stock totals; variant writes go through the variant repository. */
    @OneToMany(mappedBy = "product", fetch = FetchType.LAZY)
    open var variants: MutableList<ProductVariant> = mutableListOf()

    /** A product can belong to several age bands; the join rows are rewritten by the admin editor. */
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(
        name = "product_age_group",
        joinColumns = [JoinColumn(name = "product_id")],
        inverseJoinColumns = [JoinColumn(name = "age_group_id")],
    )
    open var ageGroups: MutableSet<AgeGroup> = linkedSetOf()

    @Transient
    fun baseEffectivePrice(): BigDecimal = salePrice ?: basePrice

    @Transient
    fun onSale(): Boolean {
        val sale = salePrice ?: return false
        return sale < basePrice
    }
}

@Entity
@Table(name = "product_image")
open class ProductImage {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "product_id") open var product: Product? = null

    @Column(nullable = false, length = 1024) open var url: String = ""
    @Column(name = "storage_key", length = 512) open var storageKey: String? = null
    @Column(name = "alt_en", length = 255) open var altEn: String? = null
    @Column(name = "sort_order", nullable = false) open var sortOrder: Int = 0
    @Column(name = "is_primary", nullable = false) open var isPrimary: Boolean = false
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
}

@Entity
@Table(name = "product_variant")
open class ProductVariant {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) open var id: Long? = null

    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "product_id") open var product: Product? = null

    @Column(name = "size_label", nullable = false, length = 64) open var sizeLabel: String = ""
    @Column(name = "color_name", nullable = false, length = 64) open var colorName: String = "Default"
    @Column(name = "color_hex", length = 9) open var colorHex: String? = null
    @Column(unique = true, length = 120) open var sku: String? = null
    @Column(name = "price_override", precision = 12, scale = 2) open var priceOverride: BigDecimal? = null
    @Column(nullable = false) open var stock: Int = 0
    @Column(name = "low_stock_threshold") open var lowStockThreshold: Int? = null
    @Column(nullable = false) open var active: Boolean = true
    @Column(name = "created_at", nullable = false) open var createdAt: OffsetDateTime = OffsetDateTime.now()
    @Column(name = "updated_at", nullable = false) open var updatedAt: OffsetDateTime = OffsetDateTime.now()

    fun lowStockThresholdOrDefault(storeDefault: Int): Int = lowStockThreshold ?: storeDefault

    @Transient
    fun isLowStock(storeDefault: Int): Boolean = active && stock in 1..lowStockThresholdOrDefault(storeDefault)
}
