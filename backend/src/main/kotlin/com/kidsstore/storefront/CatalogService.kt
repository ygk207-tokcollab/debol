package com.kidsstore.storefront

import com.kidsstore.common.Money
import com.kidsstore.common.badRequest
import com.kidsstore.common.notFound
import com.kidsstore.domain.*
import com.kidsstore.repo.*
import com.kidsstore.service.StoreConfigService
import jakarta.persistence.criteria.Predicate
import jakarta.persistence.criteria.Root
import jakarta.persistence.criteria.Subquery
import org.springframework.data.domain.Page
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.data.jpa.domain.Specification
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.time.OffsetDateTime

data class AgeGroupDto(val code: String, val label: String, val minAge: Int?, val maxAge: Int?, val ageUnit: String)

/** A product tagged ALL_AGES appears under every band, so open-ended items stay reachable. */
private const val ALL_AGES_CODE = "ALL_AGES"

data class CategoryDto(val slug: String, val nameEn: String,
                       val descriptionEn: String?,
                       val audience: Audience, val imageUrl: String?, val productCount: Long)

data class VariantDto(val id: Long, val sizeLabel: String, val colorName: String, val colorHex: String?,
                      val sku: String?, val price: BigDecimal, val stock: Int, val available: Boolean)

data class ImageDto(val url: String, val altEn: String?)

data class ProductSummaryDto(
    val slug: String, val nameEn: String,
    val categorySlug: String, val categoryNameEn: String,
    val price: BigDecimal, val salePrice: BigDecimal?, val currency: String,
    val imageUrl: String?, val totalStock: Int, val featured: Boolean,
    val sizingSystem: SizingSystem, val audience: Audience, val gender: Gender,
    val ageGroups: List<String>, val createdAt: OffsetDateTime,
)

data class SizeGuideDto(val titleEn: String, val bodyEn: String?)

data class ProductDetailDto(
    val slug: String, val nameEn: String,
    val descriptionEn: String?,
    val categorySlug: String, val categoryNameEn: String,
    val price: BigDecimal, val salePrice: BigDecimal?, val currency: String,
    val images: List<ImageDto>, val variants: List<VariantDto>,
    val sizingSystem: SizingSystem, val audience: Audience, val gender: Gender,
    val ageGroups: List<String>, val featured: Boolean, val isSample: Boolean, val status: ProductStatus,
    val sizeGuide: SizeGuideDto?, val related: List<ProductSummaryDto>,
)

