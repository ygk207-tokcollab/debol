package com.kidsstore.admin

import com.kidsstore.common.EthiopianPhone
import com.kidsstore.common.FieldMessage
import com.kidsstore.common.Money
import com.kidsstore.common.badRequest
import com.kidsstore.common.conflict
import com.kidsstore.common.notFound
import com.kidsstore.config.AppProperties
import com.kidsstore.domain.AdminRole
import com.kidsstore.domain.Administrator
import com.kidsstore.domain.ActorType
import com.kidsstore.domain.DeliveryZone
import com.kidsstore.domain.OutboxStatus
import com.kidsstore.domain.OrderStatus
import com.kidsstore.domain.PaymentStatus
import com.kidsstore.domain.NotificationOutbox
import com.kidsstore.repo.AdministratorRepository
import com.kidsstore.repo.AuditLogRepository
import com.kidsstore.repo.DeliveryZoneRepository
import com.kidsstore.repo.NotificationOutboxRepository
import com.kidsstore.repo.OrderRepository
import com.kidsstore.repo.ProductRepository
import com.kidsstore.repo.ProductVariantRepository
import com.kidsstore.security.AdminPrincipal
import com.kidsstore.service.AuditService
import com.kidsstore.service.OrderViews
import com.kidsstore.service.StoreConfigService
import com.kidsstore.telegram.NotificationService
import com.kidsstore.telegram.OutboxDispatcher
import com.kidsstore.telegram.TelegramBotClient
import com.kidsstore.telegram.TelegramPairingService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.data.domain.PageRequest
import org.springframework.data.jpa.domain.Specification
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset

data class SettingsRequest(
    @field:NotBlank val storeNameEn: String = "",
    val taglineEn: String? = null,
    val logoUrl: String? = null,
    @field:NotBlank val contactPhone: String = "",
    val contactSecondaryPhone: String? = null,
    val contactEmail: String? = null,
    val contactTelegramUsername: String? = null,
    val currency: String = "ETB",
    val lowStockThreshold: Int = 3,
    val allowCustomerCancelUntil: String = "PROCESSING",
    val restoreStockOnCancellation: Boolean = true,
    val requireAdminConfirmation: Boolean = true,
    val freeDeliveryOver: BigDecimal? = null,
    val miniAppUrl: String? = null,
    val botUsername: String? = null,
    val adminNotifyUrl: String? = null,
    val telegramEnabled: Boolean = true,
)

data class ZoneRequest(
    @field:NotBlank val nameEn: String = "",
    @field:NotBlank val region: String = "",
    @field:NotBlank val city: String = "",
    val subCity: String? = null,
    val fee: BigDecimal = BigDecimal.ZERO,
    val freeOver: BigDecimal? = null,
    val estimatedDays: Int = 2,
    val active: Boolean = true,
)

data class AdministratorRequest(
    @field:NotBlank val email: String = "",
    @field:NotBlank val fullName: String = "",
    val phone: String? = null,
    val role: String = "MANAGER",
    val password: String? = null,
    val active: Boolean = true,
)

