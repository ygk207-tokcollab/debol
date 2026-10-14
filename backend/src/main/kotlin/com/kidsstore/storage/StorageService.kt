package com.kidsstore.storage

import com.kidsstore.common.badRequest
import com.kidsstore.config.AppProperties
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.web.multipart.MultipartFile
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import java.util.UUID

data class StoredFile(val storageKey: String, val url: String)

/**
 * Local disk storage behind the same interface a bucket driver would use: the database keeps the
 * key and the public URL, never an absolute path. Swap [StorageService.root] for an S3/Spaces client
 * in production by changing kidsstore.storage.driver.
 */
@Service
open class StorageService(private val props: AppProperties) {
    private val log = LoggerFactory.getLogger(javaClass)

    private val allowedTypes = mapOf(
        "image/jpeg" to "jpg",
        "image/png" to "png",
        "image/webp" to "webp",
    )

    private val root: Path = Paths.get(props.storage.localDir).toAbsolutePath().normalize()

    open fun store(file: MultipartFile, folder: String = "products"): StoredFile {
        if (file.isEmpty) throw badRequest("empty_upload", "Choose an image file to upload")
        val contentType = file.contentType?.lowercase() ?: ""
        val extension = allowedTypes[contentType]
            ?: throw badRequest("unsupported_image_type",
                "Only JPEG, PNG and WebP images are accepted (received ${contentType.ifBlank { "unknown" }})")
        if (file.size > props.storage.maxUploadBytes) {
            throw badRequest("image_too_large",
                "Image must be smaller than ${(props.storage.maxUploadBytes / 1_048_576).toInt()} MB")
        }
        val bytes = file.bytes
        verifyMagicBytes(bytes, contentType)

        val safeFolder = folder.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.ifBlank { "products" }
        val directory = root.resolve(safeFolder)
        Files.createDirectories(directory)
        val key = "${UUID.randomUUID()}.${extension}"
        val target = directory.resolve(key).normalize()
        // Defence against a crafted folder name escaping the upload root.
        if (!target.startsWith(root)) throw badRequest("invalid_upload", "Upload was rejected")
        Files.write(target, bytes)
        log.info("Stored upload {} ({} bytes)", target.fileName, bytes.size)
        return StoredFile("$safeFolder/$key", publicUrl("$safeFolder/$key"))
    }

    open fun publicUrl(storageKey: String): String =
        "${props.storage.publicBaseUrl.trimEnd('/')}/" + storageKey.trimStart('/')

    /** Best effort: a stale file must never block an admin from replacing an image. */
    open fun delete(storageKey: String?) {
        val key = storageKey?.takeIf { it.isNotBlank() } ?: return
        runCatching {
            val target = root.resolve(key).normalize()
            if (target.startsWith(root)) Files.deleteIfExists(target)
        }.onFailure { log.warn("Could not delete upload {}: {}", key, it.message) }
    }

    private fun verifyMagicBytes(bytes: ByteArray, contentType: String) {
        val magic = when (contentType) {
            "image/jpeg" -> bytes.size > 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte()
            "image/png" -> bytes.size > 8 && bytes[1] == 'P'.code.toByte() && bytes[2] == 'N'.code.toByte()
            "image/webp" -> bytes.size > 12 && bytes[8] == 'W'.code.toByte() && bytes[9] == 'E'.code.toByte()
            else -> false
        }
        if (!magic) throw badRequest("corrupt_image", "That file is not a readable image")
    }
}
