package com.kidsstore.repo

import com.kidsstore.domain.*
import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.JpaSpecificationExecutor
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Repository
import java.time.OffsetDateTime

@Repository
interface AdministratorRepository : JpaRepository<Administrator, Long> {
    fun findByEmailIgnoreCase(email: String): Administrator?

    @Query("select a from Administrator a where a.active = true order by a.createdAt")
    fun findAllActive(): List<Administrator>
}

@Repository
interface StoreSettingsRepository : JpaRepository<StoreSettings, Long>

@Repository
interface DeliveryZoneRepository : JpaRepository<DeliveryZone, Long> {
    fun findByActiveTrueOrderByRegionAscCityAsc(): List<DeliveryZone>

    @Query(
        """
        select z from DeliveryZone z
        where z.active = true
          and lower(z.region) = lower(:region)
          and lower(z.city) = lower(:city)
        order by
          case when lower(coalesce(z.subCity, '')) = lower(coalesce(:subCity, '')) then 0 else 1 end,
          z.fee
        """
    )
    fun matchZone(@Param("region") region: String, @Param("city") city: String, @Param("subCity") subCity: String?): List<DeliveryZone>
}

@Repository
interface AgeGroupRepository : JpaRepository<AgeGroup, Long> {
    fun findByCode(code: String): AgeGroup?

    @Query("select g from AgeGroup g where g.active = true order by g.sortOrder, g.minAge")
    fun findAllActive(): List<AgeGroup>

    @Query("select g from AgeGroup g order by g.sortOrder")
    fun findAllOrdered(): List<AgeGroup>

    fun findAllByCodeIn(codes: Collection<String>): List<AgeGroup>
}

@Repository
interface CategoryRepository : JpaRepository<Category, Long>, JpaSpecificationExecutor<Category> {
    fun findBySlug(slug: String): Category?

    @Query("select c from Category c where c.active = true order by c.sortOrder, c.nameEn")
    fun findAllActive(): List<Category>
}

@Repository
interface ProductRepository : JpaRepository<Product, Long>, JpaSpecificationExecutor<Product> {
    fun findBySlug(slug: String): Product?

    @Query("select p from Product p where lower(p.nameEn) = lower(:name) and lower(p.slug) = lower(:slug)")
    fun findByNameAndSlug(name: String, slug: String): Product?

    @Query("select p from Product p join fetch p.category c where p.status = com.kidsstore.domain.ProductStatus.PUBLISHED order by p.createdAt desc")
    fun findPublished(pageable: Pageable): Page<Product>

    /** One query for a whole page of tiles: the age bands would otherwise load per product. */
    @Query("select p.id as productId, g.code as code from Product p join p.ageGroups g where p.id in :productIds")
    fun ageGroupCodesFor(@Param("productIds") productIds: List<Long>): List<ProductAgeBand>
}

interface ProductAgeBand {
    val productId: Long?
    val code: String
}

@Repository
interface ProductImageRepository : JpaRepository<ProductImage, Long> {
    @Query("select i from ProductImage i where i.product.id = :productId order by i.sortOrder, i.id")
    fun findForProduct(@Param("productId") productId: Long): List<ProductImage>

    fun deleteAllByProductId(productId: Long)

    @Query("select i from ProductImage i where i.product.id in :productIds order by i.product.id, i.sortOrder")
    fun findForProducts(@Param("productIds") productIds: List<Long>): List<ProductImage>
}

@Repository
interface ProductVariantRepository : JpaRepository<ProductVariant, Long>, JpaSpecificationExecutor<ProductVariant> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select v from ProductVariant v where v.id = :id")
    fun findByIdForUpdate(@Param("id") id: Long): ProductVariant?

    fun findAllByIdIn(ids: List<Long>): List<ProductVariant>

    @Query("select v from ProductVariant v where v.product.id = :productId and v.active = true order by v.sizeLabel, v.colorName")
    fun findActiveForProduct(@Param("productId") productId: Long): List<ProductVariant>

    @Query("select v from ProductVariant v where v.product.id in :productIds and v.active = true")
    fun findForProducts(@Param("productIds") productIds: List<Long>): List<ProductVariant>

    @Query("select v from ProductVariant v join fetch v.product p where v.active = true and p.status <> com.kidsstore.domain.ProductStatus.ARCHIVED order by v.stock, p.nameEn, v.sizeLabel")
    fun findAllActiveWithProduct(): List<ProductVariant>

    fun findAllByProductId(productId: Long): List<ProductVariant>
}

