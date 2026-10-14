package com.kidsstore.admin

import com.kidsstore.common.FieldMessage
import com.kidsstore.common.Money
import com.kidsstore.common.badRequest
import com.kidsstore.common.conflict
import com.kidsstore.common.notFound
import com.kidsstore.domain.ActorType
import com.kidsstore.domain.AgeGroup
import com.kidsstore.domain.AgeUnit
import com.kidsstore.domain.Audience
import com.kidsstore.domain.Category
import com.kidsstore.domain.Gender
import com.kidsstore.domain.InventoryMovement
import com.kidsstore.domain.InventoryReason
import com.kidsstore.domain.Product
import com.kidsstore.domain.ProductImage
import com.kidsstore.domain.ProductStatus
import com.kidsstore.domain.ProductVariant
import com.kidsstore.domain.SizingSystem
import com.kidsstore.repo.AgeGroupRepository
import com.kidsstore.repo.CategoryRepository
import com.kidsstore.repo.InventoryMovementRepository
import com.kidsstore.repo.OrderItemRepository
import com.kidsstore.repo.ProductImageRepository
import com.kidsstore.repo.ProductRepository
import com.kidsstore.repo.ProductVariantRepository
import com.kidsstore.security.AdminPrincipal
import com.kidsstore.service.AuditService
import com.kidsstore.service.StoreConfigService
import com.kidsstore.storage.StorageService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.PositiveOrZero
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.time.OffsetDateTime

data class VariantSpec(
    val id: Long? = null,
    @field:NotBlank val sizeLabel: String = "",
    @field:NotBlank val colorName: String = "Default",
    val colorHex: String? = null,
    val sku: String? = null,
    val priceOverride: BigDecimal? = null,
    @field:PositiveOrZero val stock: Int = 0,
    val lowStockThreshold: Int? = null,
    val active: Boolean = true,
)

data class AgeGroupUpsertRequest(
    @field:NotBlank val code: String = "",
    @field:NotBlank val label: String = "",
    val minAge: Int? = null,
    val maxAge: Int? = null,
    val ageUnit: String = "MONTH",
    val sortOrder: Int = 0,
    val active: Boolean = true,
)

data class ProductUpsertRequest(
    @field:NotBlank val nameEn: String = "",
    val descriptionEn: String? = null,
    @field:NotBlank val categorySlug: String = "",
    val audience: String = "CHILD",
    val gender: String = "UNISEX",
    /** Age band codes from /api/v1/age-groups; a product may sit in several. */
    val ageGroups: List<String> = emptyList(),
    val sizingSystem: String = "NUMERIC",
    val basePrice: BigDecimal? = null,
    val salePrice: BigDecimal? = null,
    val featured: Boolean = false,
    val status: String = "DRAFT",
    val variants: List<VariantSpec> = emptyList(),
)

data class VariantAdminDto(
    val id: Long,
    val sizeLabel: String,
    val colorName: String,
    val colorHex: String?,
    val sku: String?,
    val priceOverride: BigDecimal?,
    val effectivePrice: BigDecimal,
    val stock: Int,
    val lowStockThreshold: Int?,
    val lowStock: Boolean,
    val active: Boolean,
)

data class ImageAdminDto(val id: Long, val url: String, val altEn: String?,
                         val sortOrder: Int, val isPrimary: Boolean)

data class ProductAdminDto(
    val id: Long,
    val slug: String,
    val nameEn: String,
    val descriptionEn: String?,
    val categoryId: Long?,
    val categorySlug: String,
    val categoryNameEn: String,
    val audience: Audience,
    val gender: Gender,
    val ageGroups: List<String>,
    val sizingSystem: SizingSystem,
    val basePrice: BigDecimal,
    val salePrice: BigDecimal?,
    val status: ProductStatus,
    val featured: Boolean,
    val isSample: Boolean,
    val totalStock: Int,
    val lowStockVariants: Int,
    val variants: List<VariantAdminDto>,
    val images: List<ImageAdminDto>,
    val createdAt: OffsetDateTime,
    val updatedAt: OffsetDateTime,
    val publishedAt: OffsetDateTime?,
    val archivedAt: OffsetDateTime?,
)

