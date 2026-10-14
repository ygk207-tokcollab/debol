package com.kidsstore.support

import com.kidsstore.admin.AdminAuthService
import com.kidsstore.config.AppProperties
import com.kidsstore.domain.*
import com.kidsstore.repo.*
import com.kidsstore.security.JwtService
import com.kidsstore.service.OrderStatusService
import com.kidsstore.service.StoreConfigService
import com.kidsstore.storefront.CartService
import com.kidsstore.storefront.CheckoutRequest
import com.kidsstore.storefront.CheckoutResponse
import com.kidsstore.storefront.CheckoutService
import com.kidsstore.storefront.CustomerSessionService
import com.kidsstore.storefront.QuoteRequest
import com.kidsstore.storefront.QuoteResponse
import com.kidsstore.telegram.OutboxDispatcher
import jakarta.persistence.EntityManager
import org.junit.jupiter.api.BeforeEach
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.security.crypto.password.PasswordEncoder

/**
 * Resets `kidsstore_test` to the pristine Flyway baseline on every test context start (clean +
 * migrate). This touches ONLY the kidsstore_test database; kidsstore_demo / kidsstore_dev are never
 * connected to from these tests (the datasource url in application-test.yml is fixed).
 */
@TestConfiguration
open class FlywayResetConfiguration {
    @Bean
    open fun flywayMigrationStrategy(): FlywayMigrationStrategy = FlywayMigrationStrategy { flyway ->
        flyway.clean()
        flyway.migrate()
    }
}

@SpringBootTest
@Import(FlywayResetConfiguration::class)
abstract class AbstractIntegrationTest {

    @Autowired protected lateinit var cartService: CartService
    @Autowired protected lateinit var checkoutService: CheckoutService
    @Autowired protected lateinit var orderStatusService: OrderStatusService
    @Autowired protected lateinit var orders: OrderRepository
    @Autowired protected lateinit var orderItems: OrderItemRepository
    @Autowired protected lateinit var variants: ProductVariantRepository
    @Autowired protected lateinit var products: ProductRepository
    @Autowired protected lateinit var categories: CategoryRepository
    @Autowired protected lateinit var administrators: AdministratorRepository
    @Autowired protected lateinit var customers: CustomerRepository
    @Autowired protected lateinit var outbox: NotificationOutboxRepository
    @Autowired protected lateinit var storeConfig: StoreConfigService
    @Autowired protected lateinit var customerSessions: CustomerSessionService
    @Autowired protected lateinit var adminAuth: AdminAuthService
    @Autowired protected lateinit var jwt: JwtService
    @Autowired protected lateinit var passwordEncoder: PasswordEncoder
    @Autowired protected lateinit var jdbcTemplate: JdbcTemplate
    @Autowired protected lateinit var dispatcher: OutboxDispatcher
    @Autowired protected lateinit var props: AppProperties
    @Autowired protected lateinit var em: EntityManager

    /** The Flyway seed leaves the "Addis Ababa / Bole" zone (fee 150, free over 3000). */
    protected val region = "Addis Ababa"
    protected val city = "Addis Ababa"
    protected val subCityBole = "Bole"

    protected fun randomKey(prefix: String): String =
        prefix + java.util.UUID.randomUUID().toString().replace("-", "").take(24)

    protected fun newCartKey(): String = randomKey("cart")

    /** A dedicated published product+variant so stock assertions never touch the seeded catalogue. */
    protected fun createProductWithStock(unitPrice: java.math.BigDecimal, stock: Int): ProductVariant {
        val category = categories.findAllActive().first()
        val slug = "test-sku-" + java.util.UUID.randomUUID().toString().take(12)
        val product = products.save(
            Product().apply {
                this.slug = slug
                this.category = category
                this.nameEn = "Test Item"
                this.audience = Audience.CHILD
                this.gender = Gender.UNISEX
                this.sizingSystem = SizingSystem.AGE
                this.basePrice = unitPrice
                this.salePrice = null
                this.status = ProductStatus.PUBLISHED
                this.isSample = false
            }
        )
        val variant = variants.save(
            ProductVariant().apply {
                this.product = product
                this.sizeLabel = "One"
                this.colorName = "Test"
                this.sku = slug
                this.priceOverride = null
                this.stock = stock
                this.lowStockThreshold = 0
                this.active = true
            }
        )
        return variant
    }

    protected fun addToCart(cartKey: String, variantId: Long, quantity: Int) =
        cartService.addItem(cartKey, variantId, quantity)

    protected fun request(): MockHttpServletRequest =
        MockHttpServletRequest().apply { remoteAddr = "127.0.0.1" }

    /** Full checkout against the seeded Addis Ababa / Bole zone (delivery fee 150, free over 3000). */
    protected fun checkout(
        cartKey: String,
        variantId: Long,
        quantity: Int,
        idempotencyKey: String? = null,
        expectedTotal: java.math.BigDecimal? = null,
        phone: String = "0912345678",
        subCity: String? = subCityBole,
    ): CheckoutResponse {
        addToCart(cartKey, variantId, quantity)
        val req = CheckoutRequest(
            fullName = "Test Buyer",
            phone = phone,
            region = region,
            city = city,
            subCity = subCity,
            addressLine = "Bole Road 1",
            paymentMethod = "CASH_ON_DELIVERY",
            expectedTotal = expectedTotal,
            idempotencyKey = idempotencyKey,
        )
        return checkoutService.checkout(cartKey, req, request(), null)
    }

    protected fun quote(variantId: Long, quantity: Int, region: String, city: String, subCity: String?): QuoteResponse {
        val cartKey = newCartKey()
        addToCart(cartKey, variantId, quantity)
        return checkoutService.quote(cartKey, QuoteRequest(region = region, city = city, subCity = subCity))
    }

    protected fun orderRow(orderId: Long): Map<String, Any?> =
        jdbcTemplate.queryForMap("select status, payment_status, subtotal, delivery_fee, total_amount, amount_collected, payment_collected_by, payment_collected_at, stock_restored, order_number from orders where id = ?", orderId)

    protected fun variantStock(variantId: Long): Int =
        jdbcTemplate.queryForObject("select stock from product_variant where id = ?", Int::class.java, variantId)!!

    protected fun saveAdmin(email: String, role: AdminRole): Administrator =
        administrators.save(
            Administrator().apply {
                this.email = email
                this.fullName = role.name.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
                this.passwordHash = passwordEncoder.encode("TestPassw0rd-long!")
                this.role = role
                this.active = true
                this.tokenVersion = 0
            }
        )

    /** A raw (unhashed) customer bearer token usable as an Authorization header, backed by a session. */
    protected fun issueCustomerToken(): Pair<String, Long> {
        val phone = "09" + java.util.UUID.randomUUID().toString().filter { it.isDigit() }.take(8)
        val customer = customers.save(
            Customer().apply {
                this.fullName = "Bearer Tester"
                this.phone = phone
            }
        )
        val token = customerSessions.issue(customer, null)
            ?: error("customer session issuance disabled in this profile")
        return token to customer.id!!
    }
}
