package com.kidsstore.storefront

import com.kidsstore.common.Tokens
import com.kidsstore.common.notFound
import com.kidsstore.domain.SessionSource
import com.kidsstore.repo.SizeGuideRepository
import com.kidsstore.security.Actor
import com.kidsstore.security.CustomerPrincipal
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Positive
import org.springframework.http.HttpHeaders
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.math.BigDecimal

data class CartItemRequest(@field:NotNull val variantId: Long? = null, @field:Positive @field:NotNull val quantity: Int = 1)

data class TelegramAuthRequest(@field:NotBlank val initData: String = "")

data class PhoneLoginRequest(
    @field:NotBlank val phone: String = "",
    @field:NotBlank val orderNumber: String = "",
    @field:NotBlank val publicToken: String = "",
)

data class ProfileRequest(val fullName: String? = null)

data class CancelRequest(@field:NotBlank val reason: String = "")

/** Guest carts are keyed by an opaque header value; a Telegram or web session links the same cart. */
private fun cartKeyFrom(header: String?): String =
    header?.takeIf { it.isNotBlank() && it.length in 8..64 } ?: "guest${Tokens.urlSafe(10)}"

@RestController
@RequestMapping("/api/v1")
open class StorefrontReadController(
    private val catalog: CatalogService,
    private val sizeGuides: SizeGuideRepository,
) {
    @GetMapping("/store")
    open fun store() = catalog.home()

    @GetMapping("/store/settings")
    open fun storeSettings(): Map<String, Any?> {
        val home = catalog.home()
        return mapOf(
            "storeName" to home["storeName"],
            "tagline" to home["tagline"],
            "logoUrl" to home["logoUrl"],
            "currency" to home["currency"],
            "contact" to home["contact"],
        )
    }

    @GetMapping("/categories")
    open fun categories() = catalog.categories()

    /** The age bands the catalogue filter and the admin editor are built from - never hardcoded client-side. */
    @GetMapping("/age-groups")
    open fun ageGroups() = catalog.ageGroupList()

    @GetMapping("/products")
    open fun products(
        @RequestParam(required = false) category: String?,
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) audience: String?,
        @RequestParam(required = false) gender: String?,
        @RequestParam(required = false) size: String?,
        @RequestParam(required = false) ageGroup: String?,
        @RequestParam(required = false) minPrice: BigDecimal?,
        @RequestParam(required = false) maxPrice: BigDecimal?,
        @RequestParam(required = false, defaultValue = "false") inStock: Boolean,
        @RequestParam(required = false) featured: Boolean?,
        @RequestParam(required = false, defaultValue = "newest") sort: String?,
        @RequestParam(required = false, defaultValue = "0") page: Int,
        @RequestParam(required = false, defaultValue = "12") pageSize: Int,
    ): CatalogService.CatalogPage =
        catalog.listProducts(category, audience, q, gender, size, ageGroup, minPrice, maxPrice, inStock, featured, sort, page, pageSize)

    @GetMapping("/products/{slug}")
    open fun product(@PathVariable slug: String) = catalog.productBySlug(slug)

    @GetMapping("/delivery-zones")
    open fun deliveryZones() = catalog.zoneList()

    @GetMapping("/size-guides")
    open fun guides() = sizeGuides.findAll().map {
        mapOf(
            "sizingSystem" to it.sizingSystem.name, "titleEn" to it.titleEn, "bodyEn" to it.bodyEn,
        )
    }
}

@RestController
@RequestMapping("/api/v1/cart")
open class CartController(private val carts: CartService) {

    @GetMapping
    open fun cart(@RequestHeader(value = "X-Cart-Key", required = false) key: String?): ResponseEntity<CartView> {
        val cartKey = cartKeyFrom(key)
        return respond(carts.view(cartKey), cartKey, key == null)
    }

    @PostMapping("/items")
    open fun add(@RequestHeader(value = "X-Cart-Key", required = false) key: String?,
                 @Valid @RequestBody request: CartItemRequest): ResponseEntity<CartView> {
        val cartKey = cartKeyFrom(key)
        return respond(carts.addItem(cartKey, request.variantId!!, request.quantity), cartKey, key == null)
    }

    @PatchMapping("/items/{variantId}")
    open fun update(@RequestHeader(value = "X-Cart-Key", required = false) key: String?,
                    @PathVariable variantId: Long,
                    @Valid @RequestBody request: CartItemRequest): ResponseEntity<CartView> {
        val cartKey = cartKeyFrom(key)
        return respond(carts.setQuantity(cartKey, variantId, request.quantity), cartKey, key == null)
    }

    @DeleteMapping("/items/{variantId}")
    open fun remove(@RequestHeader(value = "X-Cart-Key", required = false) key: String?,
                   @PathVariable variantId: Long): ResponseEntity<CartView> {
        val cartKey = cartKeyFrom(key)
        return respond(carts.removeItem(cartKey, variantId), cartKey, key == null)
    }

