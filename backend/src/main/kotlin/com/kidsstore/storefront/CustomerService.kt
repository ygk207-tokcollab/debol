package com.kidsstore.storefront

import com.kidsstore.common.EthiopianPhone
import com.kidsstore.common.Tokens
import com.kidsstore.common.badRequest
import com.kidsstore.common.conflict
import com.kidsstore.common.forbidden
import com.kidsstore.domain.Customer
import com.kidsstore.domain.CustomerAddress
import com.kidsstore.domain.CustomerSession
import com.kidsstore.domain.Order
import com.kidsstore.domain.SessionSource
import com.kidsstore.domain.TelegramAccount
import com.kidsstore.repo.CustomerAddressRepository
import com.kidsstore.repo.CustomerRepository
import com.kidsstore.repo.CustomerSessionRepository
import com.kidsstore.repo.OrderRepository
import com.kidsstore.repo.TelegramAccountRepository
import com.kidsstore.security.CustomerPrincipal
import com.kidsstore.security.JwtService
import com.kidsstore.security.RateLimiter
import com.kidsstore.security.TelegramInitDataVerifier
import com.kidsstore.service.OrderDetailDto
import com.kidsstore.service.OrderViews
import com.kidsstore.service.StoreConfigService
import com.kidsstore.config.AppProperties
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.constraints.NotBlank
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.OffsetDateTime

data class CustomerProfileDto(
    val fullName: String,
    val phone: String,
    val secondaryPhone: String?,
    val telegramLinked: Boolean,
    val currency: String,
)

data class AddressDto(
    val id: Long,
    val label: String?,
    val region: String,
    val city: String,
    val subCity: String?,
    val neighborhood: String?,
    val addressLine: String,
    val instructions: String?,
    val isDefault: Boolean,
)

data class AddressRequest(
    val label: String? = null,
    @field:NotBlank val region: String = "",
    @field:NotBlank val city: String = "",
    val subCity: String? = null,
    val neighborhood: String? = null,
    @field:NotBlank val addressLine: String = "",
    val instructions: String? = null,
    val isDefault: Boolean = false,
)

/** Issues and revokes customer sessions. Only ever stores the hash of a session token. */
@Service
open class CustomerSessionService(
    private val sessions: CustomerSessionRepository,
    private val jwt: JwtService,
    private val props: AppProperties,
) {
    @Transactional
    open fun issue(customer: Customer, telegramUserId: Long?): String? {
        val source = if (telegramUserId != null) SessionSource.TELEGRAM else SessionSource.WEB_PHONE
        if (source == SessionSource.WEB_PHONE && !props.security.allowPhoneLogin) return null
        val raw = Tokens.urlSafe(32)
        sessions.save(
            CustomerSession().apply {
                this.customer = customer
                this.tokenHash = Tokens.sha256Hex(raw)
                this.source = source
                this.telegramUserId = telegramUserId
                this.expiresAt = OffsetDateTime.now().plusDays(props.security.customerTokenDays)
                this.revoked = false
                this.createdAt = OffsetDateTime.now()
            }
        )
        return jwt.issueCustomerToken(customer.id!!, telegramUserId, source, Tokens.sha256Hex(raw))
    }

    @Transactional
    open fun revoke(tokenHash: String) {
        sessions.findByTokenHash(tokenHash)?.let { session ->
            session.revoked = true
            sessions.save(session)
        }
    }
}