@Repository
interface CustomerRepository : JpaRepository<Customer, Long> {
    fun findByPhone(phone: String): Customer?
}

@Repository
interface TelegramAccountRepository : JpaRepository<TelegramAccount, Long> {
    fun findByTelegramUserId(telegramUserId: Long): TelegramAccount?
    fun findByCustomerId(customerId: Long): TelegramAccount?
}

@Repository
interface CustomerAddressRepository : JpaRepository<CustomerAddress, Long> {
    fun findAllByCustomerIdOrderByCreatedAtDesc(customerId: Long): List<CustomerAddress>
}

@Repository
interface CustomerSessionRepository : JpaRepository<CustomerSession, Long> {
    fun findByTokenHash(tokenHash: String): CustomerSession?
}

@Repository
interface CartRepository : JpaRepository<Cart, Long> {
    fun findByCartKey(cartKey: String): Cart?
}

@Repository
interface CartItemRepository : JpaRepository<CartItem, Long> {
    @Query("select ci from CartItem ci join fetch ci.variant v join fetch v.product p where ci.cart.id = :cartId order by ci.addedAt")
    fun findDetailed(@Param("cartId") cartId: Long): List<CartItem>

    fun deleteByCartIdAndVariantId(cartId: Long, variantId: Long)
}

interface StatusCount {
    val status: OrderStatus
    val total: Long
}

interface PaymentCount {
    val paymentStatus: PaymentStatus
    val total: Long
}

@Repository
interface OrderRepository : JpaRepository<Order, Long>, JpaSpecificationExecutor<Order> {
    fun findByOrderNumber(orderNumber: String): Order?
    fun findByIdempotencyKey(idempotencyKey: String): Order?
    fun findByPublicToken(publicToken: String): Order?

    @Query("select o.status as status, count(o) as total from Order o group by o.status")
    fun countByStatus(): List<StatusCount>

    @Query("select o.paymentStatus as paymentStatus, count(o) as total from Order o group by o.paymentStatus")
    fun countByPaymentStatus(): List<PaymentCount>

    @Query("select coalesce(sum(o.totalAmount), 0) from Order o where o.status = com.kidsstore.domain.OrderStatus.DELIVERED and o.paymentStatus = com.kidsstore.domain.PaymentStatus.PAID")
    fun collectedRevenue(): java.math.BigDecimal

    @Query("select coalesce(sum(o.totalAmount), 0) from Order o where o.createdAt >= :from and o.createdAt < :to and o.status <> com.kidsstore.domain.OrderStatus.CANCELLED")
    fun orderedValueBetween(@Param("from") from: OffsetDateTime, @Param("to") to: OffsetDateTime): java.math.BigDecimal

    @Query("select count(o) from Order o where o.createdAt >= :from and o.createdAt < :to")
    fun countCreatedBetween(@Param("from") from: OffsetDateTime, @Param("to") to: OffsetDateTime): Long

    @Query(
        """
        select oi.product.id as productId, sum(oi.quantity) as units
        from OrderItem oi
        where oi.order.status in (com.kidsstore.domain.OrderStatus.CONFIRMED, com.kidsstore.domain.OrderStatus.PROCESSING,
                                  com.kidsstore.domain.OrderStatus.OUT_FOR_DELIVERY, com.kidsstore.domain.OrderStatus.DELIVERED)
        group by oi.product.id
        order by sum(oi.quantity) desc
        """
    )
    fun bestSellingProductIds(pageable: Pageable): List<ProductUnits>

    fun findAllByCustomerIdOrderByCreatedAtDesc(customerId: Long): List<Order>

    @Query("select o from Order o where o.telegramUserId = :telegramUserId order by o.createdAt desc")
    fun findAllByTelegramUserId(@Param("telegramUserId") telegramUserId: Long): List<Order>

    /** Order numbers are ORD-<year>-<sequence>; gaps are acceptable because sequences are not transactional. */
    @Query(value = "select nextval('order_number_seq')", nativeQuery = true)
    fun nextOrderSequence(): Long
}

interface ProductUnits {
    val productId: Long?
    val units: Long
}

@Repository
interface OrderItemRepository : JpaRepository<OrderItem, Long> {
    @Query("select oi from OrderItem oi where oi.order.id in :orderIds order by oi.order.id, oi.id")
    fun findForOrders(@Param("orderIds") orderIds: List<Long>): List<OrderItem>

