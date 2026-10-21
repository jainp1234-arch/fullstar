package com.fullstar.api.family.messages;

import com.fullstar.api.common.error.NotFoundException;
import com.fullstar.api.common.pagination.PageRequest;
import com.fullstar.api.common.web.ApiResponse;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** P19 Messages (Schema §11, auth P; Plan 5.5). */
@RestController
@RequestMapping("/api/v1/family/parent/messages")
public class MessageController {

	private final MessageService messages;

	public MessageController(MessageService messages) {
		this.messages = messages;
	}

	@GetMapping
	ApiResponse<MessageService.Page> list(@RequestParam(required = false) Integer limit,
			@RequestParam(required = false) String cursor) {
		return ApiResponse.success(messages.list(PageRequest.of(limit, cursor)));
	}

	@PostMapping("/{id}/read")
	ApiResponse<MessageService.Message> read(@PathVariable String id) {
		UUID messageId;
		try {
			messageId = UUID.fromString(id);
		}
		catch (IllegalArgumentException ex) {
			throw new NotFoundException();
		}
		return ApiResponse.success(messages.markRead(messageId));
	}

}