@Service
open class CustomerService(
    private val customers: CustomerRepository,
    private val telegramAccounts: TelegramAccountRepository,
    private val addresses: CustomerAddressRepository,
    private val orders: OrderRepository,
    private val orderViews: OrderViews,
    private val orderStatus: com.kidsstore.service.OrderStatusService,
    private val sessions: CustomerSessionService,
    private val verifier: TelegramInitDataVerifier,
    private val rateLimiter: RateLimiter,
    private val storeConfig: StoreConfigService,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * Telegram identity is accepted only after the signed initData verifies on the server. A user id
     * posted by the browser is never proof of anything.
     */
    @Transactional
    open fun telegramLogin(initData: String, http: HttpServletRequest): Map<String, Any?> {
        rateLimiter.check(RateLimiter.Kind.CUSTOMER_AUTH, http.remoteAddr ?: "unknown")
        val verified = verifier.verify(initData)
        val user = verified.user
        val account = telegramAccounts.findByTelegramUserId(user.telegramUserId)
        val customer = account?.customer
            ?: customers.save(
                Customer().apply {
                    // No phone is known yet; it is collected at checkout and merged in.
                    this.fullName = listOfNotNull(user.firstName, user.lastName).joinToString(" ").ifBlank { "Telegram customer" }
                    this.phone = telegramPlaceholder(user.telegramUserId)
                    this.createdAt = OffsetDateTime.now()
                }
            ).let { newCustomer ->
                telegramAccounts.save(
                    TelegramAccount().apply {
                        this.customer = newCustomer
                        this.telegramUserId = user.telegramUserId
                        this.telegramUsername = user.username
                        this.firstName = user.firstName
                        this.lastName = user.lastName
                        this.languageCode = user.languageCode
                        this.photoUrl = user.photoUrl
                        this.verifiedAt = OffsetDateTime.now()
                        this.createdAt = OffsetDateTime.now()
                    }
                )
                newCustomer
            }
        val token = sessions.issue(customer, user.telegramUserId)
            ?: throw conflict("session_disabled", "Customer sessions are disabled on this deployment")
        log.info("Telegram customer {} signed in (verified initData)", user.telegramUserId)
        return mapOf(
            "token" to token,
            "profile" to profile(CustomerPrincipal(customer.id!!, customer.phone, SessionSource.TELEGRAM,
                user.telegramUserId, "")),
        )
    }

    /**
     * Standalone-web sign-in without Telegram. Because there is no SMS provider configured, ownership
     * is proven with an order this phone already placed (order number + its public receipt token).
     */
    @Transactional
    open fun phoneLogin(phoneRaw: String, orderNumber: String, publicToken: String, http: HttpServletRequest): Map<String, Any?> {
        rateLimiter.check(RateLimiter.Kind.CUSTOMER_AUTH, http.remoteAddr ?: "unknown")
        val phone = EthiopianPhone.normalize(phoneRaw)
            ?: throw badRequest("invalid_phone", "Enter a valid Ethiopian phone number such as 0912345678")
        val customer = customers.findByPhone(phone)
            ?: throw badRequest("no_account", "No order found for this number yet")
        val order = orders.findByOrderNumber(orderNumber.trim().uppercase())
        if (order == null || order.publicToken != publicToken || order.customer?.id != customer.id) {
            throw forbidden("Verification failed: use the order number and receipt link from your confirmation screen")
        }
        val token = sessions.issue(customer, telegramAccounts.findByCustomerId(customer.id!!)?.telegramUserId)
            ?: throw conflict("session_disabled", "Customer sessions are disabled on this deployment")
        return mapOf(
            "token" to token,
            "profile" to profile(CustomerPrincipal(customer.id!!, customer.phone, SessionSource.WEB_PHONE, null, "")),
        )
    }

    @Transactional
    open fun logout(principal: CustomerPrincipal) {
        sessions.revoke(principal.sessionTokenHash)
    }

    @Transactional(readOnly = true)
    open fun profile(principal: CustomerPrincipal): CustomerProfileDto {
        val customer = requireCustomer(principal)
        return CustomerProfileDto(
            fullName = customer.fullName,
            // A placeholder from a Telegram sign-in is not a real number; show it only after checkout.
            phone = if (customer.phone.startsWith("tg")) "" else customer.phone,
            secondaryPhone = customer.secondaryPhone,
            telegramLinked = telegramAccounts.findByCustomerId(customer.id!!) != null,
            currency = storeConfig.settings().currency,
        )
    }

    @Transactional
    open fun updateProfile(principal: CustomerPrincipal, fullName: String?): CustomerProfileDto {
        val customer = requireCustomer(principal)
        fullName?.takeIf { it.isNotBlank() }?.let { customer.fullName = it.trim() }
        customers.save(customer)
        return profile(principal)
    }

    @Transactional(readOnly = true)
    open fun listAddresses(principal: CustomerPrincipal): List<AddressDto> =
        addresses.findAllByCustomerIdOrderByCreatedAtDesc(principal.customerId).map { toDto(it) }

    @Transactional
    open fun addAddress(principal: CustomerPrincipal, request: AddressRequest): AddressDto {
        val customer = requireCustomer(principal)
        val list = addresses.findAllByCustomerIdOrderByCreatedAtDesc(customer.id!!)
        val address = addresses.save(
            CustomerAddress().apply {
                this.customer = customer
                this.label = request.label?.trim()
                this.region = request.region.trim()
                this.city = request.city.trim()
                this.subCity = request.subCity?.trim()
                this.neighborhood = request.neighborhood?.trim()
                this.addressLine = request.addressLine.trim()
                this.instructions = request.instructions?.trim()
                this.isDefault = request.isDefault || list.isEmpty()
                this.createdAt = OffsetDateTime.now()
            }
        )
        if (address.isDefault) clearDefault(customer.id!!, address.id!!)
        return toDto(address)
    }

    @Transactional
    open fun deleteAddress(principal: CustomerPrincipal, addressId: Long): Map<String, Boolean> {
        val address = addresses.findById(addressId).orElseThrow { com.kidsstore.common.notFound("address_not_found", "Address not found") }
        if (address.customer?.id != principal.customerId) throw forbidden("That address belongs to another account")
        addresses.delete(address)
        return mapOf("deleted" to true)
    }

    @Transactional(readOnly = true)
    open fun myOrders(principal: CustomerPrincipal): List<Map<String, Any?>> {
        val own = orders.findAllByCustomerIdOrderByCreatedAtDesc(principal.customerId)
        val telegramOrders = principal.telegramUserId?.let { orders.findAllByTelegramUserId(it) } ?: emptyList()
        val merged = (own + telegramOrders).distinctBy { it.id }.sortedByDescending { it.createdAt }
        val summaries = orderViews.summaries(merged).associateBy { it.id }
        return merged.mapNotNull { order ->
            summaries[order.id]?.let { mapOf("summary" to it, "publicToken" to order.publicToken) }
        }
    }

    @Transactional(readOnly = true)
    open fun myOrder(principal: CustomerPrincipal, orderId: Long): OrderDetailDto {
        ownedOrder(principal, orderId)
        return orderViews.detail(orderId, adminView = false)
    }

    @Transactional
    open fun requestCancellation(principal: CustomerPrincipal, orderId: Long, reason: String): Map<String, Any?> {
        val order = ownedOrder(principal, orderId)
        val updated = orderStatus.requestCustomerCancellation(order, reason)
        return mapOf(
            "orderNumber" to updated.orderNumber,
            "status" to updated.status.name,
            "cancelRequested" to (updated.cancelRequestedAt != null),
            "message" to "Request sent. The store will confirm the cancellation.",
        )
    }

    private fun ownedOrder(principal: CustomerPrincipal, orderId: Long): Order {
        val order = orderViews.load(orderId)
        val ownsIt = order.customer?.id == principal.customerId ||
            (principal.telegramUserId != null && order.telegramUserId == principal.telegramUserId)
        // Customers must never read another customer's order.
        if (!ownsIt) throw forbidden("order_not_yours", "That order belongs to another account")
        return order
    }

    private fun requireCustomer(principal: CustomerPrincipal): Customer =
        customers.findById(principal.customerId).orElseThrow { forbidden("Account no longer exists") }

    private fun clearDefault(customerId: Long, keepId: Long) {
        addresses.findAllByCustomerIdOrderByCreatedAtDesc(customerId)
            .filter { it.id != keepId && it.isDefault }
            .forEach { it.isDefault = false; addresses.save(it) }
    }

    private fun toDto(it: CustomerAddress) = AddressDto(
        id = it.id!!, label = it.label, region = it.region, city = it.city, subCity = it.subCity,
        neighborhood = it.neighborhood, addressLine = it.addressLine, instructions = it.instructions,
        isDefault = it.isDefault,
    )

    companion object {
        /** Customers created from Telegram before checkout keep an unusable placeholder number. */
        fun telegramPlaceholder(telegramUserId: Long): String = "tg${telegramUserId}".take(32)
    }
}
