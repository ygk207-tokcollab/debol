package com.kidsstore.admin

import com.kidsstore.common.badRequest
import com.kidsstore.domain.OrderStatus
import com.kidsstore.domain.ProductStatus
import com.kidsstore.security.Actor
import com.kidsstore.security.AdminPrincipal
import com.kidsstore.service.AdminActorRef
import com.kidsstore.service.OrderStatusService
import com.kidsstore.storage.StorageService
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import java.math.BigDecimal
import java.time.OffsetDateTime

data class TransitionRequest(val note: String? = null)

data class CancelBody(@field:NotBlank val reason: String = "", val restoreStock: Boolean? = null)

data class CashBody(val amount: BigDecimal? = null, val collectedBy: String? = null, val note: String? = null)

data class CourierBody(val courierName: String? = null, val courierPhone: String? = null)

data class TelegramRegisterBody(val telegramUserId: Long = 0, val chatId: Long = 0)

data class TelegramConfigBody(
    val contactPhone: String? = null,
    val botUsername: String? = null,
    val miniAppUrl: String? = null,
    val adminNotifyUrl: String? = null,
    val enabled: Boolean? = null,
)

data class ImageLinkBody(
    @field:NotBlank val url: String = "",
    val storageKey: String? = null,
    val altEn: String? = null,
    val isPrimary: Boolean = false,
)

private fun actor(): AdminPrincipal = Actor.requireAdmin()

@RestController
@RequestMapping("/api/v1/admin/auth")
open class AdminAuthController(
    private val auth: AdminAuthService,
    private val ops: AdminOpsService,
) {
    @PostMapping("/login")
    open fun login(@Valid @RequestBody request: AdminLoginRequest, http: HttpServletRequest) = auth.login(request, http)

    @PostMapping("/dev-login")
    open fun devLogin(http: HttpServletRequest) = auth.devLogin(http)

    @GetMapping("/me")
    open fun me(): Map<String, Any?> {
        val admin = actor()
        return mapOf(
            "id" to admin.id, "email" to admin.email, "fullName" to admin.fullName,
            "role" to admin.role.name, "permissions" to auth.permissionsOf(admin.role),
        )
    }

    /** Signing out means invalidating every token issued for this account. */
    @PostMapping("/revoke")
    open fun revoke(): Map<String, Any?> {
        val admin = actor()
        return ops.resetAdministratorToken(admin.id, admin)
    }
}

@RestController
@RequestMapping("/api/v1/admin/dashboard")
open class AdminDashboardController(private val ops: AdminOpsService) {
    @GetMapping
    open fun dashboard(): Map<String, Any?> = ops.dashboard()
}

