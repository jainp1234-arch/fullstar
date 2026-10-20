package com.fullstar.api.jobs;

import static org.assertj.core.api.Assertions.assertThat;

import com.fullstar.api.common.jobs.JobQueue;
import com.fullstar.api.common.jobs.QueueBootstrap;
import com.fullstar.api.testsupport.ApiTestSupport;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

class QueueBootstrapTest extends ApiTestSupport {

	@Autowired
	private QueueBootstrap bootstrap;

	@Autowired
	private SqsClient sqs;

	@Test
	void createsEveryQueueWithItsDeadLetterQueueAndIsSafeToRerun() {
		bootstrap.createAll();
		bootstrap.createAll();
		List<String> urls = sqs.listQueues().queueUrls();
		for (JobQueue queue : JobQueue.values()) {
			String url = urls.stream().filter(u -> u.endsWith("/" + queue.baseName())).findFirst().orElseThrow();
			assertThat(urls).anyMatch(u -> u.endsWith("/" + queue.baseName() + "-dlq"));
			Map<QueueAttributeName, String> attributes = sqs
				.getQueueAttributes(r -> r.queueUrl(url).attributeNames(QueueAttributeName.ALL))
				.attributes();
			assertThat(attributes.get(QueueAttributeName.VISIBILITY_TIMEOUT))
				.isEqualTo(String.valueOf(queue.visibility().toSeconds()));
			assertThat(attributes.get(QueueAttributeName.REDRIVE_POLICY)).contains(queue.baseName() + "-dlq")
				.containsPattern("\"maxReceiveCount\":\"?3\"?");
		}
	}

}
