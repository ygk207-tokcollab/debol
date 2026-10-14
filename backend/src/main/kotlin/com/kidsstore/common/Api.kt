package com.kidsstore.common

import com.fasterxml.jackson.annotation.JsonInclude
import com.kidsstore.config.AppProperties
import org.slf4j.LoggerFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.core.AuthenticationException
import org.springframework.validation.FieldError
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.multipart.MaxUploadSizeExceededException
import org.springframework.web.servlet.resource.NoResourceFoundException
import java.math.BigDecimal
import java.math.RoundingMode

@JsonInclude(JsonInclude.Include.NON_NULL)
data class FieldMessage(val field: String, val message: String)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class ErrorResponse(
    val error: String,
    val message: String,
    val fields: List<FieldMessage>? = null,
    val requestId: String? = null,
)

class ApiException(
    val status: HttpStatus,
    val code: String,
    override val message: String,
    val fields: List<FieldMessage>? = null,
) : RuntimeException(message)

fun badRequest(code: String, message: String, fields: List<FieldMessage>? = null) =
    ApiException(HttpStatus.BAD_REQUEST, code, message, fields)

fun notFound(code: String, message: String) =
    ApiException(HttpStatus.NOT_FOUND, code, message)

fun conflict(code: String, message: String, fields: List<FieldMessage>? = null) =
    ApiException(HttpStatus.CONFLICT, code, message, fields)

fun forbidden(message: String, code: String = "forbidden") =
    ApiException(HttpStatus.FORBIDDEN, code, message)

fun unauthorized(message: String, code: String = "unauthorized") =
    ApiException(HttpStatus.UNAUTHORIZED, code, message)

@RestControllerAdvice
open class ApiExceptionHandler(private val props: AppProperties) {
    private val log = LoggerFactory.getLogger(javaClass)

    @ExceptionHandler(ApiException::class)
    fun handleApi(ex: ApiException): ResponseEntity<ErrorResponse> =
        ResponseEntity.status(ex.status).body(ErrorResponse(ex.code, ex.message, ex.fields))

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidation(ex: MethodArgumentNotValidException): ResponseEntity<ErrorResponse> {
        val fields = ex.bindingResult.allErrors.mapNotNull { err ->
            (err as? FieldError)?.let { FieldMessage(it.field, it.defaultMessage ?: "invalid") }
        }
        return ResponseEntity.badRequest()
            .body(ErrorResponse("validation_failed", "Some fields need attention", fields))
    }

    @ExceptionHandler(AuthenticationException::class, AccessDeniedException::class)
    fun handleAuth(ex: Exception): ResponseEntity<ErrorResponse> =
        ResponseEntity.status(HttpStatus.FORBIDDEN).body(ErrorResponse("forbidden", "Not allowed for this account"))

    @ExceptionHandler(DataIntegrityViolationException::class)
    fun handleIntegrity(ex: DataIntegrityViolationException): ResponseEntity<ErrorResponse> {
        log.warn("Constraint violation: {}", ex.mostSpecificCause.message)
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ErrorResponse("conflict", "That value conflicts with existing data"))
    }

    @ExceptionHandler(NoResourceFoundException::class)
    fun handleNoResource(ex: NoResourceFoundException): ResponseEntity<ErrorResponse> =
        ResponseEntity.status(HttpStatus.NOT_FOUND).body(ErrorResponse("not_found", "Endpoint not found"))

    /**
     * Tomcat rejects an oversized part while parsing the request, before any controller runs, so the
     * failure arrives wrapped in an IllegalStateException. Turns it into the same 400 the upload
     * check itself would have returned.
     */
    @ExceptionHandler(MaxUploadSizeExceededException::class, IllegalStateException::class)
    fun handleUploadLimit(ex: Exception): ResponseEntity<ErrorResponse> {
        val exceeded = ex is MaxUploadSizeExceededException ||
            generateSequence(ex.cause) { it.cause }.any { it.javaClass.name.endsWith("SizeLimitExceededException") }
        if (!exceeded) return handleUnexpected(ex)
        return ResponseEntity.badRequest().body(ErrorResponse(
            "image_too_large",
            "Image must be smaller than ${(props.storage.maxUploadBytes / 1_048_576).toInt()} MB",
        ))
    }

    @ExceptionHandler(Exception::class)
    fun handleUnexpected(ex: Exception): ResponseEntity<ErrorResponse> {
        val id = java.util.UUID.randomUUID().toString().take(8)
        log.error("Unhandled error [{}]", id, ex)
        // Never leak stack traces or database internals to callers.
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(ErrorResponse("server_error", "Something went wrong, please retry (ref $id)", requestId = id))
    }
}

object Money {
    const val SCALE = 2

    fun parse(value: BigDecimal?): BigDecimal = (value ?: BigDecimal.ZERO).setScale(SCALE, RoundingMode.HALF_UP)

    fun of(raw: String): BigDecimal = BigDecimal(raw.trim()).setScale(SCALE, RoundingMode.HALF_UP)

    fun multiply(unitPrice: BigDecimal, quantity: Int): BigDecimal =
        unitPrice.multiply(BigDecimal(quantity)).setScale(SCALE, RoundingMode.HALF_UP)

    fun sum(values: List<BigDecimal>): BigDecimal =
        values.fold(BigDecimal.ZERO) { acc, v -> acc.add(v) }.setScale(SCALE, RoundingMode.HALF_UP)

    /** 1250.00 -> "ETB 1,250" style label used in Telegram messages and receipts. */
    fun format(amount: BigDecimal, currency: String = "ETB"): String {
        val scaled = amount.setScale(2, RoundingMode.HALF_UP)
        val grouped = java.text.NumberFormat.getIntegerInstance().format(scaled.toBigInteger())
        val cents = scaled.remainder(BigDecimal.ONE).movePointRight(2).toInt().toString().padStart(2, '0')
        return "$currency $grouped.$cents"
    }
}

object Tokens {
    private val random = java.security.SecureRandom()

    fun urlSafe(bytes: Int): String {
        val buffer = ByteArray(bytes)
        random.nextBytes(buffer)
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(buffer)
    }

    fun numericCode(digits: Int): String {
        val sb = StringBuilder()
        repeat(digits) { sb.append(random.nextInt(10)) }
        return sb.toString()
    }

    fun sha256Hex(value: String): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    fun constantTimeEquals(a: String, b: String): Boolean {
        val left = a.toByteArray(Charsets.UTF_8)
        val right = b.toByteArray(Charsets.UTF_8)
        return java.security.MessageDigest.isEqual(left, right)
    }
}
