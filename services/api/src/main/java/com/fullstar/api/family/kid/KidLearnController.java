package com.fullstar.api.family.kid;

import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.security.FamilyGuards;
import com.fullstar.api.common.web.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Kid mode Learn: K1 home, K2 subject, K3 chapter or topic (Schema §11, auth K; Plan 6.1). */
@RestController
@RequestMapping("/api/v1/family/kid")
public class KidLearnController {

	private final KidLearnService learn;

	private final KidReadAlongService readAlong;

	public KidLearnController(KidLearnService learn, KidReadAlongService readAlong) {
		this.learn = learn;
		this.readAlong = readAlong;
	}

	@GetMapping("/home")
	ApiResponse<KidLearnService.Home> home(HttpServletRequest request) {
		return ApiResponse.success(learn.home(child(request)));
	}

	@GetMapping("/subjects/{subjectId}")
	ApiResponse<KidLearnService.Subject> subject(HttpServletRequest request, @PathVariable String subjectId) {
		int id;
		try {
			id = Integer.parseInt(subjectId);
		}
		catch (NumberFormatException ex) {
			throw new NotFoundException();
		}
		return ApiResponse.success(learn.subject(child(request), id));
	}

	@GetMapping("/chapters/{id}")
	ApiResponse<KidLearnService.Activity> chapter(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(learn.chapter(child(request), uuid(id)));
	}

	/** K5 read-along pages (Plan 6.3). */
	@GetMapping("/chapters/{id}/pages")
	ApiResponse<KidReadAlongService.Chapter> pages(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(readAlong.pages(child(request), uuid(id)));
	}

	@GetMapping("/topics/{id}")
	ApiResponse<KidLearnService.Activity> topic(HttpServletRequest request, @PathVariable String id) {
		return ApiResponse.success(learn.topic(child(request), uuid(id)));
	}

	/** Set by FamilyGuards.kidMode after checking the child is in the family. */
	private static UUID child(HttpServletRequest request) {
		return (UUID) request.getAttribute(FamilyGuards.CHILD_ATTRIBUTE);
	}

	private static UUID uuid(String id) {
		try {
			return UUID.fromString(id);
		}
		catch (IllegalArgumentException ex) {
			throw new NotFoundException();
		}
	}

}
