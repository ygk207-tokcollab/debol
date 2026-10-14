package com.kidsstore.storefront

import com.kidsstore.common.*
import com.kidsstore.config.AppProperties
import com.kidsstore.domain.*
import com.kidsstore.repo.*
import com.kidsstore.security.CustomerPrincipal
import com.kidsstore.security.RateLimiter
import com.kidsstore.service.StoreConfigService
import com.kidsstore.telegram.NotificationService
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Positive
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.time.OffsetDateTime

data class CartItemView(
    val variantId: Long,
    val productSlug: String,
    val nameEn: String,
    val sizeLabel: String,
    val colorName: String,
    val colorHex: String?,
    val unitPrice: BigDecimal,
    val listPrice: BigDecimal,
    val quantity: Int,
    val lineTotal: BigDecimal,
    val stock: Int,
    val imageUrl: String?,
)

data class CartView(val cartKey: String, val items: List<CartItemView>, val subtotal: BigDecimal, val currency: String)

data class QuoteRequest(@field:NotBlank val region: String = "", @field:NotBlank val city: String = "", val subCity: String? = null)

data class QuoteResponse(val subtotal: BigDecimal, val deliveryFee: BigDecimal, val total: BigDecimal,
                         val currency: String, val zoneNameEn: String?, val estimatedDays: Int?)

data class CheckoutRequest(
    @field:NotBlank val fullName: String = "",
    @field:NotBlank val phone: String = "",
    val secondaryPhone: String? = null,
    @field:NotBlank val region: String = "",
    @field:NotBlank val city: String = "",
    val subCity: String? = null,
    val neighborhood: String? = null,
    @field:NotBlank val addressLine: String = "",
    val deliveryInstructions: String? = null,
    val preferredDeliveryTime: String? = null,
    /** Only CASH_ON_DELIVERY is accepted at launch. */
    @field:NotBlank val paymentMethod: String = "CASH_ON_DELIVERY",
    val telegramInitData: String? = null,
    @field:NotNull val expectedTotal: BigDecimal? = null,
    val idempotencyKey: String? = null,
)

data class CheckoutResponse(
    val orderNumber: String,
    val publicToken: String,
    val status: OrderStatus,
    val paymentStatus: PaymentStatus,
    val paymentMethod: PaymentMethod,
    val subtotal: BigDecimal,
    val deliveryFee: BigDecimal,
    val totalAmount: BigDecimal,
    val currency: String,
    val items: List<CartItemView>,
    val customerSessionToken: String? = null,
    val replayed: Boolean = false,
)