@RestController
@RequestMapping("/api/v1/admin")
open class AdminCatalogController(
    private val catalog: AdminCatalogService,
    private val storage: StorageService,
) {
    @GetMapping("/products")
    open fun list(@RequestParam(required = false) q: String?,
                  @RequestParam(required = false) status: String?,
                  @RequestParam(required = false) category: String?,
                  @RequestParam(defaultValue = "0") page: Int,
                  @RequestParam(defaultValue = "20") pageSize: Int) = catalog.list(q, status, category, page, pageSize)

    @GetMapping("/products/{id}")
    open fun product(@PathVariable id: Long) = catalog.byId(id)

    @PostMapping("/products")
    open fun create(@Valid @RequestBody request: ProductUpsertRequest): ProductAdminDto = catalog.create(request, actor())

    @PutMapping("/products/{id}")
    open fun update(@PathVariable id: Long, @Valid @RequestBody request: ProductUpsertRequest): ProductAdminDto =
        catalog.update(id, request, actor())

    @PostMapping("/products/{id}/status")
    open fun status(@PathVariable id: Long, @RequestParam status: String): ProductAdminDto {
        val parsed = ProductStatus.entries.firstOrNull { it.name.equals(status, true) }
            ?: throw badRequest("invalid_status", "Status must be DRAFT, PUBLISHED or ARCHIVED")
        return catalog.setStatus(id, parsed, actor())
    }

    @PostMapping("/products/{id}/featured")
    open fun featured(@PathVariable id: Long, @RequestParam(defaultValue = "true") featured: Boolean): ProductAdminDto =
        catalog.setFeatured(id, featured, actor())

    @DeleteMapping("/products/{id}")
    open fun delete(@PathVariable id: Long) = catalog.delete(id, actor())

    @PostMapping("/products/{id}/images")
    open fun linkImage(@PathVariable id: Long, @Valid @RequestBody body: ImageLinkBody): ImageAdminDto =
        catalog.addImage(id, body.url.trim(), body.storageKey?.trim(), body.altEn?.trim(), body.isPrimary, actor())

    @PostMapping("/products/{id}/image-upload")
    open fun uploadImage(@PathVariable id: Long,
                         @RequestPart("file") file: MultipartFile,
                         @RequestParam(required = false) altEn: String?,
                         @RequestParam(defaultValue = "false") isPrimary: Boolean): Map<String, Any?> {
        val stored = storage.store(file, "products")
        val image = catalog.addImage(id, stored.url, stored.storageKey, altEn, isPrimary, actor())
        return mapOf("uploaded" to true, "url" to stored.url, "storageKey" to stored.storageKey, "image" to image)
    }

    @PostMapping("/images/{imageId}/primary")
    open fun primaryImage(@PathVariable imageId: Long) = catalog.makePrimaryImage(imageId, actor())

    @DeleteMapping("/images/{imageId}")
    open fun deleteImage(@PathVariable imageId: Long) = catalog.deleteImage(imageId, actor())

    @PostMapping("/variants/{variantId}/stock")
    open fun adjustStock(@PathVariable variantId: Long, @Valid @RequestBody request: StockAdjustRequest) =
        catalog.adjustStock(variantId, request, actor())

    @PatchMapping("/variants/{variantId}")
    open fun patchVariant(@PathVariable variantId: Long,
                          @RequestParam(required = false) lowStockThreshold: Int?,
                          @RequestParam(required = false) active: Boolean?) =
        catalog.setVariantThreshold(variantId, lowStockThreshold, active, actor())

    @GetMapping("/inventory")
    open fun inventory(@RequestParam(required = false) filter: String?) = catalog.inventory(filter)

    @GetMapping("/inventory/movements")
    open fun movements(@RequestParam(required = false) variantId: Long?,
                       @RequestParam(defaultValue = "0") page: Int,
                       @RequestParam(defaultValue = "50") size: Int) = catalog.movementHistory(variantId, page, size)

    @GetMapping("/categories")
    open fun categories() = catalog.listCategories()

    @GetMapping("/age-groups")
    open fun ageGroups() = catalog.listAgeGroups()

    @PostMapping("/age-groups")
    open fun createAgeGroup(@Valid @RequestBody request: AgeGroupUpsertRequest) =
        catalog.saveAgeGroup(null, request, actor())

    @PutMapping("/age-groups/{id}")
    open fun updateAgeGroup(@PathVariable id: Long, @Valid @RequestBody request: AgeGroupUpsertRequest) =
        catalog.saveAgeGroup(id, request, actor())

    @PostMapping("/categories")
    open fun createCategory(@Valid @RequestBody request: CategoryUpsertRequest) = catalog.saveCategory(null, request, actor())

    @PutMapping("/categories/{id}")
    open fun updateCategory(@PathVariable id: Long, @Valid @RequestBody request: CategoryUpsertRequest) =
        catalog.saveCategory(id, request, actor())
}

@RestController
@RequestMapping("/api/v1/admin/orders")
open class AdminOrderController(
    private val ops: AdminOpsService,
    private val status: OrderStatusService,
) {
    @GetMapping
    open fun search(@RequestParam(required = false) q: String?,
                    @RequestParam(required = false) status: String?,
                    @RequestParam(required = false) paymentStatus: String?,
                    @RequestParam(required = false) from: OffsetDateTime?,
                    @RequestParam(required = false) to: OffsetDateTime?,
                    @RequestParam(defaultValue = "0") page: Int,
                    @RequestParam(defaultValue = "20") size: Int) =
        ops.searchOrders(q, status, paymentStatus, from, to, page, size)

    @GetMapping("/{id}")
    open fun detail(@PathVariable id: Long) = ops.orderDetail(id)

    @PostMapping("/{id}/status")
    open fun transition(@PathVariable id: Long, @RequestParam target: String,
                        @RequestBody(required = false) body: TransitionRequest?,
                        http: HttpServletRequest): Map<String, Any?> {
        val admin = actor()
        val parsed = OrderStatus.entries.firstOrNull { it.name.equals(target, true) }
            ?: throw badRequest("invalid_status", "Unknown order status")
        val order = status.transition(id, parsed, com.kidsstore.domain.ActorType.ADMIN, admin.actorEmail,
            body?.note, AdminActorRef(admin), http.remoteAddr)
        return mapOf("id" to order.id, "orderNumber" to order.orderNumber, "status" to order.status.name,
            "paymentStatus" to order.paymentStatus.name)
    }

    @PostMapping("/{id}/cancel")
    open fun cancel(@PathVariable id: Long, @Valid @RequestBody body: CancelBody, http: HttpServletRequest): Map<String, Any?> {
        val admin = actor()
        val order = status.cancel(id, body.reason, com.kidsstore.domain.ActorType.ADMIN, admin.actorEmail,
            AdminActorRef(admin), http.remoteAddr, body.restoreStock)
        return mapOf("orderNumber" to order.orderNumber, "status" to order.status.name,
            "stockRestored" to order.stockRestored, "reason" to order.cancellationReason)
    }

    @PostMapping("/{id}/cash-collection")
    open fun cash(@PathVariable id: Long, @RequestBody body: CashBody, http: HttpServletRequest): Map<String, Any?> {
        val admin = actor()
        val collectedBy = body.collectedBy?.takeIf { it.isNotBlank() } ?: admin.actorEmail
        val order = status.recordCashCollection(id, collectedBy, body.amount, AdminActorRef(admin),
            com.kidsstore.domain.ActorType.ADMIN, http.remoteAddr)
        return mapOf("orderNumber" to order.orderNumber, "paymentStatus" to order.paymentStatus.name,
            "amountCollected" to order.amountCollected, "collectedBy" to order.paymentCollectedBy,
            "collectedAt" to order.paymentCollectedAt)
    }

    @PostMapping("/{id}/courier")
    open fun courier(@PathVariable id: Long, @RequestBody body: CourierBody) =
        status.assignCourier(id, body.courierName, body.courierPhone, actor().actorEmail).let {
            mapOf("courierName" to it.courierName, "courierPhone" to it.courierPhone)
        }

    @PostMapping("/{id}/notification-retry")
    open fun retryNotifications(@PathVariable id: Long) = ops.retryForOrder(id, actor())
}

