package com.kidsstore.service

import com.kidsstore.domain.ActorType
import com.kidsstore.domain.AuditLog
import com.kidsstore.domain.StoreSettings
import com.kidsstore.repo.StoreSettingsRepository
import com.kidsstore.security.AdminPrincipal
import com.kidsstore.repo.AuditLogRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.OffsetDateTime

@Service
open class StoreConfigService(private val repository: StoreSettingsRepository) {

    @Transactional(readOnly = true)
    open fun settings(): StoreSettings = repository.findById(SINGLETON_ID).orElseThrow {
        IllegalStateException("store_settings row 1 is missing - run the Flyway migrations")
    }

    @Transactional
    open fun save(settings: StoreSettings): StoreSettings {
        settings.updatedAt = OffsetDateTime.now()
        return repository.save(settings)
    }

    companion object {
        const val SINGLETON_ID = 1L
    }
}

@Service
open class AuditService(private val auditLogs: AuditLogRepository) {

    @Transactional
    open fun record(
        action: String,
        entityType: String,
        entityId: Any?,
        summary: String,
        changes: String? = null,
        admin: AdminPrincipal? = null,
        actorType: ActorType = if (admin != null) ActorType.ADMIN else ActorType.SYSTEM,
        actorEmail: String? = admin?.actorEmail ?: "system",
        ipAddress: String? = null,
    ): AuditLog = auditLogs.save(
        AuditLog().apply {
            this.adminId = admin?.id
            this.actorEmail = actorEmail
            this.actorType = actorType
            this.action = action
            this.entityType = entityType
            this.entityId = entityId?.toString()
            this.summary = summary
            this.changes = changes
            this.ipAddress = ipAddress
            this.createdAt = OffsetDateTime.now()
        }
    )
}
