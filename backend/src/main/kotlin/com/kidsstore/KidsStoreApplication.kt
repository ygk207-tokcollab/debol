package com.kidsstore

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableAsync
import org.springframework.scheduling.annotation.EnableScheduling

@SpringBootApplication
@EnableScheduling
@EnableAsync
open class KidsStoreApplication

fun main(args: Array<String>) {
    runApplication<KidsStoreApplication>(*args)
}