@Service
open class CartService(
    private val carts: CartRepository,
    private val cartItems: CartItemRepository,
    private val variants: ProductVariantRepository,
    private val images: ProductImageRepository,
    private val customers: CustomerRepository,
    private val storeConfig: StoreConfigService,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Transactional
    open fun findOrCreate(cartKey: String): Cart {
        require(cartKey.isNotBlank() && cartKey.length in 8..64) { throw badRequest("invalid_cart_key", "Cart key is invalid") }
        return carts.findByCartKey(cartKey) ?: carts.save(
            Cart().apply {
                this.cartKey = cartKey
                this.createdAt = OffsetDateTime.now()
                this.updatedAt = OffsetDateTime.now()
            }
        )
    }

    @Transactional
    open fun attach(cartKey: String, customerId: Long): Cart {
        val cart = findOrCreate(cartKey)
        cart.customer = customers.findById(customerId).orElse(null)
        return carts.save(cart)
    }

    @Transactional
    open fun addItem(cartKey: String, variantId: Long, quantity: Int): CartView {
        if (quantity < 1) throw badRequest("invalid_quantity", "Choose at least one item")
        val cart = findOrCreate(cartKey)
        val variant = purchasableVariant(variantId)
        val existing = cartItems.findDetailed(cart.id!!).firstOrNull { it.variant?.id == variantId }
        val newQuantity = (existing?.quantity ?: 0) + quantity
        if (newQuantity > variant.stock) {
            throw badRequest("insufficient_stock", "Only ${variant.stock} left of this size and colour",
                listOf(FieldMessage("quantity", "Only ${variant.stock} in stock")))
        }
        if (existing == null) {
            cartItems.save(
                CartItem().apply {
                    this.cart = cart
                    this.variant = variant
                    this.quantity = quantity
                    this.addedAt = OffsetDateTime.now()
                }
            )
        } else {
            existing.quantity = newQuantity
            cartItems.save(existing)
        }
        touch(cart)
        return view(cartKey)
    }

    @Transactional
    open fun setQuantity(cartKey: String, variantId: Long, quantity: Int): CartView {
        val cart = carts.findByCartKey(cartKey) ?: return view(cartKey)
        val line = cartItems.findDetailed(cart.id!!).firstOrNull { it.variant?.id == variantId }
            ?: throw notFound("cart_item_not_found", "That item is not in the cart")
        if (quantity < 1) return removeItem(cartKey, variantId)
        val variant = line.variant ?: throw notFound("cart_item_not_found", "That item is no longer available")
        if (quantity > variant.stock) {
            throw badRequest("insufficient_stock", "Only ${variant.stock} in stock for this variant",
                listOf(FieldMessage("quantity", "Only ${variant.stock} in stock")))
        }
        line.quantity = quantity
        cartItems.save(line)
        touch(cart)
        return view(cartKey)
    }

    @Transactional
    open fun removeItem(cartKey: String, variantId: Long): CartView {
        val cart = carts.findByCartKey(cartKey) ?: return view(cartKey)
        cartItems.deleteByCartIdAndVariantId(cart.id!!, variantId)
        touch(cart)
        return view(cartKey)
    }

    @Transactional
    open fun clear(cartKey: String) {
        val cart = carts.findByCartKey(cartKey) ?: return
        cartItems.deleteAll(cartItems.findDetailed(cart.id!!))
        touch(cart)
    }

    @Transactional(readOnly = true)
    open fun view(cartKey: String): CartView {
        val cart = carts.findByCartKey(cartKey)
            ?: return CartView(cartKey, emptyList(), BigDecimal.ZERO, storeConfig.settings().currency)
        val settings = storeConfig.settings()
        val lines = cartItems.findDetailed(cart.id!!)
        val imageRows = lines.mapNotNull { it.variant?.product?.id }.distinct().let { ids ->
            images.findForProducts(ids).groupBy { it.product?.id }
        }
        return CartView(
            cartKey = cartKey,
            items = lines.map { line ->
                val variant = line.variant!!
                val product = variant.product!!
                val productImages = imageRows[product.id] ?: emptyList()
                CartItemView(
                    variantId = variant.id!!,
                    productSlug = product.slug,
                    nameEn = product.nameEn,
                    sizeLabel = variant.sizeLabel,
                    colorName = variant.colorName,
                    colorHex = variant.colorHex,
                    unitPrice = Money.parse(variant.priceOverride ?: product.baseEffectivePrice()),
                    listPrice = Money.parse(product.basePrice),
                    quantity = line.quantity,
                    lineTotal = Money.multiply(variant.priceOverride ?: product.baseEffectivePrice(), line.quantity),
                    stock = variant.stock,
                    imageUrl = productImages.firstOrNull { it.isPrimary }?.url ?: productImages.firstOrNull()?.url,
                )
            },
            subtotal = Money.sum(lines.map { it.variant!!.priceOverride ?: it.variant!!.product!!.baseEffectivePrice().multiply(BigDecimal(it.quantity)) }),
            currency = settings.currency,
        )
    }

    private fun purchasableVariant(variantId: Long): ProductVariant {
        val variant = variants.findById(variantId).orElse(null)?.takeIf { it.active }
            ?: throw badRequest("variant_unavailable", "That size or colour is no longer available")
        val product = variant.product ?: throw badRequest("variant_unavailable", "That product is unavailable")
        if (product.status != ProductStatus.PUBLISHED) throw badRequest("product_unavailable", "${product.nameEn} is not on sale right now")
        return variant
    }

    private fun touch(cart: Cart) {
        cart.updatedAt = OffsetDateTime.now()
        carts.save(cart)
    }
}