@RestController
@RequestMapping("/api/v1/admin")
open class AdminSettingsController(private val ops: AdminOpsService) {
    @GetMapping("/settings")
    open fun settings(): Map<String, Any?> = ops.settingsView()

    @PutMapping("/settings")
    open fun saveSettings(@Valid @RequestBody request: SettingsRequest, http: HttpServletRequest): Map<String, Any?> =
        ops.saveSettings(request, actor(), http.remoteAddr)

    @GetMapping("/delivery-zones")
    open fun zones() = ops.listZones()

    @PostMapping("/delivery-zones")
    open fun createZone(@Valid @RequestBody request: ZoneRequest) = ops.saveZone(null, request, actor())

    @PutMapping("/delivery-zones/{id}")
    open fun updateZone(@PathVariable id: Long, @Valid @RequestBody request: ZoneRequest) = ops.saveZone(id, request, actor())

    @PatchMapping("/delivery-zones/{id}")
    open fun toggleZone(@PathVariable id: Long, @RequestParam active: Boolean) = ops.toggleZone(id, active, actor())

    @GetMapping("/administrators")
    open fun administrators() = ops.listAdministrators()

    @PostMapping("/administrators")
    open fun createAdministrator(@Valid @RequestBody request: AdministratorRequest) =
        ops.saveAdministrator(null, request, actor())

    @PutMapping("/administrators/{id}")
    open fun updateAdministrator(@PathVariable id: Long, @Valid @RequestBody request: AdministratorRequest) =
        ops.saveAdministrator(id, request, actor())

    @PostMapping("/administrators/{id}/revoke")
    open fun revokeAdministrator(@PathVariable id: Long) = ops.resetAdministratorToken(id, actor())
}

@RestController
@RequestMapping("/api/v1/admin")
open class AdminNotificationController(private val ops: AdminOpsService) {
    @GetMapping("/notifications")
    open fun history(@RequestParam(required = false) status: String?,
                     @RequestParam(required = false) event: String?,
                     @RequestParam(defaultValue = "0") page: Int,
                     @RequestParam(defaultValue = "25") size: Int) = ops.notificationHistory(status, event, page, size)

    @PostMapping("/notifications/{id}/retry")
    open fun retry(@PathVariable id: Long) = ops.retryNotification(id, actor())

    @PostMapping("/notifications/retry-all")
    open fun retryAll() = ops.retryAllFailed(actor())

    @PostMapping("/notifications/dispatch")
    open fun dispatch() = ops.dispatchNow(actor())

    @PostMapping("/notifications/test")
    open fun test() = ops.sendTest(actor())

    @GetMapping("/audit")
    open fun audit(@RequestParam(required = false) entityType: String?,
                   @RequestParam(required = false) entityId: String?,
                   @RequestParam(defaultValue = "0") page: Int,
                   @RequestParam(defaultValue = "50") size: Int) = ops.auditTrail(entityType, entityId, page, size)
}

@RestController
@RequestMapping("/api/v1/admin/telegram")
open class AdminTelegramController(private val ops: AdminOpsService) {
    @GetMapping("/status")
    open fun status(): Map<String, Any?> = ops.telegramStatus()

    @PutMapping("/config")
    open fun config(@RequestBody body: TelegramConfigBody): Map<String, Any?> = ops.saveTelegramConfig(
        body.contactPhone, body.botUsername, body.miniAppUrl, body.adminNotifyUrl, body.enabled, actor(),
    )

    @PostMapping("/pairing-code")
    open fun pairingCode(): Map<String, Any?> = ops.issuePairingCode(actor())

    @PostMapping("/register")
    open fun register(@RequestBody body: TelegramRegisterBody): Map<String, Any?> =
        ops.registerTelegramManually(body.telegramUserId, body.chatId, actor())
}
