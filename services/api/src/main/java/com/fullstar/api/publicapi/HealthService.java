package com.fullstar.api.publicapi;

import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.LivenessState;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Liveness from the application state; readiness also needs the database. */
@Service
public class HealthService {

	public static final String UP = "UP";

	public static final String DOWN = "DOWN";

	private final ApplicationAvailability availability;

	private final JdbcTemplate jdbc;

	public HealthService(ApplicationAvailability availability, JdbcTemplate jdbc) {
		this.availability = availability;
		this.jdbc = jdbc;
	}

	public record Health(String liveness, String readiness, String database) {
	}

	public Health current() {
		String liveness = availability.getLivenessState() == LivenessState.CORRECT ? UP : DOWN;
		String database = databaseUp() ? UP : DOWN;
		boolean accepting = availability.getReadinessState() == ReadinessState.ACCEPTING_TRAFFIC;
		String readiness = accepting && UP.equals(database) ? UP : DOWN;
		return new Health(liveness, readiness, database);
	}

	private boolean databaseUp() {
		try {
			Integer one = jdbc.queryForObject("SELECT 1", Integer.class);
			return one != null && one == 1;
		}
		catch (RuntimeException ex) {
			return false;
		}
	}

}
