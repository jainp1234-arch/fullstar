package com.fullstar.api.common.metrics;

import com.fullstar.api.common.db.DataSourceConfig;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Plan 9.1: the prep queue for the Grafana "prep turnaround" panel, counted as app_system: open and
 * in-progress tasks, the oldest one's age, and the average opened-to-done time over the last 7 days.
 * Counts only; no family or chapter is named.
 */
@Component
public class PrepMetrics {

	private static final Logger log = LoggerFactory.getLogger(PrepMetrics.class);

	private final JdbcTemplate system;

	private final Map<String, Double> values = new ConcurrentHashMap<>();

	public PrepMetrics(@Qualifier(DataSourceConfig.SYSTEM) JdbcTemplate system, MeterRegistry registry) {
		this.system = system;
		gauge(registry, "fullstar.prep.tasks", "open", "Prep tasks waiting", "status", "open");
		gauge(registry, "fullstar.prep.tasks", "in_progress", "Prep tasks being prepared", "status", "in_progress");
		gauge(registry, "fullstar.prep.oldest.age", "oldest", "Age of the oldest open prep task, seconds");
		gauge(registry, "fullstar.prep.turnaround", "turnaround",
				"Average opened-to-done time of prep tasks done in the last 7 days, seconds");
	}

	private void gauge(MeterRegistry registry, String name, String key, String description, String... tags) {
		Gauge.builder(name, values, v -> v.getOrDefault(key, Double.NaN))
			.description(description)
			.tags(tags)
			.register(registry);
	}

	@Scheduled(initialDelayString = "${fullstar.metrics.prep-refresh:60s}",
			fixedDelayString = "${fullstar.metrics.prep-refresh:60s}")
	public void refresh() {
		try {
			Map<String, Object> row = system.queryForMap("""
					SELECT count(*) FILTER (WHERE status = 'open') AS open,
					       count(*) FILTER (WHERE status = 'in_progress') AS in_progress,
					       coalesce(extract(epoch FROM now() - min(opened_at)
					         FILTER (WHERE status IN ('open', 'in_progress'))), 0) AS oldest,
					       extract(epoch FROM avg(completed_at - opened_at)
					         FILTER (WHERE status = 'done' AND completed_at > now() - interval '7 days')) AS turnaround
					  FROM app.prep_tasks""");
			row.forEach((key, value) -> values.put(key,
					value == null ? Double.NaN : ((Number) value).doubleValue()));
		}
		catch (DataAccessException ex) {
			log.warn("Prep metrics not read: {}", ex.getClass().getSimpleName());
			values.clear();
		}
	}

}