@Service
open class CheckoutService(
    private val orders: OrderRepository,
    private val orderItems: OrderItemRepository,
    private val carts: CartRepository,
    private val cartItems: CartItemRepository,
    private val cartService: CartService,
    private val variants: ProductVariantRepository,
    private val images: ProductImageRepository,
    private val zoneRepository: DeliveryZoneRepository,
    private val customers: CustomerRepository,
    private val telegramAccounts: TelegramAccountRepository,
    private val telegramVerifier: com.kidsstore.security.TelegramInitDataVerifier,
    private val customerSessions: CustomerSessionService,
    private val inventory: InventoryMovementRepository,
    private val events: OrderStatusEventRepository,
    private val storeConfig: StoreConfigService,
    private val notifications: NotificationService,
    private val rateLimiter: RateLimiter,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Transactional(readOnly = true)
    open fun quote(cartKey: String, request: QuoteRequest): QuoteResponse {
        val cart = cartService.view(cartKey)
        val zone = resolveZone(request.region, request.city, request.subCity)
        val fee = deliveryFeeFor(zone, cart.subtotal)
        return QuoteResponse(
            subtotal = cart.subtotal,
            deliveryFee = fee,
            total = Money.parse(cart.subtotal.add(fee)),
            currency = storeConfig.settings().currency,
            zoneNameEn = zone.nameEn,
            estimatedDays = zone.estimatedDays,
        )
    }

    @Transactional
    open fun checkout(cartKey: String, request: CheckoutRequest, http: HttpServletRequest, principal: CustomerPrincipal?): CheckoutResponse {
        rateLimiter.check(RateLimiter.Kind.CHECKOUT, http.remoteAddr ?: "unknown")

        request.idempotencyKey?.takeIf { it.isNotBlank() }?.let { key ->
            orders.findByIdempotencyKey(key)?.let { return respondFor(it, replayed = true) }
        }

        val phone = EthiopianPhone.normalize(request.phone)
            ?: throw badRequest("invalid_phone", "Enter a valid Ethiopian phone number such as 0912345678",
                listOf(FieldMessage("phone", "Ethiopian numbers start with 09 or 07")))
        val secondary = request.secondaryPhone?.takeIf { it.isNotBlank() }?.let {
            EthiopianPhone.normalize(it) ?: throw badRequest("invalid_phone", "Secondary phone number is not a valid Ethiopian number",
                listOf(FieldMessage("secondaryPhone", "Ethiopian numbers start with 09 or 07")))
        }
        if (request.paymentMethod != PaymentMethod.CASH_ON_DELIVERY.name) {
            throw badRequest("payment_method_unavailable", "Only cash on delivery is available at launch")
        }

        val telegramUser = request.telegramInitData?.takeIf { it.isNotBlank() }
            ?.let { telegramVerifier.verify(it).user }

        val customer = findOrCreateCustomer(phone, request.fullName, secondary, telegramUser)
        val zone = resolveZone(request.region, request.city, request.subCity)

        val cart = carts.findByCartKey(cartKey)
        val lines = cart?.id?.let { cartItems.findDetailed(it) } ?: emptyList()
        if (lines.isEmpty()) throw badRequest("empty_cart", "Your cart is empty")

        // Lock variants in a stable order so two customers cannot oversell the same stock.
        val lockedIds = lines.mapNotNull { it.variant?.id }.sorted()
        val lockedVariants = lockedIds.mapNotNull { variants.findByIdForUpdate(it) }.associateBy { it.id }

        var subtotal = BigDecimal.ZERO
        val pricedLines = lines.map { line ->
            val variant = lockedVariants[line.variant?.id]
                ?: throw badRequest("variant_unavailable", "An item in your cart is no longer available")
            val product = variant.product ?: throw badRequest("variant_unavailable", "An item in your cart is unavailable")
            if (!variant.active || product.status != ProductStatus.PUBLISHED) {
                throw badRequest("product_unavailable", "${product.nameEn} is no longer on sale")
            }
            if (variant.stock < line.quantity) {
                throw badRequest("insufficient_stock",
                    "Only ${variant.stock} left of ${product.nameEn} (${variant.sizeLabel}, ${variant.colorName})",
                    listOf(FieldMessage("quantity", "Only ${variant.stock} in stock")))
            }
            val unitPrice = Money.parse(variant.priceOverride ?: product.baseEffectivePrice())
            subtotal = subtotal.add(Money.multiply(unitPrice, line.quantity))
            Triple(variant, product, unitPrice)
        }
        subtotal = Money.parse(subtotal)

        val deliveryFee = deliveryFeeFor(zone, subtotal)
        val total = Money.parse(subtotal.add(deliveryFee))

        // The browser shows this number, but the server value is the one that is charged.
        request.expectedTotal?.let { expected ->
            if (Money.parse(expected) != total) {
                log.info("Price mismatch at checkout: client {} server {}", expected, total)
                throw badRequest("price_changed", "Prices or delivery fees changed, please review the cart again",
                    listOf(FieldMessage("expectedTotal", "Total changed to ${Money.format(total, storeConfig.settings().currency)}")))
            }
        }

        val settings = storeConfig.settings()
        val order = orders.save(
            Order().apply {
                this.orderNumber = nextOrderNumber()
                this.publicToken = Tokens.urlSafe(24)
                this.customer = customer
                this.cartKey = cartKey
                this.telegramUserId = telegramUser?.telegramUserId
                this.status = OrderStatus.PENDING_CONFIRMATION
                this.paymentStatus = PaymentStatus.UNPAID
                this.paymentMethod = PaymentMethod.CASH_ON_DELIVERY
                this.currency = settings.currency
                this.subtotal = subtotal
                this.deliveryFee = deliveryFee
                this.discountAmount = BigDecimal.ZERO.setScale(Money.SCALE)
                this.totalAmount = total
                this.customerName = request.fullName.trim()
                this.customerPhone = phone
                this.secondaryPhone = secondary
                this.region = request.region.trim()
                this.city = request.city.trim()
                this.subCity = request.subCity?.trim()
                this.neighborhood = request.neighborhood?.trim()
                this.addressLine = request.addressLine.trim()
                this.deliveryInstructions = request.deliveryInstructions?.trim()
                this.preferredDeliveryTime = request.preferredDeliveryTime?.trim()
                this.deliveryZone = zone
                this.placementSource = if (telegramUser != null) PlacementSource.TELEGRAM else PlacementSource.WEB
                this.idempotencyKey = request.idempotencyKey?.takeIf { it.isNotBlank() }
                    ?: "auto:${Tokens.urlSafe(12)}"
                this.createdAt = OffsetDateTime.now()
                this.updatedAt = OffsetDateTime.now()
            }
        )

        pricedLines.forEachIndexed { index, triple ->
            val (variant, product, unitPrice) = triple
            val line = lines[index]
            orderItems.save(
                OrderItem().apply {
                    this.order = order
                    this.product = product
                    this.variant = variant
                    this.productSlug = product.slug
                    this.productNameEn = product.nameEn
                    this.sizeLabel = variant.sizeLabel
                    this.colorName = variant.colorName
                    this.unitPrice = unitPrice
                    this.quantity = line.quantity
                    this.lineTotal = Money.multiply(unitPrice, line.quantity)
                    this.createdAt = OffsetDateTime.now()
                }
            )
            // Reserve stock inside the same transaction: no overselling, no negative inventory.
            variant.stock = variant.stock - line.quantity
            variant.updatedAt = OffsetDateTime.now()
            variants.save(variant)
            inventory.save(
                InventoryMovement().apply {
                    this.variant = variant
                    this.product = product
                    this.changeQty = -line.quantity
                    this.balanceAfter = variant.stock
                    this.reason = InventoryReason.ORDER_RESERVED
                    this.referenceType = "ORDER"
                    this.referenceId = order.id
                    this.actorType = ActorType.SYSTEM
                    this.actorEmail = "checkout"
                    this.note = "Reserved for ${order.orderNumber}"
                    this.createdAt = OffsetDateTime.now()
                }
            )
            notifications.enqueueStockAlert(order = null, variant = variant, defaultThreshold = settings.lowStockThreshold)
        }

        val saved = orders.save(order)
        customer.lastOrderAt = OffsetDateTime.now()
        customers.save(customer)
        cartItems.deleteAll(lines)
        cart?.let(carts::delete)

        // Written in this same transaction: the notification only exists if the order does.
        notifications.enqueueNewOrder(saved)
        events.save(orderStatusEvent(saved, null, OrderStatus.PENDING_CONFIRMATION, ActorType.CUSTOMER, "Order placed by customer"))

        val sessionToken = customerSessions.issue(customer, telegramUser?.telegramUserId)
        return CheckoutResponse(
            orderNumber = saved.orderNumber,
            publicToken = saved.publicToken,
            status = saved.status,
            paymentStatus = saved.paymentStatus,
            paymentMethod = saved.paymentMethod,
            subtotal = saved.subtotal,
            deliveryFee = saved.deliveryFee,
            totalAmount = saved.totalAmount,
            currency = saved.currency,
            items = itemViews(saved.id!!),
            customerSessionToken = sessionToken,
        )
    }

    /** Line snapshots from the persisted order: the cart is already gone at this point. */
    private fun itemViews(orderId: Long): List<CartItemView> =
        orderItems.findForOrders(listOf(orderId)).map { item ->
            CartItemView(
                variantId = item.variant?.id ?: 0,
                productSlug = item.productSlug ?: "",
                nameEn = item.productNameEn,
                sizeLabel = item.sizeLabel,
                colorName = item.colorName,
                colorHex = item.variant?.colorHex,
                unitPrice = item.unitPrice,
                listPrice = item.variant?.product?.basePrice ?: item.unitPrice,
                quantity = item.quantity,
                lineTotal = item.lineTotal,
                stock = item.variant?.stock ?: 0,
                imageUrl = item.variant?.product?.id?.let { productId ->
                    images.findForProduct(productId).firstOrNull { it.isPrimary }?.url
                },
            )
        }

    private fun orderStatusEvent(order: Order, from: OrderStatus?, to: OrderStatus, actor: ActorType, note: String): OrderStatusEvent =
        OrderStatusEvent().apply {
            this.order = order
            this.fromStatus = from
            this.toStatus = to
            this.fromPaymentStatus = null
            this.toPaymentStatus = order.paymentStatus
            this.note = note
            this.actorType = actor
            this.actorEmail = order.customerPhone
            this.createdAt = OffsetDateTime.now()
        }

    private fun respondFor(order: Order, replayed: Boolean): CheckoutResponse =
        CheckoutResponse(
            orderNumber = order.orderNumber,
            publicToken = order.publicToken,
            status = order.status,
            paymentStatus = order.paymentStatus,
            paymentMethod = order.paymentMethod,
            subtotal = order.subtotal,
            deliveryFee = order.deliveryFee,
            totalAmount = order.totalAmount,
            currency = order.currency,
            items = itemViews(order.id!!),
            replayed = replayed,
        )

    private fun findOrCreateCustomer(
        phone: String,
        fullName: String,
        secondary: String?,
        telegramUser: com.kidsstore.security.TelegramUser?,
    ): Customer {
        // A Telegram sign-in may already own a customer record (created before a phone was known).
        val existing = telegramUser?.let { telegramAccounts.findByTelegramUserId(it.telegramUserId)?.customer }
            ?: customers.findByPhone(phone)
        val customer = existing ?: customers.save(
            Customer().apply {
                this.fullName = fullName.trim()
                this.phone = phone
                this.secondaryPhone = secondary
                this.createdAt = OffsetDateTime.now()
            }
        )
        if (existing != null && fullName.isNotBlank() && existing.fullName != fullName.trim()) {
            existing.fullName = fullName.trim()
            existing.secondaryPhone = secondary ?: existing.secondaryPhone
            customers.save(existing)
        }
        // Checkout is where a Telegram-only record finally learns a real phone number.
        if (existing != null && existing.phone.startsWith("tg")) {
            existing.phone = phone
            customers.save(existing)
        }
        if (telegramUser != null && telegramAccounts.findByTelegramUserId(telegramUser.telegramUserId) == null) {
            telegramAccounts.save(
                TelegramAccount().apply {
                    this.customer = customer
                    this.telegramUserId = telegramUser.telegramUserId
                    this.telegramUsername = telegramUser.username
                    this.firstName = telegramUser.firstName
                    this.lastName = telegramUser.lastName
                    this.languageCode = telegramUser.languageCode
                    this.photoUrl = telegramUser.photoUrl
                    this.verifiedAt = OffsetDateTime.now()
                    this.createdAt = OffsetDateTime.now()
                }
            )
        }
        return customer
    }

    private fun resolveZone(region: String, city: String, subCity: String?): DeliveryZone {
        val matches = zoneRepository.matchZone(region.trim(), city.trim(), subCity?.trim())
        if (matches.isEmpty()) {
            throw badRequest("undeliverable_location",
                "We do not deliver to $region / $city yet. Pick another town or contact the store.",
                listOf(FieldMessage("city", "No delivery zone covers this location")))
        }
        val wanted = subCity?.trim()
        return matches.firstOrNull { zone -> wanted != null && zone.subCity.equals(wanted, ignoreCase = true) } ?: matches.first()
    }

    private fun deliveryFeeFor(zone: DeliveryZone, subtotal: BigDecimal): BigDecimal {
        val settings = storeConfig.settings()
        val threshold = zone.freeOver ?: settings.freeDeliveryOver
        if (threshold != null && subtotal >= threshold) return BigDecimal.ZERO.setScale(Money.SCALE)
        return Money.parse(zone.fee)
    }

    private fun nextOrderNumber(): String {
        val value = orders.nextOrderSequence()
        return "ORD-${OffsetDateTime.now().year}-${"%05d".format(value)}"
    }
}