    @DeleteMapping
    open fun clear(@RequestHeader(value = "X-Cart-Key", required = false) key: String?): ResponseEntity<CartView> {
        val cartKey = cartKeyFrom(key)
        carts.clear(cartKey)
        return respond(CartView(cartKey, emptyList(), java.math.BigDecimal.ZERO, "ETB"), cartKey, key == null)
    }

    private fun respond(view: CartView, cartKey: String, isNew: Boolean): ResponseEntity<CartView> =
        ResponseEntity.ok().header("X-Cart-Key", cartKey).header(if (isNew) "X-Cart-New" else "X-Cart-Kept", "true").body(view)
}

@RestController
@RequestMapping("/api/v1")
open class CheckoutController(
    private val checkout: CheckoutService,
    private val carts: CartService,
    private val orders: com.kidsstore.repo.OrderRepository,
    private val orderViews: com.kidsstore.service.OrderViews,
) {
    @PostMapping("/checkout/quote")
    open fun quote(@RequestHeader(value = "X-Cart-Key", required = false) key: String?,
                   @Valid @RequestBody request: QuoteRequest): QuoteResponse =
        checkout.quote(cartKeyFrom(key), request)

    @PostMapping("/checkout")
    open fun checkout(@RequestHeader(value = "X-Cart-Key", required = false) key: String?,
                      @Valid @RequestBody request: CheckoutRequest,
                      http: HttpServletRequest): CheckoutResponse =
        checkout.checkout(cartKeyFrom(key), request, http, Actor.customerOrNull())

    /** Guest receipt lookup: the order number alone is not a secret, so it also requires the token. */
    @GetMapping("/orders/track/{orderNumber}")
    open fun track(@PathVariable orderNumber: String, @RequestParam(required = false) token: String?): Map<String, Any?> {
        val order = orders.findByOrderNumber(orderNumber.uppercase())
            ?: throw notFound("order_not_found", "Order not found")
        if (token == null || order.publicToken != token) throw com.kidsstore.common.forbidden("That receipt link is not valid")
        return mapOf(
            "order" to orderViews.detail(order.id!!, adminView = false),
            "publicToken" to order.publicToken,
        )
    }
}

@RestController
@RequestMapping("/api/v1")
open class AuthController(
    private val customers: CustomerService,
    private val carts: CartService,
) {
    @PostMapping("/telegram/auth")
    open fun telegram(@Valid @RequestBody request: TelegramAuthRequest, http: HttpServletRequest) =
        customers.telegramLogin(request.initData, http)

    @PostMapping("/customers/auth/phone")
    open fun phone(@Valid @RequestBody request: PhoneLoginRequest, http: HttpServletRequest) =
        customers.phoneLogin(request.phone, request.orderNumber, request.publicToken, http)

    @PostMapping("/customers/auth/logout")
    open fun logout(): Map<String, Boolean> {
        val principal = Actor.customerOrNull() ?: return mapOf("revoked" to false)
        customers.logout(principal)
        return mapOf("revoked" to true)
    }
}

@RestController
@RequestMapping("/api/v1/me")
open class MeController(private val customers: CustomerService, private val carts: CartService) {

    @GetMapping("/profile")
    open fun profile() = customers.profile(principal())

    @PatchMapping("/profile")
    open fun update(@RequestBody request: ProfileRequest) =
        customers.updateProfile(principal(), request.fullName)

    @GetMapping("/orders")
    open fun orders() = customers.myOrders(principal())

    @GetMapping("/orders/{id}")
    open fun order(@PathVariable id: Long) = customers.myOrder(principal(), id)

    @PostMapping("/orders/{id}/cancel-request")
    open fun cancel(@PathVariable id: Long, @Valid @RequestBody request: CancelRequest) =
        customers.requestCancellation(principal(), id, request.reason)

    @GetMapping("/addresses")
    open fun addresses() = customers.listAddresses(principal())

    @PostMapping("/addresses")
    open fun addAddress(@Valid @RequestBody request: AddressRequest) = customers.addAddress(principal(), request)

    @DeleteMapping("/addresses/{id}")
    open fun deleteAddress(@PathVariable id: Long) = customers.deleteAddress(principal(), id)

    @PostMapping("/cart/claim")
    open fun claimCart(@RequestHeader(value = "X-Cart-Key", required = false) key: String?): Map<String, Any?> {
        val cartKey = cartKeyFrom(key)
        // Signing in keeps the browser cart: the same key becomes owned by this customer.
        carts.attach(cartKey, principal().customerId)
        return mapOf("cartKey" to cartKey, "attached" to true)
    }

    private fun principal(): CustomerPrincipal =
        Actor.requireCustomer()
}