    fun existsByProductId(productId: Long): Boolean
}

@Repository
interface OrderStatusEventRepository : JpaRepository<OrderStatusEvent, Long> {
    @Query("select e from OrderStatusEvent e where e.order.id = :orderId order by e.createdAt, e.id")
    fun findForOrder(@Param("orderId") orderId: Long): List<OrderStatusEvent>
}

@Repository
interface InventoryMovementRepository : JpaRepository<InventoryMovement, Long> {
    @Query("select m from InventoryMovement m where m.variant.id = :variantId order by m.createdAt desc")
    fun findForVariant(@Param("variantId") variantId: Long, pageable: Pageable): Page<InventoryMovement>

    @Query("select m from InventoryMovement m order by m.createdAt desc, m.id desc")
    fun findRecent(pageable: Pageable): Page<InventoryMovement>
}

@Repository
interface StockAlertRepository : JpaRepository<StockAlert, Long> {
    fun findByVariantIdAndAlertTypeAndStockAtNotice(variantId: Long, alertType: String, stockAtNotice: Int): StockAlert?
}

@Repository
interface AuditLogRepository : JpaRepository<AuditLog, Long> {
    @Query("select a from AuditLog a order by a.createdAt desc, a.id desc")
    fun findRecent(pageable: Pageable): Page<AuditLog>

    @Query("select a from AuditLog a where a.entityType = :entityType and a.entityId = :entityId order by a.createdAt desc")
    fun findForEntity(@Param("entityType") entityType: String, @Param("entityId") entityId: String, pageable: Pageable): Page<AuditLog>
}

@Repository
interface NotificationOutboxRepository : JpaRepository<NotificationOutbox, Long> {
    fun findByIdempotencyKey(key: String): NotificationOutbox?

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
        """
        select n from NotificationOutbox n
        where n.status in (com.kidsstore.domain.OutboxStatus.PENDING, com.kidsstore.domain.OutboxStatus.RETRY)
          and n.nextAttemptAt <= :now
          and (n.lockedUntil is null or n.lockedUntil < :now)
        order by n.id
        """
    )
    fun claimDue(@Param("now") now: OffsetDateTime, pageable: Pageable): List<NotificationOutbox>

    @Query("select n.status as status, count(n) as total from NotificationOutbox n group by n.status")
    fun countByStatus(): List<OutboxStatusCount>

    @Query("select n from NotificationOutbox n order by n.createdAt desc, n.id desc")
    fun findRecent(pageable: Pageable): Page<NotificationOutbox>

    @Query("select n from NotificationOutbox n where n.order.id = :orderId order by n.createdAt")
    fun findForOrder(@Param("orderId") orderId: Long): List<NotificationOutbox>
}

interface OutboxStatusCount {
    val status: OutboxStatus
    val total: Long
}

@Repository
interface TelegramPairingCodeRepository : JpaRepository<TelegramPairingCode, Long> {
    fun findByCode(code: String): TelegramPairingCode?

    @Query("select p from TelegramPairingCode p where p.status = com.kidsstore.domain.PairingCodeStatus.PENDING order by p.createdAt desc")
    fun findPending(): List<TelegramPairingCode>
}

@Repository
interface TelegramCallbackLogRepository : JpaRepository<TelegramCallbackLog, Long> {
    fun findByCallbackId(callbackId: String): TelegramCallbackLog?
}

@Repository
interface PromoBannerRepository : JpaRepository<PromoBanner, Long> {
    @Query("select b from PromoBanner b where b.active = true order by b.sortOrder")
    fun findAllActive(): List<PromoBanner>
}

@Repository
interface CollectionRepository : JpaRepository<ProductCollection, Long> {
    fun findBySlug(slug: String): ProductCollection?

    @Query("select c from ProductCollection c where c.active = true order by c.sortOrder")
    fun findAllActive(): List<ProductCollection>
}

@Repository
interface CollectionItemRepository : JpaRepository<CollectionItem, Long> {
    @Query("select ci.product.id from CollectionItem ci where ci.collection.id = :collectionId order by ci.sortOrder")
    fun productIdsFor(@Param("collectionId") collectionId: Long): List<Long?>

    fun deleteAllByCollectionId(collectionId: Long)
}

@Repository
interface SizeGuideRepository : JpaRepository<SizeGuide, Long> {
    fun findBySizingSystem(sizingSystem: SizingSystem): SizeGuide?
}
