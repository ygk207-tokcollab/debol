package com.kidsstore.config

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * All runtime configuration comes from environment variables (see .env.example). Nothing here
 * contains a secret value.
 *
 * Plain mutable-bean style on purpose: constructor binding would make every unset key nullable.
 */
@ConfigurationProperties(prefix = "kidsstore")
class AppProperties {
    var telegram: Telegram = Telegram()
    var security: Security = Security()
    var storage: Storage = Storage()
    var store: Store = Store()

    class Telegram {
        /** Set only through TELEGRAM_BOT_TOKEN. Never returned by any endpoint. */
        var botToken: String? = null
        var apiBaseUrl: String = "https://api.telegram.org"
        var enabled: Boolean = true
        /** Long polling worker: handles /start pairing and inline button callbacks. */
        var pollingEnabled: Boolean = true
        var pollingTimeoutSeconds: Int = 25
        var adminContactPhone: String = "0911526922"
        var pairingCodeTtlMinutes: Int = 15
        /** Reject callbacks whose chat id is not the registered admin chat. */
        var enforceCallbackChat: Boolean = true
        var dispatchBatchSize: Int = 10
        var dispatchIntervalMs: Long = 5000
        var backoffBaseSeconds: Int = 15
        var backoffMaxSeconds: Int = 1800
        var maxAttempts: Int = 8
    }

    class Security {
        /** 32+ bytes, from JWT_SECRET. */
        var jwtSecret: String = ""
        var adminTokenMinutes: Long = 480
        var customerTokenDays: Long = 30
        var allowedOrigins: List<String> = listOf("http://localhost:5173")
        /** Local-development authentication. Refused when the active profile is prod. */
        var devAuthEnabled: Boolean = false
        /** Phone+name sessions are only safe behind Telegram or an OTP provider. */
        var allowPhoneLogin: Boolean = true
        var loginAttemptsPerMinute: Int = 5
        var checkoutAttemptsPerMinute: Int = 10
        var initDataMaxAgeSeconds: Long = 86400
    }

    class Storage {
        var driver: String = "local"
        var localDir: String = "./data/uploads"
        var publicBaseUrl: String = "/api/v1/media"
        var maxUploadBytes: Long = 8_388_608
    }

    class Store {
        /** Used the first time the database is migrated. */
        var bootstrapAdminEmail: String = ""
        var bootstrapAdminPassword: String = ""
        var bootstrapAdminName: String = "Store owner"
        var currencyLabel: String = "ETB"
    }
}