@Service
open class AdminOpsService(
    private val orders: OrderRepository,
    private val orderViews: OrderViews,
    private val products: ProductRepository,
    private val variants: ProductVariantRepository,
    private val zones: DeliveryZoneRepository,
    private val administrators: AdministratorRepository,
    private val auditLogs: AuditLogRepository,
    private val outbox: NotificationOutboxRepository,
    private val storeConfig: StoreConfigService,
    private val audit: AuditService,
    private val notifications: NotificationService,
    private val pairing: TelegramPairingService,
    private val dispatcher: OutboxDispatcher,
    private val client: TelegramBotClient,
    private val props: AppProperties,
    private val passwordEncoder: org.springframework.security.crypto.password.PasswordEncoder,
) {

    /** Dashboard numbers are counted from PostgreSQL on every call; nothing is hardcoded. */
    @Transactional(readOnly = true)
    open fun dashboard(): Map<String, Any?> {
        val settings = storeConfig.settings()
        val zone = java.time.ZoneId.systemDefault()
        val today = LocalDate.now(zone).atStartOfDay(zone).toOffsetDateTime()
        val tomorrow = today.plusDays(1)
        val byStatus = orders.countByStatus().associate { it.status to it.total }
        val byPayment = orders.countByPaymentStatus().associate { it.paymentStatus to it.total }
        val lowStockThreshold = settings.lowStockThreshold
        val lowStock = variants.findAllActiveWithProduct().filter { variant ->
            variant.isLowStock(lowStockThreshold) || variant.stock == 0
        }.sortedBy { it.stock }.take(20).map { variant ->
            mapOf(
                "variantId" to variant.id, "product" to variant.product?.nameEn,
                "productSlug" to variant.product?.slug, "sizeLabel" to variant.sizeLabel,
                "colorName" to variant.colorName, "stock" to variant.stock,
                "threshold" to variant.lowStockThresholdOrDefault(lowStockThreshold),
                "outOfStock" to (variant.stock == 0),
            )
        }
        val bestSellers = orders.bestSellingProductIds(PageRequest.of(0, 8)).filter { it.productId != null }
        val bestSellingProducts = products.findAllById(bestSellers.mapNotNull { it.productId })
            .associateBy { it.id }
        val outboxCounts = outbox.countByStatus().associate { it.status to it.total }
        return mapOf(
            "generatedAt" to OffsetDateTime.now(),
            "currency" to settings.currency,
            "ordersToday" to orders.countCreatedBetween(today, tomorrow),
            "awaitingConfirmation" to (byStatus[OrderStatus.PENDING_CONFIRMATION] ?: 0),
            "inFulfilment" to ((byStatus[OrderStatus.CONFIRMED] ?: 0) + (byStatus[OrderStatus.PROCESSING] ?: 0) +
                (byStatus[OrderStatus.OUT_FOR_DELIVERY] ?: 0) + (byStatus[OrderStatus.FAILED_DELIVERY] ?: 0)),
            "deliveredTotal" to (byStatus[OrderStatus.DELIVERED] ?: 0),
            "cancelledTotal" to (byStatus[OrderStatus.CANCELLED] ?: 0),
            "collectedRevenue" to Money.parse(orders.collectedRevenue()),
            "orderedValueToday" to Money.parse(orders.orderedValueBetween(today, tomorrow)),
            "unpaidDelivered" to countUnpaidDelivered(),
            "ordersByStatus" to byStatus.mapKeys { it.key.name },
            "ordersByPaymentStatus" to byPayment.mapKeys { it.key.name },
            "lowStock" to lowStock,
            "bestSellers" to bestSellers.mapNotNull { row ->
                bestSellingProducts[row.productId]?.let { product ->
                    mapOf("productId" to product.id, "nameEn" to product.nameEn,
                        "slug" to product.slug, "unitsSold" to row.units)
                }
            },
            "notifications" to mapOf(
                "pending" to ((outboxCounts[OutboxStatus.PENDING] ?: 0) + (outboxCounts[OutboxStatus.RETRY] ?: 0)),
                "sent" to (outboxCounts[OutboxStatus.SENT] ?: 0),
                "deadLetter" to (outboxCounts[OutboxStatus.DEAD_LETTER] ?: 0),
            ),
            "telegram" to telegramStatus(),
        )
    }

    @Transactional(readOnly = true)
    open fun searchOrders(
        query: String?, status: String?, paymentStatus: String?, from: OffsetDateTime?, to: OffsetDateTime?,
        page: Int, size: Int,
    ): Map<String, Any?> {
        val spec = Specification<com.kidsstore.domain.Order> { root, _, cb ->
            val predicates = mutableListOf<jakarta.persistence.criteria.Predicate>()
            status?.takeIf { it.isNotBlank() }?.let { raw ->
                OrderStatus.entries.firstOrNull { it.name.equals(raw, true) }
                    ?.let { predicates += cb.equal(root.get<OrderStatus>("status"), it) }
            }
            paymentStatus?.takeIf { it.isNotBlank() }?.let { raw ->
                PaymentStatus.entries.firstOrNull { it.name.equals(raw, true) }
                    ?.let { predicates += cb.equal(root.get<PaymentStatus>("paymentStatus"), it) }
            }
            from?.let { predicates += cb.greaterThanOrEqualTo(root.get("createdAt"), it) }
            to?.let { predicates += cb.lessThan(root.get("createdAt"), it) }
            query?.takeIf { it.isNotBlank() }?.let { term ->
                val needle = term.trim()
                predicates += cb.or(
                    cb.like(cb.upper(root.get("orderNumber")), "%${needle.uppercase()}%"),
                    cb.like(root.get("customerPhone"), "%$needle%"),
                    cb.like(cb.lower(root.get("customerName")), "%${needle.lowercase()}%"),
                )
            }
            if (predicates.isEmpty()) null else cb.and(*predicates.toTypedArray())
        }
        val result = orders.findAll(spec,
            PageRequest.of(page.coerceAtLeast(0), size.coerceIn(1, 100),
                org.springframework.data.domain.Sort.by(org.springframework.data.domain.Sort.Direction.DESC, "createdAt")),
        )
        return mapOf(
            "items" to orderViews.summaries(result.content),
            "page" to result.number, "pageSize" to result.size,
            "totalPages" to result.totalPages, "totalElements" to result.totalElements,
        )
    }

    @Transactional(readOnly = true)
    open fun orderDetail(id: Long) = orderViews.detail(id, adminView = true)

    @Transactional(readOnly = true)
    open fun settingsView(): Map<String, Any?> {
        val s = storeConfig.settings()
        return mapOf(
            "storeNameEn" to s.storeNameEn,
            "taglineEn" to s.taglineEn, "logoUrl" to s.logoUrl,
            "contactPhone" to s.contactPhone, "contactSecondaryPhone" to s.contactSecondaryPhone,
            "contactEmail" to s.contactEmail, "contactTelegramUsername" to s.contactTelegramUsername,
            "currency" to s.currency,
            "lowStockThreshold" to s.lowStockThreshold,
            "allowCustomerCancelUntil" to s.allowCustomerCancelUntil.name,
            "restoreStockOnCancellation" to s.restoreStockOnCancellation,
            "requireAdminConfirmation" to s.requireAdminConfirmation,
            "freeDeliveryOver" to s.freeDeliveryOver, "miniAppUrl" to s.miniAppUrl,
            "botUsername" to s.botUsername, "adminNotifyUrl" to s.adminNotifyUrl,
            "telegramEnabled" to s.telegramEnabled,
            "updatedAt" to s.updatedAt,
        )
    }

    @Transactional
    open fun saveSettings(request: SettingsRequest, admin: AdminPrincipal, ipAddress: String?): Map<String, Any?> {
        val phone = EthiopianPhone.normalize(request.contactPhone)
            ?: throw badRequest("invalid_contact_phone", "Store contact number must be a valid Ethiopian number",
                listOf(FieldMessage("contactPhone", "Ethiopian numbers start with 09 or 07")))
        val secondary = request.contactSecondaryPhone?.takeIf { it.isNotBlank() }?.let {
            EthiopianPhone.normalize(it) ?: throw badRequest("invalid_secondary_phone",
                "Secondary number is not a valid Ethiopian number", listOf(FieldMessage("contactSecondaryPhone", "Invalid")))
        }
        if (request.lowStockThreshold < 0 || request.lowStockThreshold > 1000) {
            throw badRequest("invalid_threshold", "Low stock threshold must be between 0 and 1000",
                listOf(FieldMessage("lowStockThreshold", "Out of range")))
        }
        request.freeDeliveryOver?.let {
            if (it < BigDecimal.ZERO) throw badRequest("invalid_free_delivery", "Free delivery threshold cannot be negative")
        }
        val settings = storeConfig.settings()
        // Explicit field-by-field assignment: no mass assignment from the request body.
        settings.storeNameEn = request.storeNameEn.trim()
        settings.taglineEn = request.taglineEn?.trim()
        settings.logoUrl = request.logoUrl?.trim()
        settings.contactPhone = phone
        settings.contactSecondaryPhone = secondary
        settings.contactEmail = request.contactEmail?.trim()?.ifBlank { null }
        settings.contactTelegramUsername = request.contactTelegramUsername?.trim()?.trimStart('@')?.ifBlank { null }
        settings.currency = request.currency.trim().uppercase().take(8).ifBlank { "ETB" }
        settings.lowStockThreshold = request.lowStockThreshold
        settings.allowCustomerCancelUntil = OrderStatus.entries
            .firstOrNull { it.name.equals(request.allowCustomerCancelUntil, true) } ?: OrderStatus.PROCESSING
        settings.restoreStockOnCancellation = request.restoreStockOnCancellation
        settings.requireAdminConfirmation = request.requireAdminConfirmation
        settings.freeDeliveryOver = request.freeDeliveryOver?.let { Money.parse(it) }
        settings.miniAppUrl = request.miniAppUrl?.trim()?.ifBlank { null }
        settings.botUsername = request.botUsername?.trim()?.trimStart('@')?.ifBlank { null }
        settings.adminNotifyUrl = request.adminNotifyUrl?.trim()?.ifBlank { null }
        settings.telegramEnabled = request.telegramEnabled
        storeConfig.save(settings)
        audit.record("SETTINGS_UPDATED", "SETTINGS", 1, "Store settings changed", admin = admin,
            actorType = ActorType.ADMIN, ipAddress = ipAddress)
        return settingsView()
    }

    @Transactional(readOnly = true)
    open fun listZones(): List<Map<String, Any?>> = zones.findAll().sortedWith(compareBy({ it.region }, { it.city }, { it.subCity })).map {
        zoneMap(it)
    }

    @Transactional
    open fun saveZone(id: Long?, request: ZoneRequest, admin: AdminPrincipal): Map<String, Any?> {
        if (Money.parse(request.fee) < BigDecimal.ZERO) throw badRequest("invalid_fee", "Delivery fee cannot be negative",
            listOf(FieldMessage("fee", "Must be zero or more")))
        val zone = id?.let { zones.findById(it).orElseThrow { notFound("zone_not_found", "Delivery zone not found") } }
            ?: DeliveryZone()
        zone.nameEn = request.nameEn.trim()
        zone.region = request.region.trim()
        zone.city = request.city.trim()
        zone.subCity = request.subCity?.trim()?.ifBlank { null }
        zone.fee = Money.parse(request.fee)
        zone.freeOver = request.freeOver?.let { Money.parse(it) }
        zone.estimatedDays = request.estimatedDays.coerceIn(0, 60)
        zone.active = request.active
        if (zone.id == null) zone.createdAt = OffsetDateTime.now()
        val saved = zones.save(zone)
        audit.record(if (id == null) "ZONE_CREATED" else "ZONE_UPDATED", "DELIVERY_ZONE", saved.id,
            "${saved.region}/${saved.city} fee ${Money.format(saved.fee, storeConfig.settings().currency)}",
            admin = admin, actorType = ActorType.ADMIN)
        return zoneMap(saved)
    }

    @Transactional
    open fun toggleZone(id: Long, active: Boolean, admin: AdminPrincipal): Map<String, Any?> {
        val zone = zones.findById(id).orElseThrow { notFound("zone_not_found", "Delivery zone not found") }
        zone.active = active
        zones.save(zone)
        audit.record(if (active) "ZONE_ENABLED" else "ZONE_DISABLED", "DELIVERY_ZONE", id, "${zone.region}/${zone.city}",
            admin = admin, actorType = ActorType.ADMIN)
        return zoneMap(zone)
    }

    @Transactional(readOnly = true)
    open fun listAdministrators(): List<Map<String, Any?>> = administrators.findAll().map {
        mapOf("id" to it.id, "email" to it.email, "fullName" to it.fullName, "phone" to it.phone,
            "role" to it.role.name, "active" to it.active, "lastLoginAt" to it.lastLoginAt, "createdAt" to it.createdAt)
    }

    @Transactional
    open fun saveAdministrator(id: Long?, request: AdministratorRequest, admin: AdminPrincipal): Map<String, Any?> {
        val email = request.email.trim().lowercase()
        val role = AdminRole.entries.firstOrNull { it.name.equals(request.role, true) }
            ?: throw badRequest("invalid_role", "Role must be OWNER, MANAGER or DELIVERY_STAFF",
                listOf(FieldMessage("role", "Unknown role")))
        if (id == null) {
            if (administrators.findByEmailIgnoreCase(email) != null) {
                throw conflict("email_taken", "That email already has an administrator", listOf(FieldMessage("email", "Already used")))
            }
            val raw = request.password ?: throw badRequest("password_required", "A password is required for a new administrator",
                listOf(FieldMessage("password", "Required")))
            if (raw.length < 10) throw badRequest("weak_password", "Use at least 10 characters",
                listOf(FieldMessage("password", "Too short")))
            administrators.save(
                Administrator().apply {
                    this.email = email
                    this.fullName = request.fullName.trim()
                    this.phone = request.phone?.trim()
                    this.passwordHash = passwordEncoder.encode(raw)
                    this.role = role
                    this.active = request.active
                    this.tokenVersion = 0
                    this.createdAt = OffsetDateTime.now()
                }
            ).also {
                audit.record("ADMINISTRATOR_CREATED", "ADMINISTRATOR", it.id, "${it.email} as ${it.role.name}",
                    admin = admin, actorType = ActorType.ADMIN)
            }
        } else {
            val target = administrators.findById(id).orElseThrow { notFound("administrator_not_found", "Administrator not found") }
            val revoke = target.role != role || !request.active || !request.password.isNullOrBlank()
            target.fullName = request.fullName.trim()
            target.phone = request.phone?.trim()
            target.role = role
            target.active = request.active
            request.password?.takeIf { it.isNotBlank() }?.let { raw ->
                if (raw.length < 10) throw badRequest("weak_password", "Use at least 10 characters",
                    listOf(FieldMessage("password", "Too short")))
                target.passwordHash = passwordEncoder.encode(raw)
            }
            if (revoke) target.tokenVersion += 1
            administrators.save(target)
            audit.record("ADMINISTRATOR_UPDATED", "ADMINISTRATOR", target.id,
                "${target.email} role=${target.role.name} active=${target.active}", admin = admin, actorType = ActorType.ADMIN)
        }
        return mapOf("email" to email, "saved" to true)
    }

    @Transactional
    open fun resetAdministratorToken(id: Long, admin: AdminPrincipal): Map<String, Any?> {
        val target = administrators.findById(id).orElseThrow { notFound("administrator_not_found", "Administrator not found") }
        target.tokenVersion += 1
        administrators.save(target)
        audit.record("ADMINISTRATOR_SESSION_REVOKED", "ADMINISTRATOR", id, target.email,
            admin = admin, actorType = ActorType.ADMIN)
        return mapOf("revoked" to true)
    }

    @Transactional(readOnly = true)
    open fun auditTrail(entityType: String?, entityId: String?, page: Int, size: Int) =
        (if (entityType != null && entityId != null) auditLogs.findForEntity(entityType, entityId, PageRequest.of(page, size))
            else auditLogs.findRecent(PageRequest.of(page, size))).let { result ->
            mapOf(
                "items" to result.content.map {
                    mapOf("id" to it.id, "actorType" to it.actorType.name, "actor" to it.actorEmail,
                        "action" to it.action, "entityType" to it.entityType, "entityId" to it.entityId,
                        "summary" to it.summary, "changes" to it.changes, "ip" to it.ipAddress, "at" to it.createdAt)
                },
                "page" to result.number, "totalPages" to result.totalPages, "totalElements" to result.totalElements,
            )
        }

    @Transactional(readOnly = true)
    open fun notificationHistory(status: String?, event: String?, page: Int, size: Int): Map<String, Any?> {
        val result = outbox.findRecent(PageRequest.of(page.coerceAtLeast(0), size.coerceIn(1, 100)))
        val filtered = result.content.filter { row ->
            (status.isNullOrBlank() || row.status.name.equals(status, true)) &&
                (event.isNullOrBlank() || row.eventType.name.equals(event, true))
        }
        return mapOf(
            "items" to filtered.map { row ->
                mapOf(
                    "id" to row.id, "eventType" to row.eventType.name, "status" to row.status.name,
                    "attempts" to row.attempts, "maxAttempts" to row.maxAttempts,
                    "nextAttemptAt" to row.nextAttemptAt, "lastAttemptAt" to row.lastAttemptAt,
                    "sentAt" to row.sentAt, "lastError" to row.lastError, "chatId" to row.chatId,
                    "orderNumber" to row.order?.orderNumber, "adminLink" to row.adminLink,
                    "inlineActions" to row.inlineActions, "message" to row.message, "createdAt" to row.createdAt,
                )
            },
            "page" to result.number, "totalPages" to result.totalPages, "totalElements" to result.totalElements,
            "counts" to outbox.countByStatus().associate { it.status.name to it.total },
            "telegram" to telegramStatus(),
        )
    }

    @Transactional
    open fun retryNotification(id: Long, admin: AdminPrincipal): Map<String, Any?> {
        val row = outbox.findById(id).orElseThrow { notFound("notification_not_found", "Notification not found") }
        if (row.status == OutboxStatus.SENT) throw conflict("already_sent", "That notification was already delivered")
        requeue(row)
        audit.record("NOTIFICATION_RETRIED", "NOTIFICATION", id, "${row.eventType.name} for ${row.order?.orderNumber ?: "-"}",
            admin = admin, actorType = ActorType.ADMIN)
        return mapOf("id" to id, "status" to row.status.name, "queued" to true)
    }

    @Transactional
    open fun retryForOrder(orderId: Long, admin: AdminPrincipal): Map<String, Any?> {
        val rows = outbox.findForOrder(orderId).filter { it.status != OutboxStatus.SENT }
        rows.forEach { requeue(it) }
        audit.record("NOTIFICATIONS_RETRIED", "NOTIFICATION", null,
            "${rows.size} for order ${rows.firstOrNull()?.order?.orderNumber ?: orderId}",
            admin = admin, actorType = ActorType.ADMIN)
        return mapOf("retried" to rows.size, "telegram" to telegramStatus())
    }

    private fun requeue(row: NotificationOutbox) {
        val settings = storeConfig.settings()
        row.status = if (settings.telegramReady()) OutboxStatus.PENDING else OutboxStatus.RETRY
        // A fresh cycle: an operator asked for it, so the previous attempt count no longer applies.
        row.attempts = 0
        row.nextAttemptAt = OffsetDateTime.now()
        row.lockedUntil = null
        row.chatId = settings.telegramChatId ?: row.chatId
        row.lastError = if (settings.telegramReady()) null else "telegram_admin_not_paired"
        row.updatedAt = OffsetDateTime.now()
        outbox.save(row)
    }

    @Transactional
    open fun retryAllFailed(admin: AdminPrincipal): Map<String, Any?> {
        val settings = storeConfig.settings()
        val stuck = outbox.findRecent(PageRequest.of(0, 200)).content.filter {
            it.status == OutboxStatus.RETRY || it.status == OutboxStatus.DEAD_LETTER || it.status == OutboxStatus.PENDING
        }
        stuck.forEach { row ->
            row.status = if (settings.telegramReady()) OutboxStatus.PENDING else OutboxStatus.RETRY
            row.attempts = 0
            row.nextAttemptAt = OffsetDateTime.now()
            row.lockedUntil = null
            row.chatId = settings.telegramChatId ?: row.chatId
            row.updatedAt = OffsetDateTime.now()
            outbox.save(row)
        }
        audit.record("NOTIFICATIONS_RETRIED", "NOTIFICATION", null, "${stuck.size} queued", admin = admin, actorType = ActorType.ADMIN)
        return mapOf("queued" to stuck.size, "telegramReady" to settings.telegramReady())
    }

    /** Runs one dispatch cycle immediately so the admin panel can show real delivery results. */
    open fun dispatchNow(admin: AdminPrincipal): Map<String, Any?> {
        dispatcher.dispatch()
        audit.record("NOTIFICATIONS_DISPATCHED", "NOTIFICATION", null, "Manual dispatch", admin = admin, actorType = ActorType.ADMIN)
        return mapOf("dispatched" to true)
    }

    @Transactional
    open fun sendTest(admin: AdminPrincipal): Map<String, Any?> {
        notifications.enqueueTest("Test notification requested by ${admin.email} from the admin panel.")
        return mapOf("queued" to true, "telegram" to telegramStatus())
    }

    /** The token itself is never reported - only whether it exists. */
    @Transactional(readOnly = true)
    open fun telegramStatus(): Map<String, Any?> {
        val settings = storeConfig.settings()
        val pendingCodes = pairing.pendingCodes()
        return mapOf(
            "botTokenConfigured" to client.configured,
            "enabled" to settings.telegramEnabled,
            "setupComplete" to settings.telegramSetupComplete,
            "adminChatId" to settings.telegramChatId,
            "adminTelegramUserId" to settings.telegramUserId,
            "adminContactPhone" to (settings.telegramAdminContactPhone ?: props.telegram.adminContactPhone),
            "botUsername" to settings.botUsername,
            "miniAppUrl" to settings.miniAppUrl,
            "adminPanelUrl" to settings.adminNotifyUrl,
            "pollingEnabled" to props.telegram.pollingEnabled,
            "ready" to settings.telegramReady(),
            "warning" to when {
                !settings.telegramEnabled -> "Telegram notifications are switched off in store settings."
                !client.configured -> "No bot token is configured on the server (TELEGRAM_BOT_TOKEN), so nothing can be sent."
                !settings.telegramSetupComplete -> "The bot has no paired administrator chat yet: press Start in Telegram and enter a pairing code."
                else -> null
            },
            "pendingPairingCodes" to pendingCodes,
        )
    }

    @Transactional
    open fun issuePairingCode(admin: AdminPrincipal): Map<String, Any?> {
        val code = pairing.issueCode(admin.actorEmail)
        return mapOf("code" to code.code, "expiresAt" to code.expiresAt,
            "instructions" to "Open the bot in Telegram and send: /pair ${code.code}")
    }

    @Transactional
    open fun registerTelegramManually(telegramUserId: Long, chatId: Long, admin: AdminPrincipal): Map<String, Any?> {
        if (telegramUserId <= 0 || chatId == 0L) throw badRequest("invalid_ids", "Enter the real Telegram user id and chat id")
        pairing.registerManually(telegramUserId, chatId)
        audit.record("TELEGRAM_PAIRED_MANUALLY", "SETTINGS", 1, "chat $chatId / user $telegramUserId",
            admin = admin, actorType = ActorType.ADMIN)
        notifications.enqueueTest("Manual Telegram pairing by ${admin.email}.")
        return telegramStatus()
    }

    @Transactional
    open fun saveTelegramConfig(
        contactPhone: String?, botUsername: String?, miniAppUrl: String?, adminNotifyUrl: String?,
        enabled: Boolean?, admin: AdminPrincipal,
    ): Map<String, Any?> {
        val settings = storeConfig.settings()
        contactPhone?.takeIf { it.isNotBlank() }?.let {
            settings.telegramAdminContactPhone = EthiopianPhone.normalize(it)
                ?: throw badRequest("invalid_phone", "Admin contact must be a valid Ethiopian number",
                    listOf(FieldMessage("contactPhone", "Invalid")))
        }
        botUsername?.let { settings.botUsername = it.trim().trimStart('@').ifBlank { null } }
        miniAppUrl?.let { settings.miniAppUrl = it.trim().ifBlank { null } }
        adminNotifyUrl?.let { settings.adminNotifyUrl = it.trim().ifBlank { null } }
        enabled?.let { settings.telegramEnabled = it }
        storeConfig.save(settings)
        audit.record("TELEGRAM_CONFIG_UPDATED", "SETTINGS", 1, "bot @${settings.botUsername ?: "-"}",
            admin = admin, actorType = ActorType.ADMIN)
        return telegramStatus()
    }

    private fun countUnpaidDelivered(): Long =
        orders.count(Specification<com.kidsstore.domain.Order> { root, _, cb ->
            cb.and(
                cb.equal(root.get<OrderStatus>("status"), OrderStatus.DELIVERED),
                cb.notEqual(root.get<PaymentStatus>("paymentStatus"), PaymentStatus.PAID),
            )
        })

    private fun zoneMap(it: DeliveryZone) = mapOf(
        "id" to it.id, "nameEn" to it.nameEn, "region" to it.region, "city" to it.city,
        "subCity" to it.subCity, "fee" to Money.parse(it.fee), "freeOver" to it.freeOver,
        "estimatedDays" to it.estimatedDays, "active" to it.active,
    )
}
