package com.kidsstore.telegram

import com.fasterxml.jackson.databind.JsonNode
import com.kidsstore.config.AppProperties
import com.kidsstore.domain.NotificationOutbox
import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import java.time.Duration

/** The Bot API replied with something we can act on. */
class TelegramApiException(
    val method: String,
    val errorType: String,
    message: String,
    val retryable: Boolean,
    val retryAfterSeconds: Long? = null,
) : RuntimeException("Telegram $method failed: $message")

/**
 * Thin Bot API client. The token is read from configuration only and is never returned to any
 * caller or written to a log line.
 */
@Component
open class TelegramBotClient(private val props: AppProperties) {
    private val log = LoggerFactory.getLogger(javaClass)

    private val http = RestClient.builder()
        .requestFactory(
            org.springframework.http.client.SimpleClientHttpRequestFactory().apply {
                setConnectTimeout(Duration.ofSeconds(5))
                setReadTimeout(Duration.ofSeconds(15))
            }
        )
        .build()

    val configured: Boolean get() = !props.telegram.botToken.isNullOrBlank()

    fun sendMessage(
        chatId: Long,
        text: String,
        replyMarkup: Map<String, Any>? = null,
        disablePreview: Boolean = true,
    ): Long {
        val body = linkedMapOf<String, Any>(
            "chat_id" to chatId,
            "text" to text,
            "disable_web_page_preview" to disablePreview,
        )
        replyMarkup?.let { body["reply_markup"] = it }
        val response = call("sendMessage", body)
        require(response?.get("ok")?.asBoolean() == true) {
            val description = response?.get("description")?.asText() ?: "no response"
            val error_code = response?.get("error_code")?.asInt() ?: 0
            val retryAfter = response?.get("parameters")?.get("retry_after")?.asLong()
            val retryable = error_code == 429 || error_code >= 500 || error_code == 0
            throw TelegramApiException("sendMessage", describe(error_code), description, retryable, retryAfter)
        }
        return response.get("result")?.get("message_id")?.asLong() ?: 0
    }

    fun answerCallbackQuery(callbackQueryId: String, text: String? = null) {
        call("answerCallbackQuery", linkedMapOf("callback_query_id" to callbackQueryId, "text" to (text ?: "")))
    }

    fun getUpdates(offset: Long?, timeoutSeconds: Int): List<JsonNode> {
        val body = linkedMapOf<String, Any>(
            "timeout" to timeoutSeconds.coerceAtMost(50),
            "allowed_updates" to listOf("message", "callback_query"),
        )
        offset?.let { body["offset"] = it }
        val response = call("getUpdates", body, readTimeoutSeconds = timeoutSeconds + 10)
            ?: return emptyList()
        if (response.get("ok")?.asBoolean() != true) {
            throw TelegramApiException("getUpdates", "api_error",
                response.get("description")?.asText() ?: "unknown", retryable = true)
        }
        return response.get("result")?.toList() ?: emptyList()
    }

    private fun describe(code: Int): String = when (code) {
        400 -> "bad_request"
        401 -> "unauthorized"
        403 -> "forbidden"
        404 -> "not_found"
        429 -> "flood_control"
        else -> if (code >= 500) "telegram_server_error" else "api_error"
    }

    private fun call(method: String, body: Map<String, Any>, readTimeoutSeconds: Int = 15): JsonNode? {
        val token = props.telegram.botToken
            ?: throw TelegramApiException(method, "not_configured", "Bot token is not configured", retryable = false)
        return try {
            http.post()
                .uri("${props.telegram.apiBaseUrl}/bot${token}/${method}")
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(JsonNode::class.java)
        } catch (ex: org.springframework.web.client.HttpClientErrorException) {
            // Telegram returns errors as JSON bodies with error_code; parse them for retry decisions.
            parseError(method, ex.responseBodyAsString) ?: run {
                throw TelegramApiException(method, "http_${ex.statusCode.value()}", ex.statusCode.toString(),
                    retryable = ex.statusCode.value() == 429)
            }
        } catch (ex: org.springframework.web.client.HttpServerErrorException) {
            throw TelegramApiException(method, "telegram_server_error", ex.message ?: "server error", retryable = true)
        } catch (ex: java.io.IOException) {
            log.info("Telegram {} unreachable: {}", method, ex.message)
            throw TelegramApiException(method, "network", ex.message ?: "network error", retryable = true)
        } catch (ex: IllegalStateException) {
            throw TelegramApiException(method, "not_configured", ex.message ?: "not configured", retryable = false)
        }
    }

    private fun parseError(method: String, rawBody: String?): JsonNode? {
        if (rawBody.isNullOrBlank()) return null
        val node = try {
            com.fasterxml.jackson.databind.ObjectMapper().readTree(rawBody)
        } catch (ex: Exception) {
            return null
        }
        if (node.get("ok")?.asBoolean() == true) return node
        val code = node.get("error_code")?.asInt() ?: 0
        val description = node.get("description")?.asText() ?: rawBody.take(200)
        val retryAfter = node.get("parameters")?.get("retry_after")?.asLong()
        throw TelegramApiException(method, describe(code), description, retryable = code == 429 || code >= 500, retryAfterSeconds = retryAfter)
    }
}

/** Builds the inline keyboard used for admin order actions. */
object InlineKeyboard {
    fun orderButtons(orderId: Long, orderNumber: String, status: com.kidsstore.domain.OrderStatus, adminPanelBase: String?): Map<String, Any> {
        val rows = mutableListOf<List<Map<String, Any>>>()
        adminPanelBase?.takeIf { it.isNotBlank() }?.let { base ->
            rows.add(listOf(mapOf("text" to "View order $orderNumber", "url" to "${base.trimEnd('/')}/admin/orders/$orderId")))
        }
        val actions = mutableListOf<Map<String, Any>>()
        if (status == com.kidsstore.domain.OrderStatus.PENDING_CONFIRMATION) {
            actions.add(mapOf("text" to "Confirm order", "callback_data" to "confirm:$orderId"))
            actions.add(mapOf("text" to "Reject order", "callback_data" to "reject:$orderId"))
        }
        if (status == com.kidsstore.domain.OrderStatus.PROCESSING || status == com.kidsstore.domain.OrderStatus.CONFIRMED ||
            status == com.kidsstore.domain.OrderStatus.OUT_FOR_DELIVERY || status == com.kidsstore.domain.OrderStatus.FAILED_DELIVERY
        ) {
            actions.add(mapOf("text" to "Mark delivered", "callback_data" to "deliver:$orderId"))
        }
        if (actions.isNotEmpty()) rows.add(actions)
        return mapOf("inline_keyboard" to rows)
    }
}
