package com.fullstar.api;

import java.util.TimeZone;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class ApiApplication {

	public static void main(String[] args) {
		// All times are UTC (Schema §1); "today" is computed in Asia/Kolkata where needed.
		TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
		SpringApplication.run(ApiApplication.class, args);
	}

}