data class StockAdjustRequest(
    @field:NotBlank val mode: String = "DELTA",
    val delta: Int? = null,
    val stock: Int? = null,
    val reason: String = "ADMIN_ADJUST",
    val note: String? = null,
)

data class CategoryUpsertRequest(
    @field:NotBlank val nameEn: String = "",
    val descriptionEn: String? = null,
    val audience: String = "CHILD",
    val imageUrl: String? = null,
    val sortOrder: Int = 0,
    val active: Boolean = true,
    val slug: String? = null,
)

/**
 * Every catalog write records who changed what, and stock may never go negative: adjustments are
 * applied under a row lock and written to the inventory movement history.
 */
@Service
open class AdminCatalogService(
    private val products: ProductRepository,
    private val categories: CategoryRepository,
    private val ageGroups: AgeGroupRepository,
    private val variants: ProductVariantRepository,
    private val images: ProductImageRepository,
    private val movements: InventoryMovementRepository,
    private val orderItems: OrderItemRepository,
    private val storeConfig: StoreConfigService,
    private val audit: AuditService,
    private val storage: StorageService,
) {

    @Transactional(readOnly = true)
    open fun list(query: String?, status: String?, categorySlug: String?, page: Int, pageSize: Int) =
        products.findAll(
            org.springframework.data.jpa.domain.Specification<Product> { root, _, cb ->
                val predicates = mutableListOf<jakarta.persistence.criteria.Predicate>()
                status?.takeIf { it.isNotBlank() }?.let { value ->
                    ProductStatus.entries.firstOrNull { it.name.equals(value, true) }
                        ?.let { predicates += cb.equal(root.get<ProductStatus>("status"), it) }
                }
                categorySlug?.takeIf { it.isNotBlank() }?.let {
                    predicates += cb.equal(root.get<Category>("category").get<String>("slug"), it)
                }
                query?.takeIf { it.isNotBlank() }?.let { term ->
                    val like = "%${term.lowercase()}%"
                    predicates += cb.or(
                        cb.like(cb.lower(root.get("nameEn")), like),
                        cb.like(cb.lower(root.get("slug")), like),
                    )
                }
                cb.and(*predicates.toTypedArray())
            },
            PageRequest.of(page.coerceAtLeast(0), pageSize.coerceIn(1, 100)),
        ).let { page ->
            val bands = products.ageGroupCodesFor(page.content.mapNotNull { it.id }).groupBy({ it.productId }, { it.code })
            mapOf(
            "items" to page.content.map { adminView(it, bands[it.id] ?: emptyList()) },
            "page" to page.number, "pageSize" to page.size,
            "totalPages" to page.totalPages, "totalElements" to page.totalElements,
            ) }

    @Transactional(readOnly = true)
    open fun byId(id: Long): ProductAdminDto = adminView(load(id))

    @Transactional(readOnly = true)
    open fun bySlug(slug: String): ProductAdminDto = adminView(
        products.findBySlug(slug) ?: throw notFound("product_not_found", "Product not found")
    )

    @Transactional
    open fun create(request: ProductUpsertRequest, admin: AdminPrincipal): ProductAdminDto {
        val category = requireCategory(request.categorySlug)
        validatePrices(request)
        val product = products.save(
            Product().apply {
                this.slug = uniqueSlug(request.nameEn)
                this.category = category
                apply(request)
                this.status = parseStatus(request.status)
                this.createdAt = OffsetDateTime.now()
                this.updatedAt = OffsetDateTime.now()
                if (this.status == ProductStatus.PUBLISHED) this.publishedAt = OffsetDateTime.now()
                // A brand new catalogue entry is sample-labelled only when the category itself is.
                this.isSample = category.isSample
            }
        )
        request.variants.forEach { spec -> upsertVariant(product, spec, admin, "Created with the product") }
        audit.record("PRODUCT_CREATED", "PRODUCT", product.id, "${product.nameEn} created",
            admin = admin, actorType = ActorType.ADMIN)
        return adminView(product)
    }

    @Transactional
    open fun update(id: Long, request: ProductUpsertRequest, admin: AdminPrincipal): ProductAdminDto {
        val product = load(id)
        validatePrices(request)
        product.category = requireCategory(request.categorySlug)
        product.apply(request)
        product.updatedAt = OffsetDateTime.now()
        val requested = parseStatus(request.status)
        if (requested != product.status) applyStatus(product, requested)
        products.save(product)
        request.variants.forEach { spec -> upsertVariant(product, spec, admin, "Edited from the admin panel") }
        audit.record("PRODUCT_UPDATED", "PRODUCT", product.id, "${product.nameEn} updated",
            admin = admin, actorType = ActorType.ADMIN)
        return adminView(product)
    }

    @Transactional
    open fun setStatus(id: Long, status: ProductStatus, admin: AdminPrincipal): ProductAdminDto {
        val product = load(id)
        applyStatus(product, status)
        product.updatedAt = OffsetDateTime.now()
        products.save(product)
        audit.record("PRODUCT_STATUS_${status.name}", "PRODUCT", product.id,
            "${product.nameEn} -> $status", admin = admin, actorType = ActorType.ADMIN)
        return adminView(product)
    }

    @Transactional
    open fun setFeatured(id: Long, featured: Boolean, admin: AdminPrincipal): ProductAdminDto {
        val product = load(id)
        product.featured = featured
        product.updatedAt = OffsetDateTime.now()
        products.save(product)
        audit.record(if (featured) "PRODUCT_FEATURED" else "PRODUCT_UNFEATURED", "PRODUCT", product.id,
            "${product.nameEn}", admin = admin, actorType = ActorType.ADMIN)
        return adminView(product)
    }

    /**
     * Historical orders must survive catalogue clean-up, so a product that has ever been purchased is
     * archived rather than deleted.
     */
    @Transactional
    open fun delete(id: Long, admin: AdminPrincipal): Map<String, Any?> {
        val product = load(id)
        if (orderItems.existsByProductId(id)) {
            applyStatus(product, ProductStatus.ARCHIVED)
            product.updatedAt = OffsetDateTime.now()
            products.save(product)
            audit.record("PRODUCT_ARCHIVED", "PRODUCT", id,
                "${product.nameEn} archived instead of deleted (order history kept)",
                admin = admin, actorType = ActorType.ADMIN)
            return mapOf("deleted" to false, "archived" to true,
                "reason" to "This product appears in past orders, so it was archived to protect history")
        }
        images.deleteAllByProductId(id)
        variants.deleteAll(variants.findAllByProductId(id))
        products.delete(product)
        audit.record("PRODUCT_DELETED", "PRODUCT", id, "${product.nameEn} deleted",
            admin = admin, actorType = ActorType.ADMIN)
        return mapOf("deleted" to true, "archived" to false)
    }

    @Transactional
    open fun addImage(productId: Long, url: String, storageKey: String?, altEn: String?,
                      makePrimary: Boolean, admin: AdminPrincipal): ImageAdminDto {
        val product = load(productId)
        val existing = images.findForProduct(productId)
        if (makePrimary) existing.forEach { it.isPrimary = false; images.save(it) }
        val image = images.save(
            ProductImage().apply {
                this.product = product
                this.url = url
                this.storageKey = storageKey
                this.altEn = altEn
                this.sortOrder = existing.size
                this.isPrimary = makePrimary || existing.isEmpty()
                this.createdAt = OffsetDateTime.now()
            }
        )
        audit.record("PRODUCT_IMAGE_ADDED", "PRODUCT", productId, product.nameEn, admin = admin, actorType = ActorType.ADMIN)
        return ImageAdminDto(image.id!!, image.url, image.altEn, image.sortOrder, image.isPrimary)
    }

    @Transactional
    open fun deleteImage(imageId: Long, admin: AdminPrincipal): Map<String, Boolean> {
        val image = images.findById(imageId).orElseThrow { notFound("image_not_found", "Image not found") }
        storage.delete(image.storageKey)
        images.delete(image)
        audit.record("PRODUCT_IMAGE_DELETED", "PRODUCT", image.product?.id, image.url, admin = admin, actorType = ActorType.ADMIN)
        return mapOf("deleted" to true)
    }

    @Transactional
    open fun makePrimaryImage(imageId: Long, admin: AdminPrincipal): Map<String, Any?> {
        val image = images.findById(imageId).orElseThrow { notFound("image_not_found", "Image not found") }
        val productId = image.product?.id ?: throw badRequest("image_orphan", "Image has no product")
        images.findForProduct(productId).forEach { it.isPrimary = it.id == imageId; images.save(it) }
        audit.record("PRODUCT_IMAGE_PRIMARY", "PRODUCT", productId, image.url, admin = admin, actorType = ActorType.ADMIN)
        return mapOf("id" to imageId, "isPrimary" to true)
    }

    @Transactional
    open fun adjustStock(variantId: Long, request: StockAdjustRequest, admin: AdminPrincipal): VariantAdminDto {
        val variant = variants.findByIdForUpdate(variantId) ?: throw notFound("variant_not_found", "Variant not found")
        val before = variant.stock
        val after = when (request.mode.uppercase()) {
            "DELTA" -> before + (request.delta ?: throw badRequest("delta_required", "Enter the amount to add or remove",
                listOf(FieldMessage("delta", "Required"))))
            "SET" -> request.stock ?: throw badRequest("stock_required", "Enter the new stock level",
                listOf(FieldMessage("stock", "Required")))
            else -> throw badRequest("unknown_mode", "Choose either DELTA or SET")
        }
        if (after < 0) throw badRequest("negative_stock", "Stock cannot go below zero (currently $before)",
            listOf(FieldMessage("stock", "Stock cannot be negative")))
        variant.stock = after
        variant.updatedAt = OffsetDateTime.now()
        variants.save(variant)
        movements.save(
            InventoryMovement().apply {
                this.variant = variant
                this.product = variant.product
                this.changeQty = after - before
                this.balanceAfter = after
                this.reason = InventoryReason.entries.firstOrNull { it.name.equals(request.reason, true) }
                    ?: if (request.mode.uppercase() == "SET") InventoryReason.STOCK_SET else InventoryReason.ADMIN_ADJUST
                this.referenceType = "ADMIN"
                this.referenceId = admin.id
                this.actorType = ActorType.ADMIN
                this.actorEmail = admin.actorEmail
                this.note = request.note
                this.createdAt = OffsetDateTime.now()
            }
        )
        audit.record("STOCK_ADJUSTED", "VARIANT", variant.id,
            "${variant.product?.nameEn} ${variant.sizeLabel}/${variant.colorName}: $before -> $after",
            admin = admin, actorType = ActorType.ADMIN)
        return variantDto(variant)
    }

    @Transactional
    open fun setVariantThreshold(variantId: Long, threshold: Int?, active: Boolean?, admin: AdminPrincipal): VariantAdminDto {
        val variant = variants.findByIdForUpdate(variantId) ?: throw notFound("variant_not_found", "Variant not found")
        threshold?.let {
            if (it < 0) throw badRequest("negative_threshold", "Threshold cannot be negative")
            variant.lowStockThreshold = it
        }
        active?.let { variant.active = it }
        variant.updatedAt = OffsetDateTime.now()
        variants.save(variant)
        audit.record("VARIANT_UPDATED", "VARIANT", variant.id,
            "${variant.product?.nameEn} ${variant.sizeLabel}/${variant.colorName}", admin = admin, actorType = ActorType.ADMIN)
        return variantDto(variant)
    }

    @Transactional(readOnly = true)
    open fun inventory(filter: String?): List<Map<String, Any?>> {
        val threshold = storeConfig.settings().lowStockThreshold
        return variants.findAllActiveWithProduct().mapNotNull { variant ->
            val product = variant.product ?: return@mapNotNull null
            val low = variant.isLowStock(threshold)
            val out = variant.stock == 0
            when (filter?.lowercase()) {
                "low" -> if (!low) return@mapNotNull null
                "out" -> if (!out) return@mapNotNull null
                "low_or_out" -> if (!low && !out) return@mapNotNull null
            }
            mapOf(
                "variantId" to variant.id,
                "productId" to product.id,
                "productSlug" to product.slug,
                "nameEn" to product.nameEn,
                "category" to product.category?.nameEn,
                "sizeLabel" to variant.sizeLabel,
                "colorName" to variant.colorName,
                "sku" to variant.sku,
                "stock" to variant.stock,
                "threshold" to variant.lowStockThresholdOrDefault(threshold),
                "lowStock" to low,
                "outOfStock" to out,
                "status" to product.status.name,
            )
        }
    }

    @Transactional(readOnly = true)
    open fun movementHistory(variantId: Long?, page: Int, size: Int) =
        (if (variantId != null) movements.findForVariant(variantId, PageRequest.of(page, size))
            else movements.findRecent(PageRequest.of(page, size)))
            .map {
                mapOf(
                    "id" to it.id, "variantId" to it.variant?.id, "product" to it.product?.nameEn,
                    "sizeLabel" to it.variant?.sizeLabel, "colorName" to it.variant?.colorName,
                    "changeQty" to it.changeQty, "balanceAfter" to it.balanceAfter,
                    "reason" to it.reason.name, "actorType" to it.actorType.name, "actor" to it.actorEmail,
                    "note" to it.note, "at" to it.createdAt,
                )
            }

    @Transactional(readOnly = true)
    open fun listAgeGroups() = ageGroups.findAllOrdered().map { ageGroupMap(it) }

    /** Bands are admin data, not a frontend constant: codes stay stable so products never lose a link. */
    @Transactional
    open fun saveAgeGroup(id: Long?, request: AgeGroupUpsertRequest, admin: AdminPrincipal): Map<String, Any?> {
        val code = request.code.trim().uppercase().replace(Regex("[^A-Z0-9]+"), "_").trim('_')
        if (code.isBlank()) throw badRequest("invalid_code", "An age group needs a code",
            listOf(FieldMessage("code", "Required")))
        val unit = AgeUnit.entries.firstOrNull { it.name.equals(request.ageUnit, true) }
            ?: throw badRequest("invalid_age_unit", "ageUnit must be MONTH or YEAR",
                listOf(FieldMessage("ageUnit", "Must be MONTH or YEAR")))
        if (request.minAge != null && request.maxAge != null && request.maxAge < request.minAge) {
            throw badRequest("invalid_age_range", "The upper age must not be below the lower age",
                listOf(FieldMessage("maxAge", "Must be at least minAge")))
        }
        val group = id?.let { ageGroups.findById(it).orElseThrow { notFound("age_group_not_found", "Age group not found") } }
            ?: AgeGroup()
        val clash = ageGroups.findByCode(code)
        if (clash != null && clash.id != group.id) {
            throw conflict("age_group_code_taken", "Another age group already uses the code $code",
                listOf(FieldMessage("code", "Already in use")))
        }
        group.code = code
        group.label = request.label.trim()
        group.minAge = request.minAge
        group.maxAge = request.maxAge
        group.ageUnit = unit
        group.sortOrder = request.sortOrder
        group.active = request.active
        val saved = ageGroups.save(group)
        audit.record(if (id == null) "AGE_GROUP_CREATED" else "AGE_GROUP_UPDATED", "AGE_GROUP", saved.id,
            "${saved.code} (${saved.label})", admin = admin, actorType = ActorType.ADMIN)
        return ageGroupMap(saved)
    }

    private fun ageGroupMap(group: AgeGroup) = mapOf(
        "id" to group.id, "code" to group.code, "label" to group.label,
        "minAge" to group.minAge, "maxAge" to group.maxAge, "ageUnit" to group.ageUnit.name,
        "sortOrder" to group.sortOrder, "active" to group.active,
    )

    @Transactional(readOnly = true)
    open fun listCategories() = categories.findAllActive().map {
        mapOf("id" to it.id, "slug" to it.slug, "nameEn" to it.nameEn,
            "descriptionEn" to it.descriptionEn,
            "audience" to it.audience.name, "imageUrl" to it.imageUrl,
            "sortOrder" to it.sortOrder, "active" to it.active, "isSample" to it.isSample)
    }

    @Transactional
    open fun saveCategory(id: Long?, request: CategoryUpsertRequest, admin: AdminPrincipal): Map<String, Any?> {
        val category = id?.let { categories.findById(it).orElseThrow { notFound("category_not_found", "Category not found") } }
            ?: Category()
        category.nameEn = request.nameEn.trim()
        category.descriptionEn = request.descriptionEn?.trim()
        category.audience = Audience.entries.firstOrNull { it.name.equals(request.audience, true) } ?: Audience.CHILD
        category.imageUrl = request.imageUrl?.trim()
        category.sortOrder = request.sortOrder
        category.active = request.active
        category.slug = (request.slug?.takeIf { it.isNotBlank() } ?: category.slug).ifBlank {
            slugify(request.nameEn)
        }
        val saved = categories.save(category)
        audit.record(if (id == null) "CATEGORY_CREATED" else "CATEGORY_UPDATED", "CATEGORY", saved.id,
            saved.nameEn, admin = admin, actorType = ActorType.ADMIN)
        return mapOf("id" to saved.id, "slug" to saved.slug, "nameEn" to saved.nameEn)
    }

    private fun Product.apply(request: ProductUpsertRequest) {
        nameEn = request.nameEn.trim()
        descriptionEn = request.descriptionEn?.trim()
        audience = Audience.entries.firstOrNull { it.name.equals(request.audience, true) } ?: Audience.CHILD
        gender = Gender.entries.firstOrNull { it.name.equals(request.gender, true) } ?: Gender.UNISEX
        // Rewrite in place: swapping the collection outright would leave Hibernate unable to work
        // out which join rows to delete.
        ageGroups.clear()
        ageGroups += resolveAgeGroups(request.ageGroups)
        sizingSystem = SizingSystem.entries.firstOrNull { it.name.equals(request.sizingSystem, true) }
            ?: SizingSystem.NUMERIC
        request.basePrice?.let { basePrice = Money.parse(it) }
        salePrice = request.salePrice?.let { Money.parse(it) }
        featured = request.featured
    }

    private fun upsertVariant(product: Product, spec: VariantSpec, admin: AdminPrincipal, note: String) {
        val existing = spec.id?.let { variants.findById(it).orElse(null) }
        val variant = existing ?: ProductVariant().apply {
            this.product = product
            this.createdAt = OffsetDateTime.now()
        }
        variant.sizeLabel = spec.sizeLabel.trim()
        variant.colorName = spec.colorName.trim().ifBlank { "Default" }
        variant.colorHex = spec.colorHex?.trim()
        variant.sku = spec.sku?.trim()?.ifBlank { null }
        variant.priceOverride = spec.priceOverride?.let { Money.parse(it) }
        variant.lowStockThreshold = spec.lowStockThreshold
        variant.active = spec.active
        if (variant.stock != spec.stock) {
            if (spec.stock < 0) throw badRequest("negative_stock", "Stock cannot be negative",
                listOf(FieldMessage("stock", "Stock cannot be negative")))
            val before = variant.stock
            variant.stock = spec.stock
            variant.updatedAt = OffsetDateTime.now()
            variants.save(variant)
            movements.save(
                InventoryMovement().apply {
                    this.variant = variant
                    this.product = variant.product ?: product
                    this.changeQty = spec.stock - before
                    this.balanceAfter = spec.stock
                    this.reason = InventoryReason.STOCK_SET
                    this.referenceType = "ADMIN"
                    this.referenceId = admin.id
                    this.actorType = ActorType.ADMIN
                    this.actorEmail = admin.actorEmail
                    this.note = note
                    this.createdAt = OffsetDateTime.now()
                }
            )
        } else {
            variants.save(variant)
        }
    }

    private fun validatePrices(request: ProductUpsertRequest) {
        val price = request.basePrice ?: throw badRequest("price_required", "A price in ETB is required",
            listOf(FieldMessage("basePrice", "Required")))
        if (price <= BigDecimal.ZERO) throw badRequest("price_invalid", "Price must be greater than zero",
            listOf(FieldMessage("basePrice", "Must be greater than zero")))
        request.salePrice?.let { sale ->
            if (sale <= BigDecimal.ZERO) throw badRequest("sale_price_invalid", "Sale price must be greater than zero",
                listOf(FieldMessage("salePrice", "Must be greater than zero")))
            if (sale >= price) throw badRequest("sale_price_not_lower",
                "Sale price must be below the regular price of ${Money.format(price, storeConfig.settings().currency)}",
                listOf(FieldMessage("salePrice", "Must be lower than the regular price")))
        }
    }

    private fun requireCategory(slug: String): Category =
        categories.findBySlug(slug) ?: throw badRequest("category_not_found",
            "Pick an existing category", listOf(FieldMessage("categorySlug", "Unknown category")))

    private fun parseStatus(raw: String): ProductStatus =
        ProductStatus.entries.firstOrNull { it.name.equals(raw, true) }
            ?: throw badRequest("invalid_status", "Status must be DRAFT, PUBLISHED or ARCHIVED")

    private fun applyStatus(product: Product, status: ProductStatus) {
        val now = OffsetDateTime.now()
        product.status = status
        when (status) {
            ProductStatus.PUBLISHED -> {
                if (product.publishedAt == null) product.publishedAt = now
                product.archivedAt = null
            }
            ProductStatus.ARCHIVED -> product.archivedAt = now
            ProductStatus.DRAFT -> product.archivedAt = null
        }
    }

    private fun load(id: Long): Product = products.findById(id).orElseThrow {
        notFound("product_not_found", "Product not found")
    }

    private fun uniqueSlug(name: String): String {
        val base = slugify(name)
        var candidate = base
        var suffix = 2
        while (products.findBySlug(candidate) != null) candidate = "$base-$suffix".also { suffix += 1 }
        return candidate
    }

    private fun slugify(value: String): String =
        value.lowercase().trim().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(60).ifBlank { "product" }

    private fun resolveAgeGroups(codes: List<String>): List<AgeGroup> {
        val wanted = codes.map { it.trim().uppercase() }.filter { it.isNotBlank() }.distinct()
        if (wanted.isEmpty()) return emptyList()
        val found = ageGroups.findAllByCodeIn(wanted)
        val unknown = wanted - found.map { it.code }.toSet()
        if (unknown.isNotEmpty()) {
            throw badRequest("invalid_age_group", "Unknown age group: ${unknown.sorted().joinToString(", ")}",
                listOf(FieldMessage("ageGroups", "Choose bands listed by /api/v1/age-groups")))
        }
        return found
    }

    private fun adminView(product: Product, bandCodes: List<String>? = null): ProductAdminDto {
        val threshold = storeConfig.settings().lowStockThreshold
        val variantList = variants.findActiveForProduct(product.id!!)
        return ProductAdminDto(
            id = product.id!!,
            slug = product.slug,
            nameEn = product.nameEn,
            descriptionEn = product.descriptionEn,
            categoryId = product.category?.id,
            categorySlug = product.category?.slug ?: "",
            categoryNameEn = product.category?.nameEn ?: "",
            audience = product.audience,
            gender = product.gender,
            ageGroups = (bandCodes ?: product.ageGroups.map { it.code }).sorted(),
            sizingSystem = product.sizingSystem,
            basePrice = Money.parse(product.basePrice),
            salePrice = product.salePrice?.let { Money.parse(it) },
            status = product.status,
            featured = product.featured,
            isSample = product.isSample,
            totalStock = variantList.sumOf { it.stock },
            lowStockVariants = variantList.count { it.isLowStock(threshold) },
            variants = variantList.map { variantDto(it) },
            images = images.findForProduct(product.id!!).map {
                ImageAdminDto(it.id!!, it.url, it.altEn, it.sortOrder, it.isPrimary)
            },
            createdAt = product.createdAt,
            updatedAt = product.updatedAt,
            publishedAt = product.publishedAt,
            archivedAt = product.archivedAt,
        )
    }

    private fun variantDto(variant: ProductVariant): VariantAdminDto {
        val product = variant.product
        val threshold = storeConfig.settings().lowStockThreshold
        return VariantAdminDto(
            id = variant.id!!,
            sizeLabel = variant.sizeLabel,
            colorName = variant.colorName,
            colorHex = variant.colorHex,
            sku = variant.sku,
            priceOverride = variant.priceOverride?.let { Money.parse(it) },
            effectivePrice = Money.parse(variant.priceOverride ?: product?.baseEffectivePrice() ?: BigDecimal.ZERO),
            stock = variant.stock,
            lowStockThreshold = variant.lowStockThreshold,
            lowStock = variant.isLowStock(threshold),
            active = variant.active,
        )
    }
}