@Service
open class CatalogService(
    private val products: ProductRepository,
    private val categories: CategoryRepository,
    private val ageGroups: AgeGroupRepository,
    private val variants: ProductVariantRepository,
    private val images: ProductImageRepository,
    private val collections: CollectionRepository,
    private val collectionItems: CollectionItemRepository,
    private val banners: PromoBannerRepository,
    private val sizeGuides: SizeGuideRepository,
    private val deliveryZones: DeliveryZoneRepository,
    private val storeConfig: StoreConfigService,
) {

    data class CatalogPage(val items: List<ProductSummaryDto>, val page: Int, val pageSize: Int,
                           val totalPages: Int, val totalElements: Long)

    @Transactional(readOnly = true)
    open fun listProducts(
        categorySlug: String?, audience: String?, search: String?, gender: String?, size: String?,
        ageGroup: String?, minPrice: BigDecimal?, maxPrice: BigDecimal?, inStockOnly: Boolean,
        featured: Boolean?, sort: String?, page: Int, pageSizeParam: Int,
    ): CatalogPage {
        val pageSize = pageSizeParam.coerceIn(1, 60)
        val wantedBand = ageGroup?.takeIf { it.isNotBlank() }?.let { raw ->
            val code = raw.trim().uppercase()
            val band = ageGroups.findByCode(code)
            if (band == null || !band.active) {
                throw badRequest("invalid_age_group", "Unknown age group: use the codes listed by /api/v1/age-groups")
            }
            code
        }
        val spec = Specification<Product> { root, query, cb ->
            val predicates = mutableListOf<Predicate>()
            predicates += cb.equal(root.get<ProductStatus>("status"), ProductStatus.PUBLISHED)

            categorySlug?.takeIf { it.isNotBlank() }?.let { slug ->
                predicates += cb.equal(root.get<Category>("category").get<String>("slug"), slug)
            }
            audience?.takeIf { it.isNotBlank() }?.let { value ->
                Audience.entries.firstOrNull { it.name.equals(value, true) }?.let { wanted ->
                    predicates += cb.or(
                        cb.equal(root.get<Audience>("audience"), wanted),
                        cb.equal(root.get<Audience>("audience"), Audience.FAMILY),
                    )
                }
            }
            gender?.takeIf { it.isNotBlank() }?.let { value ->
                Gender.entries.firstOrNull { it.name.equals(value, true) }
                    ?.let { predicates += cb.equal(root.get<Gender>("gender"), it) }
            }
            search?.takeIf { it.isNotBlank() }?.let { term ->
                val like = "%${term.lowercase()}%"
                predicates += cb.or(
                    cb.like(cb.lower(root.get("nameEn")), like),
                    cb.like(cb.lower(root.get("descriptionEn")), like),
                )
            }
            wantedBand?.let { code ->
                val band = root.join<Product, AgeGroup>("ageGroups", jakarta.persistence.criteria.JoinType.INNER)
                predicates += cb.or(cb.equal(band.get<String>("code"), code), cb.equal(band.get<String>("code"), ALL_AGES_CODE))
                query?.distinct(true)
            }
            size?.takeIf { it.isNotBlank() }?.let { wanted ->
                val variantJoin = root.join<Product, ProductVariant>("variants", jakarta.persistence.criteria.JoinType.INNER)
                predicates += cb.equal(cb.lower(variantJoin.get<String>("sizeLabel")), wanted.lowercase())
                predicates += cb.equal(variantJoin.get<Boolean>("active"), true)
                query?.distinct(true)
            }
            if (inStockOnly) {
                val stockJoin = root.join<Product, ProductVariant>("variants", jakarta.persistence.criteria.JoinType.INNER)
                predicates += cb.greaterThan(stockJoin.get<Int>("stock"), 0)
                predicates += cb.equal(stockJoin.get<Boolean>("active"), true)
                query?.distinct(true)
            }
            minPrice?.let { predicates += cb.greaterThanOrEqualTo(root.get("basePrice"), it) }
            maxPrice?.let { predicates += cb.lessThanOrEqualTo(root.get("basePrice"), it) }
            featured?.let { predicates += cb.equal(root.get<Boolean>("featured"), it) }
            cb.and(*predicates.toTypedArray())
        }

        val direction = if (sort == "price_asc") Sort.Direction.ASC else Sort.Direction.DESC
        val property = if (sort == "price_asc" || sort == "price_desc") "basePrice" else "createdAt"
        val result: Page<Product> = products.findAll(spec, PageRequest.of(page.coerceAtLeast(0), pageSize, Sort.by(direction, property)))
        return CatalogPage(summarize(result.content), result.number, result.size, result.totalPages, result.totalElements)
    }

    @Transactional(readOnly = true)
    open fun productBySlug(slug: String): ProductDetailDto {
        val product = products.findBySlug(slug) ?: throw notFound("product_not_found", "That product is not available")
        val variantList = variants.findActiveForProduct(product.id!!)
        val imageList = images.findForProduct(product.id!!)
        val guide = sizeGuides.findBySizingSystem(product.sizingSystem)
            ?.let { SizeGuideDto(it.titleEn, it.bodyEn) }
        val related = products.findAll(
            Specification { root, _, cb ->
                cb.and(
                    cb.equal(root.get<ProductStatus>("status"), ProductStatus.PUBLISHED),
                    cb.equal(root.get<Category>("category").get<Long>("id"), product.category?.id),
                    cb.notEqual(root.get<String>("slug"), product.slug),
                )
            },
            PageRequest.of(0, 6),
        )
        return ProductDetailDto(
            slug = product.slug,
            nameEn = product.nameEn,
            descriptionEn = product.descriptionEn,
            categorySlug = product.category?.slug ?: "",
            categoryNameEn = product.category?.nameEn ?: "",
            price = Money.parse(product.basePrice),
            salePrice = product.salePrice?.let { Money.parse(it) },
            currency = storeConfig.settings().currency,
            images = imageList.map { ImageDto(it.url, it.altEn) },
            variants = variantList.map {
                VariantDto(
                    id = it.id!!,
                    sizeLabel = it.sizeLabel,
                    colorName = it.colorName,
                    colorHex = it.colorHex,
                    sku = it.sku,
                    price = Money.parse(it.priceOverride ?: product.baseEffectivePrice()),
                    stock = it.stock,
                    available = it.stock >= 1,
                )
            },
            sizingSystem = product.sizingSystem,
            audience = product.audience,
            gender = product.gender,
            ageGroups = product.ageGroups.map { it.code }.sorted(),
            featured = product.featured,
            isSample = product.isSample,
            status = product.status,
            sizeGuide = guide,
            related = summarize(related.content),
        )
    }

    @Transactional(readOnly = true)
    open fun ageGroupList(): List<AgeGroupDto> = ageGroups.findAllActive().map {
        AgeGroupDto(it.code, it.label, it.minAge, it.maxAge, it.ageUnit.name)
    }

    @Transactional(readOnly = true)
    open fun categories(): List<CategoryDto> {
        val published = products.findAll(
            Specification { root, _, cb -> cb.equal(root.get<ProductStatus>("status"), ProductStatus.PUBLISHED) },
            PageRequest.of(0, 10_000),
        ).content
        return categories.findAllActive().map { category ->
            CategoryDto(
                slug = category.slug,
                nameEn = category.nameEn,
                descriptionEn = category.descriptionEn,
                audience = category.audience,
                imageUrl = category.imageUrl,
                productCount = published.count { it.category?.id == category.id }.toLong(),
            )
        }
    }

    @Transactional(readOnly = true)
    open fun home(): Map<String, Any?> {
        val settings = storeConfig.settings()
        val featured = products.findAll(
            Specification { root, _, cb ->
                cb.and(cb.equal(root.get<ProductStatus>("status"), ProductStatus.PUBLISHED), cb.equal(root.get<Boolean>("featured"), true))
            },
            PageRequest.of(0, 12),
        )
        val newArrivals = products.findAll(
            Specification { root, _, cb -> cb.equal(root.get<ProductStatus>("status"), ProductStatus.PUBLISHED) },
            PageRequest.of(0, 12, Sort.by(Sort.Direction.DESC, "createdAt")),
        )
        val now = OffsetDateTime.now()
        val activeBanners = banners.findAllActive().filter { banner ->
            (banner.startsAt == null || !banner.startsAt!!.isAfter(now)) && (banner.endsAt == null || !banner.endsAt!!.isBefore(now))
        }
        return mapOf(
            "storeName" to settings.storeNameEn,
            "tagline" to settings.taglineEn,
            "logoUrl" to settings.logoUrl,
            "currency" to settings.currency,
            "ageGroups" to ageGroupList(),
            "contact" to mapOf(
                "phone" to settings.contactPhone,
                "secondaryPhone" to settings.contactSecondaryPhone,
                "email" to settings.contactEmail,
                "telegram" to settings.contactTelegramUsername,
            ),
            "categories" to categories(),
            "featured" to summarize(featured.content),
            "newArrivals" to summarize(newArrivals.content),
            "banners" to activeBanners.map {
                mapOf(
                    "id" to it.id, "titleEn" to it.titleEn, "subtitleEn" to it.subtitleEn,
                    "imageUrl" to it.imageUrl, "linkType" to it.linkType.name, "linkValue" to it.linkValue,
                    "placement" to it.placement.name,
                )
            },
            "collections" to collections.findAllActive().map { collection ->
                val ids = collectionItems.productIdsFor(collection.id!!).mapNotNull { it }
                mapOf(
                    "slug" to collection.slug, "nameEn" to collection.nameEn,
                    "descriptionEn" to collection.descriptionEn,
                    "products" to summarize(products.findAllById(ids)),
                )
            },
        )
    }

    @Transactional(readOnly = true)
    open fun zoneList(): List<Map<String, Any?>> = deliveryZones.findByActiveTrueOrderByRegionAscCityAsc().map {
        mapOf(
            "id" to it.id, "nameEn" to it.nameEn, "region" to it.region,
            "city" to it.city, "subCity" to it.subCity, "fee" to Money.parse(it.fee),
            "freeOver" to it.freeOver?.let { value -> Money.parse(value) }, "estimatedDays" to it.estimatedDays,
        )
    }

    open fun summarize(list: List<Product>): List<ProductSummaryDto> {
        if (list.isEmpty()) return emptyList()
        val ids = list.mapNotNull { it.id }
        val variantRows = variants.findForProducts(ids).groupBy { it.product?.id }
        val imageRows = images.findForProducts(ids).groupBy { it.product?.id }
        val bands = products.ageGroupCodesFor(ids).groupBy({ it.productId }, { it.code })
        val currency = storeConfig.settings().currency
        return list.map { product ->
            val productVariants = variantRows[product.id] ?: emptyList()
            val productImages = imageRows[product.id] ?: emptyList()
            val image = productImages.firstOrNull { row -> row.isPrimary } ?: productImages.firstOrNull()
            ProductSummaryDto(
                slug = product.slug,
                nameEn = product.nameEn,
                categorySlug = product.category?.slug ?: "",
                categoryNameEn = product.category?.nameEn ?: "",
                price = Money.parse(product.basePrice),
                salePrice = product.salePrice?.let { Money.parse(it) },
                currency = currency,
                imageUrl = image?.url,
                totalStock = productVariants.sumOf { it.stock },
                featured = product.featured,
                sizingSystem = product.sizingSystem,
                audience = product.audience,
                gender = product.gender,
                ageGroups = bands[product.id] ?: emptyList(),
                createdAt = product.createdAt,
            )
        }
    }
}
