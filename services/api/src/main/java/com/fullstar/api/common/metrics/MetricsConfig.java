package com.fullstar.api.common.metrics;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Plan 9.1: refreshes the queue and prep gauges; off for one-shot runs (bootstrap, migrate, seed). */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "fullstar.metrics.enabled", havingValue = "true", matchIfMissing = true)
@EnableScheduling
public class MetricsConfig {

}
